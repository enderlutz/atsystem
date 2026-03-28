from __future__ import annotations

import secrets
from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone

import bcrypt

from db import get_db
from config import get_settings
from models.estimate import AdminApproveRequest, EstimateAdjust, EstimateApprove, EstimateReject
from services.ghl import send_message_to_contact, add_contact_note
from api.auth import require_admin, get_current_user

router = APIRouter(prefix="/api/estimates", tags=["estimates"])


@router.get("")
async def list_estimates(
    status: str | None = Query(None),
    service_type: str | None = Query(None),
    limit: int = Query(50, le=200),
):
    db = get_db()
    q = db.table("estimates").select("*, lead:leads(*)").order("created_at", desc=True).limit(limit)
    if status:
        q = q.eq("status", status)
    if service_type:
        q = q.eq("service_type", service_type)
    res = q.execute()
    estimates = res.data or []
    # Exclude estimates for archived leads
    estimates = [e for e in estimates if not (e.get("lead") or {}).get("archived", False)]
    # Enrich with proposal funnel stage
    if estimates:
        est_ids = [e["id"] for e in estimates]
        prop_res = db.table("proposals").select("estimate_id, funnel_stage, status, last_active_at, left_page_at").in_("estimate_id", est_ids).execute()
        prop_map = {p["estimate_id"]: p for p in (prop_res.data or [])}
        for est in estimates:
            prop = prop_map.get(est["id"])
            if prop:
                est["proposal_funnel_stage"] = prop.get("funnel_stage") or "opened"
                est["proposal_status"] = prop.get("status") or "sent"
                est["proposal_last_active_at"] = prop.get("last_active_at")
                est["proposal_left_page_at"] = prop.get("left_page_at")
    return estimates


