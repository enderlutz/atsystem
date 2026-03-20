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

    # Run lead + estimate queries in parallel
    lead_res, est_res = await asyncio.gather(
        run_in_threadpool(lambda: db.table("leads").select("*").eq("id", lead_id).single().execute()),
        run_in_threadpool(lambda: db.table("estimates").select("*").eq("lead_id", lead_id).order("created_at", desc=True).limit(1).execute()),
    )

    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = lead_res.data

    if est_res.data:
        estimate = est_res.data[0]
        # Attach proposal token if one exists for this estimate
        prop_res = await run_in_threadpool(lambda: (
            db.table("proposals")
            .select("token, funnel_stage, status")
            .eq("estimate_id", estimate["id"])
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        ))
        if prop_res.data:
            estimate["proposal_token"] = prop_res.data[0]["token"]
            estimate["proposal_funnel_stage"] = prop_res.data[0].get("funnel_stage") or "opened"
            estimate["proposal_status"] = prop_res.data[0].get("status") or "sent"
        lead["estimate"] = estimate

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
    """VA updates estimate inputs (linear feet, fence height, age, etc.) and recalculates."""
    db = get_db()
    lead_res = db.table("leads").select("*").eq("id", lead_id).single().execute()
    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = lead_res.data

    # Validate linear_feet if provided — prevent $0 estimates
    incoming_lf = body.get("form_data", {}).get("linear_feet")
    if incoming_lf is not None:
        try:
            if float(incoming_lf) <= 0:
                raise HTTPException(status_code=400, detail="linear_feet must be greater than 0")
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="linear_feet must be a valid number")

    merged = {**(lead.get("form_data") or {}), **body.get("form_data", {})}
    db.table("leads").update({"form_data": merged}).eq("id", lead_id).execute()

    from api.webhooks import recalculate_estimate_for_lead
    lead_data = {
        "service_type": lead["service_type"],
        "form_data": merged,
        "zip_code": merged.get("zip_code", ""),
        "ghl_contact_id": lead.get("ghl_contact_id", ""),
    }
    await recalculate_estimate_for_lead(lead_id, lead_data)

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


@router.post("/archive-all")
async def archive_all_leads(_: dict = Depends(require_admin)):
    """Archive all current leads so they're hidden from the dashboard (not deleted)."""
    db = get_db()
    count_res = db.table("leads").select("id").eq("archived", False).execute()
    count = len(count_res.data or [])
    db.table("leads").update({"archived": True}).eq("archived", False).execute()
    return {"status": "archived", "count": count}
