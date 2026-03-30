from __future__ import annotations

import asyncio
from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool
from typing import Optional
from datetime import datetime, timezone

from db import get_db
from config import get_settings
from services.ghl import get_conversations, get_all_messages, add_contact_note
from api.auth import require_admin

router = APIRouter(prefix="/api/leads", tags=["leads"])


@router.get("")
async def list_leads(
    service_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
):
    db = get_db()
    # Exclude va_notes (long text not needed for kanban cards) to reduce payload size
    list_fields = "id,ghl_contact_id,service_type,status,address,contact_name,contact_phone,contact_email,form_data,priority,urgency_level,kanban_column,customer_responded,customer_response_text,tags,created_at,archived"
    q = db.table("leads").select(list_fields).eq("archived", False).order("created_at", desc=True).limit(limit)
    if service_type:
        q = q.eq("service_type", service_type)
    if status:
        q = q.eq("status", status)
    res = q.execute()
    return res.data or []


@router.get("/latest")
async def get_latest_lead():
    """Return the most recent lead's id, name, and timestamp — used by frontend polling for new-lead notifications."""
    db = get_db()
    res = db.table("leads").select("id,contact_name,created_at").eq("archived", False).order("created_at", desc=True).limit(1).execute()
    if not res.data:
        return {"id": None, "contact_name": None, "created_at": None}
    row = res.data[0]
    return {"id": row["id"], "contact_name": row.get("contact_name", ""), "created_at": row["created_at"]}


@router.get("/{lead_id}")
async def get_lead(lead_id: str):
    db = get_db()

    # Run lead + all estimates queries in parallel
    lead_res, est_res = await asyncio.gather(
        run_in_threadpool(lambda: db.table("leads").select("*").eq("id", lead_id).single().execute()),
        run_in_threadpool(lambda: db.table("estimates").select("*").eq("lead_id", lead_id).order("created_at", desc=True).execute()),
    )

    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = lead_res.data
    all_estimates = est_res.data or []

    # Enrich each estimate with proposal info
    for estimate in all_estimates:
        prop_res = db.table("proposals").select(
            "token, funnel_stage, status, last_active_at, left_page_at, selected_tier, color_mode, selected_color, hoa_colors, custom_color, booked_at"
        ).eq("estimate_id", estimate["id"]).order("created_at", desc=True).limit(1).execute()
        if prop_res.data:
            p = prop_res.data[0]
            estimate["proposal_token"] = p["token"]
            estimate["proposal_funnel_stage"] = p.get("funnel_stage") or "opened"
            estimate["proposal_status"] = p.get("status") or "sent"
            estimate["proposal_last_active_at"] = p.get("last_active_at")
            estimate["proposal_left_page_at"] = p.get("left_page_at")
            estimate["proposal_selected_tier"] = p.get("selected_tier")
            estimate["proposal_color_mode"] = p.get("color_mode")
            estimate["proposal_selected_color"] = p.get("selected_color")
            estimate["proposal_hoa_colors"] = p.get("hoa_colors")
            estimate["proposal_custom_color"] = p.get("custom_color")
            estimate["proposal_booked_at"] = p.get("booked_at")

    # Backward compat: lead.estimate = most recent estimate
    if all_estimates:
        lead["estimate"] = all_estimates[0]
    # All estimates for multi-estimate support
    lead["estimates"] = all_estimates

    return lead


@router.post("/{lead_id}/check-response")
async def check_customer_response(lead_id: str):
    """Check GHL conversations for inbound messages from this contact."""
    db = get_db()
    lead_res = db.table("leads").select("*").eq("id", lead_id).single().execute()
    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    contact_id = lead_res.data["ghl_contact_id"]
    messages = get_conversations(contact_id)

    inbound = [m for m in messages if m.get("direction") == "inbound"]

    if inbound:
        latest = inbound[-1]
        response_text = latest.get("body", latest.get("message", ""))

        existing_tags = lead_res.data.get("tags") or []
        if not isinstance(existing_tags, list):
            existing_tags = []
        if "estimate_needed" not in existing_tags:
            existing_tags.append("estimate_needed")

        db.table("leads").update({
            "customer_responded": True,
            "customer_response_text": response_text,
            "tags": existing_tags,
        }).eq("id", lead_id).execute()

        return {"responded": True, "message_count": len(inbound), "latest": response_text}

    return {"responded": False, "message_count": 0}


