"""All Contacts — sync GHL contacts to local DB and let VA import for re-quoting."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query

from db import get_db, get_conn
from config import get_settings
from services.ghl import get_contacts, get_contact, parse_webhook_payload

router = APIRouter(prefix="/api/contacts", tags=["contacts"])
logger = logging.getLogger(__name__)


# ── Helpers ──────────────────────────────────────────────────────────

def _normalize_contact(raw: dict, location_id: str, location_label: str) -> dict:
    first = raw.get("firstName", "") or ""
    last = raw.get("lastName", "") or ""
    name = f"{first} {last}".strip() or "(No name)"
    addr_parts = [
        raw.get("address1", ""),
        raw.get("city", ""),
        raw.get("state", ""),
        raw.get("postalCode", ""),
    ]
    address = " ".join(p for p in addr_parts if p).strip()
    return {
        "ghl_contact_id": raw.get("id", ""),
        "name": name,
        "phone": raw.get("phone", "") or "",
        "email": raw.get("email", "") or "",
        "address": address,
        "location_id": location_id,
        "location_label": location_label,
    }


def run_contacts_sync() -> dict:
    """Fetch all GHL contacts from both locations and upsert into ghl_contacts table.
    Called by both the API endpoint and the background poller."""
    settings = get_settings()
    now = datetime.now(timezone.utc)

    # Fetch from GHL
    contacts: list[dict] = []
    cypress = get_contacts(settings.ghl_location_id, max_contacts=2000)
    for c in cypress:
        norm = _normalize_contact(c, settings.ghl_location_id, settings.ghl_location_1_label)
        if norm["ghl_contact_id"]:
            contacts.append(norm)

    if settings.ghl_location_id_2:
        woodlands = get_contacts(settings.ghl_location_id_2, max_contacts=2000)
        for c in woodlands:
            norm = _normalize_contact(c, settings.ghl_location_id_2, settings.ghl_location_2_label)
            if norm["ghl_contact_id"]:
                contacts.append(norm)

    if not contacts:
        logger.warning("Contacts sync: no contacts fetched from GHL")
        return {"total_upserted": 0, "marked_imported": 0}

    # Batch upsert into ghl_contacts
    with get_conn() as conn:
        with conn.cursor() as cur:
            values = [
                (c["ghl_contact_id"], c["name"], c["phone"], c["email"],
                 c["address"], c["location_id"], c["location_label"], now)
                for c in contacts
            ]
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO ghl_contacts (ghl_contact_id, name, phone, email, address, location_id, location_label, synced_at)
                VALUES %s
                ON CONFLICT (ghl_contact_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    phone = EXCLUDED.phone,
                    email = EXCLUDED.email,
                    address = EXCLUDED.address,
                    location_id = EXCLUDED.location_id,
                    location_label = EXCLUDED.location_label,
                    synced_at = EXCLUDED.synced_at
                """,
                values,
                page_size=500,
            )

            # Mark contacts that are already in the leads table as imported
            cur.execute("""
                UPDATE ghl_contacts SET imported = TRUE
                WHERE ghl_contact_id IN (SELECT ghl_contact_id FROM leads WHERE ghl_contact_id IS NOT NULL)
                  AND imported = FALSE
            """)
            marked = cur.rowcount

    logger.info(f"Contacts sync: upserted {len(contacts)}, marked {marked} as already imported")
    return {"total_upserted": len(contacts), "marked_imported": marked}


# ── Endpoints ────────────────────────────────────────────────────────

@router.post("/sync")
async def sync_contacts():
    """Pull all contacts from GHL and save to local database."""
    try:
        result = run_contacts_sync()
    except Exception as e:
        logger.error(f"Contacts sync failed: {e}")
        raise HTTPException(status_code=500, detail=f"Sync failed: {e}")
    return {"status": "synced", **result}


@router.get("/all")
async def list_all_contacts():
    """Read contacts from local DB (not GHL). Excludes already-imported contacts."""
    db = get_db()

    # Get non-imported contacts
    res = db.table("ghl_contacts").select("*").eq("imported", False).order("name").execute()
    contacts = [
        {
            "id": r["ghl_contact_id"],
            "name": r["name"],
            "phone": r["phone"],
            "email": r["email"],
            "address": r["address"],
            "location_id": r["location_id"],
            "location_label": r["location_label"],
        }
        for r in (res.data or [])
    ]

    # Last synced timestamp
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(synced_at) FROM ghl_contacts")
            row = cur.fetchone()
            last_synced = row[0].isoformat() if row and row[0] else None

            cur.execute("SELECT COUNT(*) FROM ghl_contacts WHERE imported = TRUE")
            imported_count = cur.fetchone()[0]

    return {
        "contacts": contacts,
        "total": len(contacts),
        "already_imported": imported_count,
        "last_synced_at": last_synced,
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

    if loc_id == settings.ghl_location_id_2:
        location_label = settings.ghl_location_2_label
    else:
        location_label = settings.ghl_location_1_label

    now = datetime.now(timezone.utc).isoformat()
    form_data = lead_data.get("form_data", {})
    # Zip code lives inside form_data, not as a standalone column
    if lead_data.get("zip_code"):
        form_data["zip_code"] = lead_data["zip_code"]
    lead_row = {
        "ghl_contact_id": contact_id,
        "service_type": lead_data.get("service_type", "fence_staining"),
        "address": lead_data.get("address", ""),
        "contact_name": lead_data.get("contact_name", ""),
        "contact_phone": lead_data.get("contact_phone", ""),
        "contact_email": lead_data.get("contact_email", ""),
        "form_data": form_data,
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

    # Mark as imported in ghl_contacts cache
    db.table("ghl_contacts").update({"imported": True}).eq("ghl_contact_id", contact_id).execute()

    logger.info(f"Imported GHL contact {contact_id} as lead {lead_id} for re-quoting")
    return {"status": "imported", "lead_id": lead_id}
