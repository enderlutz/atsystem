from __future__ import annotations

import secrets
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import datetime, timezone

from db import get_db
from config import get_settings
from models.estimate import AdminApproveRequest, EstimateAdjust, EstimateApprove, EstimateReject
from services.ghl import send_message_to_contact, format_estimate_for_client, add_contact_note
from api.auth import require_admin

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
    return res.data or []


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
async def approve_estimate(estimate_id: str, body: EstimateApprove = EstimateApprove(), _: dict = Depends(require_admin)):
    db = get_db()
    res = db.table("estimates").select("*, lead:leads(*)").eq("id", estimate_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")

    estimate = res.data
    lead = estimate.get("lead") or {}

    # Guardrail: VA may only send estimate after customer has responded (bypass with force_send)
    if not lead.get("customer_responded") and not body.force_send:
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
        "owner_notes": "All 3 packages sent" + (" (force-sent without customer reply)" if body.force_send and not lead.get("customer_responded") else ""),
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
        msg = format_estimate_for_client(estimate, estimate["service_type"])
        msg += f"\n\nView your packages and book your appointment:\n{proposal_url}"
        sent = send_message_to_contact(contact_id, msg)
        if sent:
            db.table("leads").update({"status": "sent"}).eq("id", estimate["lead_id"]).execute()
            essential = float(tiers.get("essential") or 0)
            legacy    = float(tiers.get("legacy") or 0)
            add_contact_note(contact_id, (
                f"[ATSystem] All packages sent\n"
                f"Essential: ${essential:,.0f} | Signature: ${signature_price:,.0f} | Legacy: ${legacy:,.0f}\n"
                f"Service: {estimate['service_type'].replace('_', ' ').title()}\n"
                f"Proposal link: {proposal_url}"
            ))

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

    if not lead.get("customer_responded") and not body.force_send:
        raise HTTPException(status_code=403, detail="Cannot send estimate before customer has responded")

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
        msg = format_estimate_for_client({**estimate, "inputs": inputs}, estimate["service_type"])
        msg += f"\n\nView your packages and book your appointment:\n{proposal_url}"
        sent = send_message_to_contact(contact_id, msg)
        if sent:
            db.table("leads").update({"status": "sent"}).eq("id", estimate["lead_id"]).execute()
            add_contact_note(contact_id, (
                f"[ATSystem] All packages sent\n"
                f"Essential: ${essential_price:,.0f} | Signature: ${signature_price:,.0f} | Legacy: ${legacy_price:,.0f}\n"
                f"Service: {estimate['service_type'].replace('_', ' ').title()}\n"
                f"Proposal link: {proposal_url}"
            ))

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
        adjusted_estimate = {**estimate, "estimate_low": body.estimate_low, "estimate_high": body.estimate_high}
        msg = format_estimate_for_client(adjusted_estimate, estimate["service_type"])
        msg += f"\n\nView your custom quote and book your appointment:\n{proposal_url}"
        sent = send_message_to_contact(contact_id, msg)
        if sent:
            db.table("leads").update({"status": "sent"}).eq("id", estimate["lead_id"]).execute()
            add_contact_note(contact_id, (
                f"[ATSystem] Adjusted estimate sent: ${body.estimate_low:,.0f}\n"
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


@router.post("/{estimate_id}/additional-services-sent")
async def mark_additional_services_sent(estimate_id: str):
    db = get_db()
    db.table("estimates").update({"additional_services_sent": True}).eq("id", estimate_id).execute()
    return {"status": "updated"}


@router.delete("/{estimate_id}/additional-services-sent")
async def unmark_additional_services_sent(estimate_id: str):
    db = get_db()
    db.table("estimates").update({"additional_services_sent": False}).eq("id", estimate_id).execute()
    return {"status": "updated"}