@router.put("/{lead_id}/notes")
async def update_va_notes(lead_id: str, body: dict):
    """VA updates notes on a lead. Also syncs to GHL contact notes."""
    db = get_db()
    lead_res = db.table("leads").select("*").eq("id", lead_id).single().execute()
    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    va_notes = body.get("va_notes", "")
    db.table("leads").update({"va_notes": va_notes}).eq("id", lead_id).execute()

    contact_id = lead_res.data["ghl_contact_id"]
    if contact_id:
        add_contact_note(contact_id, f"[Dashboard VA Notes] {va_notes}")

    return {"status": "updated"}


@router.put("/{lead_id}/contact")
async def update_lead_contact(lead_id: str, body: dict):
    """Update contact name, phone, and address on a lead.
    
    If the address changes, the zip code is extracted from it and form_data.zip_code
    is updated, then the estimator is re-run so the pricing zone stays accurate.
    """
    import re
    db = get_db()
    lead_res = db.table("leads").select("*").eq("id", lead_id).single().execute()
    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")
    lead = lead_res.data

    update: dict = {}
    if "contact_name" in body:
        update["contact_name"] = body["contact_name"]
    if "contact_phone" in body:
        update["contact_phone"] = body["contact_phone"]

    # Mark contact as VA-edited so the 5-min GHL sync won't overwrite it
    existing_fd = lead.get("form_data") or {}
    if "contact_name" in body or "contact_phone" in body:
        if "form_data" not in update:
            update["form_data"] = {**existing_fd, "contact_edited": True}
        else:
            update["form_data"]["contact_edited"] = True

    reestimate = False
    if "address" in body and body["address"] != lead.get("address", ""):
        update["address"] = body["address"]
        # Extract 5-digit zip from new address and sync it into form_data
        # Also clear the autocomplete flag since Alan is manually setting the address
        zip_match = re.search(r"\b(\d{5})\b", body["address"])
        base_fd = update.get("form_data") or {**existing_fd}
        merged_form_data = {
            **base_fd,
            "address_autocompleted": False,
            "address_confirmed": True,
        }
        if zip_match:
            merged_form_data["zip_code"] = zip_match.group(1)
            reestimate = True
        update["form_data"] = merged_form_data

    if update:
        db.table("leads").update(update).eq("id", lead_id).execute()

    if reestimate:
        from api.webhooks import recalculate_estimate_for_lead
        form_data = update.get("form_data") or lead.get("form_data") or {}
        lead_data = {
            "service_type": lead["service_type"],
            "form_data": form_data,
            "zip_code": form_data.get("zip_code", ""),
            "ghl_contact_id": lead.get("ghl_contact_id", ""),
        }
        await recalculate_estimate_for_lead(lead_id, lead_data)

    return {"status": "updated", "reestimated": reestimate}


@router.post("/{lead_id}/confirm-address")
async def confirm_lead_address(lead_id: str):
    """Mark the autocompleted address as confirmed by Alan."""
    db = get_db()
    lead_res = db.table("leads").select("form_data").eq("id", lead_id).single().execute()
    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")
    form_data = {**(lead_res.data.get("form_data") or {}), "address_confirmed": True}
    db.table("leads").update({"form_data": form_data}).eq("id", lead_id).execute()
    return {"status": "confirmed"}


@router.put("/{lead_id}/column")
async def update_lead_column(lead_id: str, body: dict):
    """Set or clear the kanban_column override for drag-and-drop positioning."""
    db = get_db()
    db.table("leads").update({"kanban_column": body.get("kanban_column")}).eq("id", lead_id).execute()
    return {"status": "updated"}


@router.put("/{lead_id}/tags")
async def update_lead_tags(lead_id: str, body: dict):
    """Update tags on a lead."""
    db = get_db()
    db.table("leads").update({"tags": body.get("tags", [])}).eq("id", lead_id).execute()
    return {"status": "updated"}


