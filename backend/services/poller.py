"""
GHL Contact Poller — runs every 5 minutes to catch contacts
that may have been missed by webhook.
"""
from __future__ import annotations

import uuid
import asyncio
import logging
from datetime import datetime, timezone

from config import get_settings
from db import get_db
from services.ghl import get_contacts, parse_webhook_payload

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 300  # 5 minutes


async def poll_ghl_contacts():
    """Background loop: fetch recent GHL contacts, import new ones."""
    # Wait a few seconds for app startup to complete
    await asyncio.sleep(5)
    logger.info("GHL poller started (every 5 minutes)")

    while True:
        try:
            await _do_poll()
        except Exception as e:
            logger.error(f"GHL poll error: {e}")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def _do_poll():
    from api.webhooks import get_field_map, process_lead

    settings = get_settings()
    db = get_db()

    # Get last sync timestamp
    state = db.table("sync_state").select("last_sync_at").eq("id", "ghl_poll").single().execute()
    last_sync = state.data["last_sync_at"] if state.data else "2020-01-01T00:00:00Z"

    # Fetch recent contacts
    contacts = get_contacts(settings.ghl_location_id, max_contacts=100)

    # Get existing contact IDs
    existing_res = db.table("leads").select("ghl_contact_id").execute()
    existing_ids = {r["ghl_contact_id"] for r in (existing_res.data or [])}

    field_map = get_field_map()

    imported = 0
    now = datetime.now(timezone.utc)

    for contact in contacts:
        contact_id = contact.get("id", "")
        if not contact_id or contact_id in existing_ids:
            continue

        # Only import contacts added after last sync
        date_added = contact.get("dateAdded", "")
        if date_added and date_added < last_sync:
            continue

        lead_data = parse_webhook_payload(contact, field_map=field_map)
        if not lead_data["form_data"]:
            continue

        lead_id = str(uuid.uuid4())

        lead_row = {
            "id": lead_id,
            "ghl_contact_id": contact_id,
            "service_type": lead_data["service_type"],
            "status": "new",
            "address": lead_data["address"],
            "form_data": lead_data["form_data"],
            "contact_name": lead_data.get("contact_name", ""),
            "contact_phone": lead_data.get("contact_phone", ""),
            "contact_email": lead_data.get("contact_email", ""),
            "priority": lead_data.get("priority", "MEDIUM"),
            "tags": [],
            "created_at": now.isoformat(),
        }

        try:
            db.table("leads").insert(lead_row).execute()
            asyncio.create_task(process_lead(lead_id, lead_data))
            existing_ids.add(contact_id)
            imported += 1
        except Exception as e:
            logger.error(f"Poll import failed for {contact_id}: {e}")

    # Update sync cursor
    db.table("sync_state").update({
        "last_sync_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }).eq("id", "ghl_poll").execute()

    if imported > 0:
        logger.info(f"GHL poll: imported {imported} new contacts")
