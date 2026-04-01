"""All Contacts — fetch every GHL contact and let VA import for re-quoting."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from db import get_db
from config import get_settings
from services.ghl import get_contacts, get_contact, parse_webhook_payload

router = APIRouter(prefix="/api/contacts", tags=["contacts"])
logger = logging.getLogger(__name__)


@router.get("/all")
async def list_all_contacts():
    """Fetch all GHL contacts from both locations, excluding those already imported."""
    settings = get_settings()
    db = get_db()

    # Fetch contacts from GHL
    contacts_raw: list[dict] = []

    cypress = get_contacts(settings.ghl_location_id, max_contacts=2000)
    for c in cypress:
        c["_location_id"] = settings.ghl_location_id
        c["_location_label"] = settings.ghl_location_1_label
    contacts_raw.extend(cypress)

    if settings.ghl_location_id_2:
        woodlands = get_contacts(settings.ghl_location_id_2, max_contacts=2000)
        for c in woodlands:
            c["_location_id"] = settings.ghl_location_id_2
            c["_location_label"] = settings.ghl_location_2_label
        contacts_raw.extend(woodlands)

    # Get all ghl_contact_ids already in our leads table
    existing_res = db.table("leads").select("ghl_contact_id").execute()
    existing_ids = {r["ghl_contact_id"] for r in (existing_res.data or []) if r.get("ghl_contact_id")}

    # Normalize and filter
    contacts = []
    for c in contacts_raw:
        cid = c.get("id", "")
        if not cid or cid in existing_ids:
            continue

        first = c.get("firstName", "") or ""
        last = c.get("lastName", "") or ""
        name = f"{first} {last}".strip()

        addr_parts = [
            c.get("address1", ""),
            c.get("city", ""),
            c.get("state", ""),
            c.get("postalCode", ""),
        ]
        address = " ".join(p for p in addr_parts if p).strip()

        contacts.append({
            "id": cid,
            "name": name or "(No name)",
            "phone": c.get("phone", "") or "",
            "email": c.get("email", "") or "",
            "address": address,
            "location_id": c["_location_id"],
            "location_label": c["_location_label"],
        })

    return {
        "contacts": contacts,
        "total": len(contacts),
        "already_imported": len(existing_ids),
    }


@router.post("/{contact_id}/import")
async def import_contact(contact_id: str, location_id: str = Query("")):
    """Import a GHL contact as a lead for re-quoting. No automations fire."""
    settings = get_settings()
    db = get_db()
    loc_id = location_id or settings.ghl_location_id

    # Check if already imported
    existing = db.table("leads").select("id").eq("ghl_contact_id", contact_id).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail="Contact already imported")

    # Fetch full contact from GHL
    full_contact = get_contact(contact_id, location_id=loc_id)
    if not full_contact:
        raise HTTPException(status_code=404, detail="Contact not found in GHL")

    lead_data = parse_webhook_payload(full_contact)

    # Determine location label
    if loc_id == settings.ghl_location_id_2:
        location_label = settings.ghl_location_2_label
    else:
        location_label = settings.ghl_location_1_label

    now = datetime.now(timezone.utc).isoformat()
    lead_row = {
        "ghl_contact_id": contact_id,
        "service_type": lead_data.get("service_type", "fence_staining"),
        "address": lead_data.get("address", ""),
        "zip_code": lead_data.get("zip_code", ""),
        "contact_name": lead_data.get("contact_name", ""),
        "contact_phone": lead_data.get("contact_phone", ""),
        "contact_email": lead_data.get("contact_email", ""),
        "form_data": lead_data.get("form_data", {}),
        "status": "new",
        "priority": "MEDIUM",
        "kanban_column": "requote",
        "ghl_location_id": loc_id,
        "tags": ["Re-quote", location_label],
        "created_at": now,
    }

    try:
        res = db.table("leads").insert(lead_row).execute()
        lead_id = res.data[0]["id"] if res.data else None
    except Exception as e:
        logger.error(f"Failed to import contact {contact_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to import: {e}")

    logger.info(f"Imported GHL contact {contact_id} as lead {lead_id} for re-quoting")
    return {"status": "imported", "lead_id": lead_id}