@router.put("/{lead_id}/form-data")
async def update_lead_form_data(lead_id: str, body: dict):
    """VA updates estimate inputs (linear feet, fence height, age, etc.) and recalculates.

    If body contains 'estimate_id', only that specific estimate is recalculated.
    Otherwise, the primary (most recent pending) estimate is updated (backward compat).
    """
    db = get_db()
    lead_res = db.table("leads").select("*").eq("id", lead_id).single().execute()
    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = lead_res.data
    estimate_id = body.get("estimate_id")

    # Validate linear_feet if provided — prevent $0 estimates
    incoming_lf = body.get("form_data", {}).get("linear_feet")
    if incoming_lf is not None:
        try:
            if float(incoming_lf) <= 0:
                raise HTTPException(status_code=400, detail="linear_feet must be greater than 0")
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="linear_feet must be a valid number")

    incoming_form = body.get("form_data", {})

    if estimate_id:
        # Multi-estimate: update a specific estimate's inputs and recalculate it
        est_res = db.table("estimates").select("*").eq("id", estimate_id).eq("lead_id", lead_id).single().execute()
        if not est_res.data:
            raise HTTPException(status_code=404, detail="Estimate not found")
        est = est_res.data

        # Merge incoming form data with this estimate's existing inputs
        existing_inputs = est.get("inputs") or {}
        merged = {**existing_inputs, **incoming_form}
        # Also merge shared lead-level fields (zip_code, military_discount)
        lead_fd = lead.get("form_data") or {}
        for shared_key in ("zip_code", "military_discount", "service_timeline", "additional_services"):
            if shared_key in incoming_form:
                lead_fd[shared_key] = incoming_form[shared_key]
            if shared_key in lead_fd and shared_key not in merged:
                merged[shared_key] = lead_fd[shared_key]

        # Update lead-level form_data with shared fields
        db.table("leads").update({"form_data": lead_fd}).eq("id", lead_id).execute()

        # Recalculate this specific estimate
        from api.webhooks import recalculate_single_estimate
        await recalculate_single_estimate(estimate_id, lead["service_type"], merged)

        # Update label if provided
        if "label" in body:
            db.table("estimates").update({"label": body["label"]}).eq("id", estimate_id).execute()
    else:
        # Backward compat: merge into lead form_data, recalculate primary estimate
        merged = {**(lead.get("form_data") or {}), **incoming_form}
        db.table("leads").update({"form_data": merged}).eq("id", lead_id).execute()

        from api.webhooks import recalculate_estimate_for_lead
        lead_data = {
            "service_type": lead["service_type"],
            "form_data": merged,
            "zip_code": merged.get("zip_code", ""),
            "ghl_contact_id": lead.get("ghl_contact_id", ""),
        }
        await recalculate_estimate_for_lead(lead_id, lead_data)

        # Save label on the primary estimate if provided
        if "label" in body and body["label"]:
            est_res = db.table("estimates").select("id").eq("lead_id", lead_id).order("created_at", desc=True).limit(1).execute()
            if est_res.data:
                db.table("estimates").update({"label": body["label"]}).eq("id", est_res.data[0]["id"]).execute()

    return await get_lead(lead_id)


