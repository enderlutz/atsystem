from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from db import get_db
from config import get_settings
from services.ghl import get_conversations, add_contact_note

router = APIRouter(prefix="/api/leads", tags=["leads"])


@router.get("")
async def list_leads(
    service_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
):
    db = get_db()
    q = db.table("leads").select("*").eq("archived", False).order("created_at", desc=True).limit(limit)
    if service_type:
        q = q.eq("service_type", service_type)
    if status:
        q = q.eq("status", status)
    res = q.execute()
    return res.data or []


@router.get("/{lead_id}")
async def get_lead(lead_id: str):
    db = get_db()
    res = db.table("leads").select("*").eq("id", lead_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = res.data

    est_res = (
        db.table("estimates")
        .select("*")
        .eq("lead_id", lead_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if est_res.data:
        lead["estimate"] = est_res.data[0]

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


@router.post("/archive-all")
async def archive_all_leads():
    """Archive all current leads so they're hidden from the dashboard (not deleted)."""
    db = get_db()
    count_res = db.table("leads").select("id").eq("archived", False).execute()
    count = len(count_res.data or [])
    db.table("leads").update({"archived": True}).eq("archived", False).execute()
    return {"status": "archived", "count": count}
