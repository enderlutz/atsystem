"""
GHL Contact Sync — imports existing GHL contacts as leads.
POST /api/sync/ghl
"""
from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks

from db import get_db
from config import get_settings
from services.ghl import get_contacts, get_custom_fields, parse_webhook_payload
from api.webhooks import get_pricing_config, process_lead, get_field_map

router = APIRouter()
logger = logging.getLogger(__name__)

FORM_FIELD_KEYS = {
    "fence_height", "fence_age", "previously_stained",
    "service_timeline", "additional_services", "additional_notes",
    "surface_type", "square_footage",
}

# Expected field names we try to auto-map
EXPECTED_FIELDS = {
    "fence_height", "fence_age", "previously_stained",
    "service_timeline", "additional_services", "additional_notes",
    "surface_type", "square_footage", "service_type",
}


@router.post("/api/sync/ghl")
async def sync_ghl_contacts(background_tasks: BackgroundTasks):
    settings = get_settings()
    db = get_db()

    existing_res = db.table("leads").select("ghl_contact_id").execute()
    existing_ids = {r["ghl_contact_id"] for r in (existing_res.data or [])}

    field_map = get_field_map()
    contacts = get_contacts(settings.ghl_location_id)
    logger.info(f"GHL sync: fetched {len(contacts)} contacts")

    imported = 0
    skipped_duplicate = 0
    skipped_no_fields = 0
    errors = 0

    for contact in contacts:
        contact_id = contact.get("id", "")
        if not contact_id:
            continue
        if contact_id in existing_ids:
            skipped_duplicate += 1
            continue

        lead_data = parse_webhook_payload(contact, field_map=field_map)

        if not lead_data["form_data"]:
            skipped_no_fields += 1
            continue

        lead_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        lead_row = {
            "id":             lead_id,
            "ghl_contact_id": contact_id,
            "service_type":   lead_data["service_type"],
            "status":         "new",
            "address":        lead_data["address"],
            "form_data":      lead_data["form_data"],
            "contact_name":   lead_data.get("contact_name", ""),
            "contact_phone":  lead_data.get("contact_phone", ""),
            "contact_email":  lead_data.get("contact_email", ""),
            "priority":       lead_data.get("priority", "MEDIUM"),
            "tags":           [],
            "created_at":     now,
        }

        try:
            db.table("leads").insert(lead_row).execute()
            background_tasks.add_task(process_lead, lead_id, lead_data)
            existing_ids.add(contact_id)
            imported += 1
            logger.info(f"Synced contact {contact_id} → lead {lead_id}")
        except Exception as e:
            logger.error(f"Failed to import contact {contact_id}: {e}")
            errors += 1

    return {
        "status":             "done",
        "total_fetched":      len(contacts),
        "imported":           imported,
        "skipped_duplicate":  skipped_duplicate,
        "skipped_no_fields":  skipped_no_fields,
        "errors":             errors,
    }


@router.get("/api/sync/ghl/preview")
async def preview_ghl_contacts():
    settings = get_settings()
    field_map = get_field_map()
    contacts = get_contacts(settings.ghl_location_id, max_contacts=100)

    with_fields = sum(
        1 for c in contacts
        if parse_webhook_payload(c, field_map=field_map)["form_data"]
    )

    return {
        "status":            "ok",
        "total_contacts":    len(contacts),
        "with_form_fields":  with_fields,
        "sample_names": [
            f"{c.get('firstName', '')} {c.get('lastName', '')}".strip()
            for c in contacts[:5]
        ],
    }


@router.get("/api/sync/ghl/fields")
async def discover_ghl_fields():
    """
    Discover custom fields from GHL.
    First tries the /customFields API. If that returns 401 (scope issue),
    falls back to scanning actual contacts to find field IDs and guess names
    from their values.
    """
    settings = get_settings()
    db = get_db()

    # Try the custom fields API first
    fields = get_custom_fields(settings.ghl_location_id)

    if fields:
        # API worked — use field names directly
        results = []
        for f in fields:
            ghl_id = f.get("id", "")
            ghl_key = f.get("fieldKey", f.get("key", ""))
            ghl_name = f.get("name", "")

            auto_map = None
            name_lower = ghl_name.lower().replace(" ", "_").replace("-", "_")
            key_lower = ghl_key.lower()
            for expected_name in EXPECTED_FIELDS:
                if expected_name in name_lower or expected_name in key_lower:
                    auto_map = expected_name
                    break

            row = {
                "ghl_field_id": ghl_id,
                "ghl_field_key": ghl_key,
                "ghl_field_name": ghl_name,
                "our_field_name": auto_map,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            db.table("ghl_field_mapping").upsert(row, on_conflict="ghl_field_id").execute()
            results.append(row)
    else:
        # Fallback: scan contacts to discover field IDs from their values
        contacts = get_contacts(settings.ghl_location_id, max_contacts=50)
        seen_ids: dict[str, list[str]] = {}  # field_id -> sample values

        for contact in contacts:
            for cf in (contact.get("customFields") or []):
                fid = cf.get("id", "")
                val = str(cf.get("value", ""))
                if fid and val:
                    seen_ids.setdefault(fid, [])
                    if val not in seen_ids[fid] and len(seen_ids[fid]) < 5:
                        seen_ids[fid].append(val)

        # Auto-map based on sample values
        VALUE_HINTS = {
            "fence_age": ["1-6 years", "brand new", "6-15 years", "older than"],
            "service_timeline": ["this month", "planning ahead", "as soon", "within 2 weeks", "getting a quote"],
            "fence_height": ["6ft", "6.5ft", "7ft", "8ft", "standard"],
            "previously_stained": ["yes", "no"],
            "additional_services": ["fence repair", "pressure wash", "gate"],
        }

        results = []
        for fid, samples in seen_ids.items():
            auto_map = None
            samples_lower = " ".join(s.lower() for s in samples)

            for our_name, hints in VALUE_HINTS.items():
                if any(hint in samples_lower for hint in hints):
                    auto_map = our_name
                    break

            row = {
                "ghl_field_id": fid,
                "ghl_field_key": fid,
                "ghl_field_name": f"Samples: {', '.join(samples[:3])}",
                "our_field_name": auto_map,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            db.table("ghl_field_mapping").upsert(row, on_conflict="ghl_field_id").execute()
            results.append(row)

    return {
        "status": "ok",
        "total_fields": len(results),
        "fields": results,
        "auto_mapped": sum(1 for r in results if r["our_field_name"]),
    }


@router.put("/api/sync/ghl/fields/{ghl_field_id}")
async def update_field_mapping(ghl_field_id: str, body: dict):
    """Manually set which of our fields a GHL field maps to."""
    db = get_db()
    db.table("ghl_field_mapping").update({
        "our_field_name": body.get("our_field_name"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("ghl_field_id", ghl_field_id).execute()
    return {"status": "updated"}