@router.get("/{lead_id}/estimates")
async def get_lead_estimates(lead_id: str):
    """Return all estimates for a lead, newest first."""
    db = get_db()
    res = (
        db.table("estimates")
        .select("*")
        .eq("lead_id", lead_id)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


@router.post("/{lead_id}/estimates")
async def create_additional_estimate(lead_id: str, body: dict):
    """Create an additional estimate section for a lead (multi-estimate support).

    Body: { label: str, form_data: { linear_feet, fence_height, fence_age, ... } }
    Shared fields (zip_code, military_discount) are pulled from the lead's form_data.
    """
    import uuid as _uuid
    db = get_db()
    lead_res = db.table("leads").select("*").eq("id", lead_id).single().execute()
    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")
    lead = lead_res.data

    label = body.get("label", "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Label is required for additional estimates")

    incoming_form = body.get("form_data", {})
    # Merge shared lead-level fields
    lead_fd = lead.get("form_data") or {}
    for shared_key in ("zip_code", "military_discount", "service_timeline"):
        if shared_key in lead_fd and shared_key not in incoming_form:
            incoming_form[shared_key] = lead_fd[shared_key]

    from services.estimator import calculate_estimate
    from api.webhooks import get_pricing_config, _build_inputs_with_meta

    config = get_pricing_config(lead["service_type"])
    low, high, breakdown, meta = calculate_estimate(
        lead["service_type"], incoming_form, config,
        zip_code=incoming_form.get("zip_code", ""),
    )

    estimate_id = str(_uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    db.table("estimates").insert({
        "id": estimate_id,
        "lead_id": lead_id,
        "service_type": lead["service_type"],
        "status": "pending",
        "inputs": _build_inputs_with_meta(incoming_form, meta),
        "breakdown": [b.model_dump() for b in breakdown],
        "estimate_low": low,
        "estimate_high": high,
        "label": label,
        "created_at": now,
    }).execute()

    return await get_lead(lead_id)


@router.delete("/{lead_id}/estimates/{estimate_id}")
async def delete_estimate(lead_id: str, estimate_id: str):
    """Delete a pending estimate section. Cannot delete the last estimate for a lead."""
    db = get_db()
    # Count pending estimates for this lead
    all_est = db.table("estimates").select("id").eq("lead_id", lead_id).execute()
    if len(all_est.data or []) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the only estimate for a lead")

    est_res = db.table("estimates").select("status").eq("id", estimate_id).eq("lead_id", lead_id).single().execute()
    if not est_res.data:
        raise HTTPException(status_code=404, detail="Estimate not found")
    if est_res.data["status"] not in ("pending", "adjusted"):
        raise HTTPException(status_code=400, detail="Can only delete pending or adjusted estimates")

    db.table("estimates").delete().eq("id", estimate_id).execute()
    return await get_lead(lead_id)


@router.get("/{lead_id}/messages")
async def get_lead_messages(lead_id: str):
    """Return full SMS conversation thread. Reads from DB (webhook-synced); falls back to GHL API on first load."""
    db = get_db()
    lead_res = db.table("leads").select("ghl_contact_id").eq("id", lead_id).single().execute()
    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")
    contact_id = lead_res.data.get("ghl_contact_id")
    if not contact_id:
        return {"messages": []}

    # DB-first: webhook keeps this table current after initial setup
    msgs_res = db.table("messages").select("*").eq("lead_id", lead_id).order("date_added").execute()
    if msgs_res.data:
        return {
            "messages": [
                {
                    "direction": m["direction"],
                    "body": m["body"],
                    "dateAdded": m["date_added"],
                    "messageType": m.get("message_type", "SMS"),
                }
                for m in msgs_res.data
            ]
        }

    # Fallback: fetch from GHL in a thread so we don't block the event loop
    try:
        msgs = await run_in_threadpool(get_all_messages, contact_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    for m in msgs:
        try:
            db.table("messages").insert({
                "ghl_contact_id": contact_id,
                "lead_id": lead_id,
                "direction": m.get("direction", "outbound"),
                "body": m.get("body", ""),
                "message_type": m.get("messageType", "SMS"),
                "date_added": m.get("dateAdded") or datetime.now(timezone.utc).isoformat(),
            }).execute()
        except Exception:
            pass  # Skip duplicates on concurrent fetches
    return {"messages": msgs}


@router.post("/{lead_id}/archive")
async def archive_lead(lead_id: str):
    """Soft-archive a single lead — hides it from the dashboard without deleting it."""
    db = get_db()
    db.table("leads").update({"archived": True}).eq("id", lead_id).execute()
    return {"status": "archived"}


@router.post("/archive-all")
async def archive_all_leads(_: dict = Depends(require_admin)):
    """Archive all current leads so they're hidden from the dashboard (not deleted)."""
    db = get_db()
    count_res = db.table("leads").select("id").eq("archived", False).execute()
    count = len(count_res.data or [])
    db.table("leads").update({"archived": True}).eq("archived", False).execute()
    return {"status": "archived", "count": count}