@router.get("/{estimate_id}")
async def get_estimate(estimate_id: str):
    db = get_db()
    res = (
        db.table("estimates")
        .select("*, lead:leads(*)")
        .eq("id", estimate_id)
        .single()
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")
    return res.data


@router.post("/{estimate_id}/approve")
async def approve_estimate(estimate_id: str, body: EstimateApprove = EstimateApprove(), user: dict = Depends(get_current_user)):
    db = get_db()
    res = db.table("estimates").select("*, lead:leads(*)").eq("id", estimate_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")

    estimate = res.data
    lead = estimate.get("lead") or {}
    is_admin = user.get("role") == "admin"
    approval_status = ((estimate.get("inputs") or {}).get("_approval_status") or "").lower()

    # RED estimates require admin OR VA bypass with password confirmation
    if approval_status == "red" and not is_admin:
        if not body.bypass_approval or not body.bypass_password:
            raise HTTPException(
                status_code=403,
                detail="This estimate requires Alan's approval. Use bypass with password to override."
            )
        # Verify VA password
        username = user.get("sub")
        user_res = db.table("users").select("password_hash").eq("username", username).execute()
        user_row = (user_res.data or [None])[0]
        if not user_row or not bcrypt.checkpw(body.bypass_password.encode(), user_row["password_hash"].encode()):
            raise HTTPException(status_code=403, detail="Incorrect password — bypass denied")

    # Guardrail: VA may only send estimate after customer has responded (bypass with force_send)
    # Admin is NEVER blocked — they own the company
    if not is_admin and not lead.get("customer_responded") and not body.force_send:
        raise HTTPException(
            status_code=403,
            detail="Cannot send estimate before customer has responded"
        )

    tiers = (estimate.get("inputs") or {}).get("_tiers") or {}
    signature_price = float(tiers.get("signature") or estimate["estimate_low"])

    now = datetime.now(timezone.utc).isoformat()
    db.table("estimates").update({
        "status": "approved",
        "approved_at": now,
        "estimate_low": signature_price,
        "estimate_high": signature_price,
        "owner_notes": "All 3 packages sent"
            + (" (force-sent without customer reply)" if body.force_send and not lead.get("customer_responded") else "")
            + (f" (VA bypass by {user.get('name', user.get('sub'))})" if body.bypass_approval and not is_admin else ""),
    }).eq("id", estimate_id).execute()

    db.table("leads").update({"status": "approved"}).eq("id", estimate["lead_id"]).execute()

    # Generate proposal token and store — MUST succeed before sending SMS
    settings = get_settings()
    token = secrets.token_urlsafe(12)
    proposal_url = f"{settings.proposal_base_url}/proposal/{token}"
    try:
        db.table("proposals").insert({
            "token": token,
            "estimate_id": estimate_id,
            "lead_id": estimate["lead_id"],
            "status": "sent",
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create proposal record: {e}")

    contact_id = lead.get("ghl_contact_id")
    if contact_id:
        send_count = (estimate.get("send_count") or 0) + 1
        db.table("estimates").update({"send_count": send_count}).eq("id", estimate_id).execute()
        db.table("leads").update({"status": "sent"}).eq("id", estimate["lead_id"]).execute()
        essential = float(tiers.get("essential") or 0)
        legacy    = float(tiers.get("legacy") or 0)
        add_contact_note(contact_id, (
            f"[ATSystem] All packages sent (send #{send_count})\n"
            f"Essential: ${essential:,.0f} | Signature: ${signature_price:,.0f} | Legacy: ${legacy:,.0f}\n"
            f"Service: {estimate['service_type'].replace('_', ' ').title()}\n"
            f"Proposal link: {proposal_url}"
        ))

    # Transition workflow to HOT_LEAD — fires proposal SMS immediately via workflow engine
    try:
        from services.workflow import on_estimate_sent
        on_estimate_sent(estimate["lead_id"], proposal_url=proposal_url)
    except Exception as e:
        logger.error(f"Workflow on_estimate_sent failed for lead {estimate['lead_id']}: {e}")

    return {"status": "approved", "estimate_id": estimate_id, "proposal_token": token, "proposal_url": proposal_url}


@router.post("/{estimate_id}/admin-approve")
async def admin_approve_estimate(estimate_id: str, body: AdminApproveRequest, _: dict = Depends(require_admin)):
    """Admin-only: approve with optional custom tier price overrides for all 3 packages."""
    db = get_db()
    res = db.table("estimates").select("*, lead:leads(*)").eq("id", estimate_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")

    estimate = res.data
    lead = estimate.get("lead") or {}

    # Apply optional admin overrides to tiers
    inputs = dict(estimate.get("inputs") or {})
    tiers = dict(inputs.get("_tiers") or {})
    if body.essential is not None:
        tiers["essential"] = body.essential
    if body.signature is not None:
        tiers["signature"] = body.signature
    if body.legacy is not None:
        tiers["legacy"] = body.legacy
    inputs["_tiers"] = tiers

    signature_price = float(tiers.get("signature") or estimate["estimate_low"])
    essential_price = float(tiers.get("essential") or 0)
    legacy_price = float(tiers.get("legacy") or 0)

    now = datetime.now(timezone.utc).isoformat()
    owner_notes = body.notes or "All 3 packages sent"
    if body.force_send and not lead.get("customer_responded"):
        owner_notes += " (force-sent without customer reply)"

    db.table("estimates").update({
        "status": "approved",
        "approved_at": now,
        "estimate_low": signature_price,
        "estimate_high": signature_price,
        "owner_notes": owner_notes,
        "inputs": inputs,
    }).eq("id", estimate_id).execute()

    db.table("leads").update({"status": "approved"}).eq("id", estimate["lead_id"]).execute()

    settings = get_settings()
    token = secrets.token_urlsafe(12)
    proposal_url = f"{settings.proposal_base_url}/proposal/{token}"
    try:
        db.table("proposals").insert({
            "token": token,
            "estimate_id": estimate_id,
            "lead_id": estimate["lead_id"],
            "status": "sent",
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create proposal record: {e}")

    contact_id = lead.get("ghl_contact_id")
    if contact_id:
        send_count = (estimate.get("send_count") or 0) + 1
        db.table("estimates").update({"send_count": send_count}).eq("id", estimate_id).execute()
        db.table("leads").update({"status": "sent"}).eq("id", estimate["lead_id"]).execute()
        add_contact_note(contact_id, (
            f"[ATSystem] All packages sent (send #{send_count})\n"
            f"Essential: ${essential_price:,.0f} | Signature: ${signature_price:,.0f} | Legacy: ${legacy_price:,.0f}\n"
            f"Service: {estimate['service_type'].replace('_', ' ').title()}\n"
            f"Proposal link: {proposal_url}"
        ))

    # Transition workflow to HOT_LEAD — fires proposal SMS immediately via workflow engine
    try:
        from services.workflow import on_estimate_sent
        on_estimate_sent(estimate["lead_id"], proposal_url=proposal_url)
    except Exception as e:
        logger.error(f"Workflow on_estimate_sent failed for lead {estimate['lead_id']}: {e}")

    return {"status": "approved", "estimate_id": estimate_id, "proposal_token": token, "proposal_url": proposal_url}


@router.put("/{estimate_id}")
async def adjust_estimate(estimate_id: str, body: EstimateAdjust, _: dict = Depends(require_admin)):
    db = get_db()
    res = db.table("estimates").select("*").eq("id", estimate_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")

    estimate = res.data
    now = datetime.now(timezone.utc).isoformat()

    update_data = {
        "status": "adjusted",
        "estimate_low": body.estimate_low,
        "estimate_high": body.estimate_high,
        "approved_at": now,
    }
    if body.owner_notes:
        update_data["owner_notes"] = body.owner_notes

    db.table("estimates").update(update_data).eq("id", estimate_id).execute()
    db.table("leads").update({"status": "approved"}).eq("id", estimate["lead_id"]).execute()

    # Generate proposal token and store
    settings = get_settings()
    token = secrets.token_urlsafe(12)
    proposal_url = f"{settings.proposal_base_url}/proposal/{token}"
    try:
        db.table("proposals").insert({
            "token": token,
            "estimate_id": estimate_id,
            "lead_id": estimate["lead_id"],
            "status": "sent",
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create proposal record: {e}")

    lead_res = db.table("leads").select("*").eq("id", estimate["lead_id"]).single().execute()
    lead = lead_res.data or {}
    contact_id = lead.get("ghl_contact_id")
    if contact_id:
        first_name = (lead.get("contact_name") or "").split()[0]
        from services.templates import get_stage_messages, render_message
        hot_lead_msgs = get_stage_messages("hot_lead")
        msg = render_message(hot_lead_msgs[0][1], {"first_name": first_name, "proposal_link": proposal_url})
        sent = send_message_to_contact(contact_id, msg)
        if sent:
            send_count = (estimate.get("send_count") or 0) + 1
            db.table("estimates").update({"send_count": send_count}).eq("id", estimate_id).execute()
            db.table("leads").update({"status": "sent"}).eq("id", estimate["lead_id"]).execute()
            add_contact_note(contact_id, (
                f"[ATSystem] Adjusted estimate sent: ${body.estimate_low:,.0f} (send #{send_count})\n"
                f"Service: {estimate['service_type'].replace('_', ' ').title()}\n"
                f"Proposal link: {proposal_url}"
            ))

    return {"status": "adjusted", "estimate_id": estimate_id, "proposal_token": token, "proposal_url": proposal_url}


@router.post("/{estimate_id}/reject")
async def reject_estimate(estimate_id: str, body: EstimateReject, _: dict = Depends(require_admin)):
    db = get_db()
    res = db.table("estimates").select("*").eq("id", estimate_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")

    update_data: dict = {"status": "rejected"}
    if body.notes:
        update_data["owner_notes"] = body.notes

    db.table("estimates").update(update_data).eq("id", estimate_id).execute()
    db.table("leads").update({"status": "rejected"}).eq("id", res.data["lead_id"]).execute()

    return {"status": "rejected", "estimate_id": estimate_id}


@router.post("/{estimate_id}/request-review")
async def request_review(estimate_id: str):
    """VA flags an estimate for Alan's review — sets approval status to red."""
    db = get_db()
    res = db.table("estimates").select("*").eq("id", estimate_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")
    inputs = dict(res.data.get("inputs") or {})
    inputs["_approval_status"] = "red"
    inputs["_approval_reason"] = "Flagged for owner review by VA"
    db.table("estimates").update({"inputs": inputs}).eq("id", estimate_id).execute()
    return {"status": "flagged_for_review", "estimate_id": estimate_id}


@router.put("/{estimate_id}/custom-tiers")
async def save_custom_tiers(estimate_id: str, body: dict):
    """Save custom tier prices without approving or sending. Both VA and admin can use."""
    db = get_db()
    res = db.table("estimates").select("*").eq("id", estimate_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")

    inputs = dict(res.data.get("inputs") or {})
    tiers = dict(inputs.get("_tiers") or {})

    if body.get("essential") is not None:
        tiers["essential"] = float(body["essential"])
    if body.get("signature") is not None:
        tiers["signature"] = float(body["signature"])
    if body.get("legacy") is not None:
        tiers["legacy"] = float(body["legacy"])
    inputs["_tiers"] = tiers

    update_data: dict = {"inputs": inputs}
    if body.get("notes"):
        update_data["owner_notes"] = body["notes"]

    db.table("estimates").update(update_data).eq("id", estimate_id).execute()
    return {"status": "saved", "tiers": tiers}


@router.post("/{estimate_id}/resend")
async def resend_estimate(estimate_id: str, _: dict = Depends(require_admin)):
    """Resend the proposal SMS to the client. Only valid for approved/adjusted estimates."""
    db = get_db()
    res = db.table("estimates").select("*, lead:leads(*)").eq("id", estimate_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")

    estimate = res.data
    lead = estimate.get("lead") or {}

    if estimate["status"] not in ("approved", "adjusted"):
        raise HTTPException(status_code=400, detail="Can only resend approved or adjusted estimates")

    settings = get_settings()
    token = secrets.token_urlsafe(12)
    proposal_url = f"{settings.proposal_base_url}/proposal/{token}"
    try:
        db.table("proposals").insert({
            "token": token,
            "estimate_id": estimate_id,
            "lead_id": estimate["lead_id"],
            "status": "sent",
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create proposal record: {e}")

    contact_id = lead.get("ghl_contact_id")
    if contact_id:
        first_name = (lead.get("contact_name") or "").split()[0]
        from services.templates import get_stage_messages, render_message
        hot_lead_msgs = get_stage_messages("hot_lead")
        msg = render_message(hot_lead_msgs[0][1], {"first_name": first_name, "proposal_link": proposal_url})
        sent = send_message_to_contact(contact_id, msg)
        if sent:
            send_count = (estimate.get("send_count") or 0) + 1
            db.table("estimates").update({"send_count": send_count}).eq("id", estimate_id).execute()
            add_contact_note(contact_id, f"[ATSystem] Estimate re-sent (send #{send_count})\nProposal link: {proposal_url}")

    return {"status": "resent", "estimate_id": estimate_id, "proposal_token": token, "proposal_url": proposal_url}


@router.post("/{estimate_id}/notify-owner")
async def notify_owner_for_approval(estimate_id: str, user: dict = Depends(get_current_user)):
    """VA notifies Alan via GHL SMS that an estimate needs his approval."""
    db = get_db()
    res = db.table("estimates").select("*, lead:leads(*)").eq("id", estimate_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")

    estimate = res.data
    lead = estimate.get("lead") or {}
    inputs = estimate.get("inputs") or {}
    approval_reason = inputs.get("_approval_reason") or "Flagged for review"
    tiers = inputs.get("_tiers") or {}

    contact_name = lead.get("contact_name") or "Unknown"
    address = lead.get("address") or ""
    signature_price = float(tiers.get("signature") or estimate.get("estimate_low") or 0)
    essential_price = float(tiers.get("essential") or 0)
    legacy_price = float(tiers.get("legacy") or 0)

    settings = get_settings()
    owner_contact_id = settings.owner_ghl_contact_id
    if not owner_contact_id:
        raise HTTPException(status_code=500, detail="OWNER_GHL_CONTACT_ID not configured")

    va_name = user.get("name", user.get("sub", "VA"))
    msg = (
        f"[ATSystem] Estimate needs your approval\n\n"
        f"Lead: {contact_name}\n"
        f"Address: {address}\n"
        f"Essential: ${essential_price:,.0f} | Signature: ${signature_price:,.0f} | Legacy: ${legacy_price:,.0f}\n"
        f"Reason: {approval_reason}\n\n"
        f"Flagged by: {va_name}\n"
        f"Review at: {settings.frontend_url}/leads/{lead.get('id', '')}"
    )

    sent = send_message_to_contact(owner_contact_id, msg)
    if not sent:
        raise HTTPException(status_code=500, detail="Failed to send notification to Alan")

    # Also mark as flagged for review in the inputs
    inputs_copy = dict(inputs)
    inputs_copy["_approval_status"] = "red"
    inputs_copy["_approval_reason"] = approval_reason
    inputs_copy["_owner_notified"] = True
    inputs_copy["_owner_notified_by"] = va_name
    db.table("estimates").update({"inputs": inputs_copy}).eq("id", estimate_id).execute()

    return {"status": "notified", "estimate_id": estimate_id}


@router.post("/{estimate_id}/preview")
async def get_preview_token(estimate_id: str):
    """Create (or return existing) a preview proposal so VA can see the page before sending."""
    db = get_db()
    res = db.table("estimates").select("*").eq("id", estimate_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")
    estimate = res.data

    # Return existing preview token if one already exists
    existing = db.table("proposals").select("token").eq("estimate_id", estimate_id).eq("status", "preview").execute()
    if existing.data:
        return {"token": existing.data[0]["token"]}

    token = secrets.token_urlsafe(12)
    db.table("proposals").insert({
        "token": token,
        "estimate_id": estimate_id,
        "lead_id": estimate["lead_id"],
        "status": "preview",
    }).execute()
    return {"token": token}


class AddonMarkRequest(BaseModel):
    description: str | None = None
    price: float | None = None


@router.post("/{estimate_id}/additional-services-sent")
async def mark_additional_services_sent(estimate_id: str, body: AddonMarkRequest = Body(default=AddonMarkRequest())):
    db = get_db()
    update: dict = {"additional_services_sent": True}
    if body.description is not None:
        update["addon_description"] = body.description
    if body.price is not None:
        update["addon_price"] = body.price
    db.table("estimates").update(update).eq("id", estimate_id).execute()
    return {"status": "updated"}


@router.delete("/{estimate_id}/additional-services-sent")
async def unmark_additional_services_sent(estimate_id: str):
    db = get_db()
    db.table("estimates").update({"additional_services_sent": False}).eq("id", estimate_id).execute()
    return {"status": "updated"}
