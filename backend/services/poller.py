"""
GHL Pipeline Poller — runs every 5 minutes to keep leads in sync with GHL.
Imports new pipeline leads and refreshes data for existing ones.

Message Sync Poller — runs every 5 minutes as a safety net.
Fetches recent conversations location-wide (2 API calls total) and backfills
any inbound messages the webhook may have missed. Ensures speed-to-lead is
maintained even during server restarts or transient webhook failures.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 60        # 1 minute — near-instant lead sync
MESSAGE_SYNC_INTERVAL_SECONDS = 120  # 2 minutes
MESSAGE_SYNC_LOOKBACK_MINUTES = 10   # check last 10 min for missed messages
CONTACTS_CACHE_CHECK_INTERVAL = 3600     # Check every hour
CONTACTS_CACHE_MAX_AGE_DAYS = 3          # Re-sync if older than 3 days


async def poll_ghl_contacts():
    """Background loop: sync the GHL pipeline into the dashboard every 5 minutes."""
    await asyncio.sleep(5)  # Let app finish startup
    logger.info("GHL pipeline poller started (every 60 seconds)")

    while True:
        try:
            from api.sync import run_pipeline_sync
            from config import get_settings
            settings = get_settings()

            # Sync primary location (Cypress)
            result = await run_pipeline_sync(location_label=settings.ghl_location_1_label)
            if result.get("status") == "done":
                logger.info(
                    f"Auto-sync complete: {result['imported']} imported, "
                    f"{result['updated']} updated, {result['errors']} errors"
                )
            else:
                logger.warning(f"Auto-sync issue: {result.get('message', result)}")

            # NOTE: Cypress "FENCE STAINING NEW AUTOMATION FLOW" sync disabled — all leads imported.
            # Uncomment to re-enable if needed.

            # Sync secondary location (Woodlands) if configured
            if settings.ghl_location_id_2:
                try:
                    from api.sync import WOODLANDS_TARGET_STAGES
                    result2 = await run_pipeline_sync(
                        location_id=settings.ghl_location_id_2,
                        pipeline_name=settings.ghl_location_2_pipeline,
                        location_label=settings.ghl_location_2_label,
                        target_stages=WOODLANDS_TARGET_STAGES,
                        skip_automations=False,
                        default_kanban_column="woodlands",
                    )
                    if result2.get("status") == "done":
                        logger.info(
                            f"Auto-sync ({settings.ghl_location_2_label}): {result2['imported']} imported, "
                            f"{result2['updated']} updated, {result2['errors']} errors"
                        )
                    else:
                        logger.warning(f"Auto-sync ({settings.ghl_location_2_label}) issue: {result2.get('message', result2)}")
                except Exception as e2:
                    logger.error(f"GHL pipeline poll error ({settings.ghl_location_2_label}): {e2}")
        except Exception as e:
            logger.error(f"GHL pipeline poll error: {e}")

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def sync_recent_messages():
    """Background loop: catch any inbound messages the webhook missed.

    Strategy: fetch the 20 most recently active conversations location-wide
    (2 GHL API calls total), filter to inbound messages in the last 10 minutes,
    and backfill anything not already in our messages table.

    If a new message is found, triggers the workflow engine exactly as the
    webhook would — ensuring speed-to-lead is never compromised by a missed webhook.
    """
    await asyncio.sleep(15)  # Slight offset from contact poller startup
    logger.info("Message sync poller started (every 5 minutes)")

    while True:
        try:
            _run_message_sync()
            # Also sync Woodlands messages if configured
            from config import get_settings as _get_settings
            _s = _get_settings()
            if _s.ghl_location_id_2:
                _run_message_sync(location_id=_s.ghl_location_id_2)
        except Exception as e:
            logger.error(f"Message sync poll error: {e}")

        await asyncio.sleep(MESSAGE_SYNC_INTERVAL_SECONDS)


def _run_message_sync(location_id: str | None = None) -> None:
    from db import get_db
    from config import get_settings
    from services.ghl import get_recent_location_conversations, get_conversation_messages_by_id

    settings = get_settings()
    db = get_db()
    loc_id = location_id or settings.ghl_location_id
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=MESSAGE_SYNC_LOOKBACK_MINUTES)

    # 1 API call — get the most recently active conversations across the location
    conversations = get_recent_location_conversations(loc_id, limit=20)
    if not conversations:
        return

    new_messages_found = 0

    for conv in conversations:
        # Conversations are sorted newest-first — stop once we pass the cutoff
        last_msg_date_raw = conv.get("lastMessageDate") or conv.get("dateUpdated") or ""
        if last_msg_date_raw:
            try:
                if isinstance(last_msg_date_raw, (int, float)):
                    last_msg_dt = datetime.fromtimestamp(last_msg_date_raw / 1000 if last_msg_date_raw > 1e12 else last_msg_date_raw, tz=timezone.utc)
                else:
                    last_msg_dt = datetime.fromisoformat(str(last_msg_date_raw).replace("Z", "+00:00"))
                if last_msg_dt < cutoff:
                    break
            except ValueError:
                pass

        # Only care about conversations whose last message was inbound
        if conv.get("lastMessageDirection") not in ("inbound", "incoming"):
            continue

        contact_id = conv.get("contactId") or conv.get("contact_id")
        conv_id = conv.get("id")
        if not contact_id or not conv_id:
            continue

        # Look up the lead
        lead_res = db.table("leads").select("id").eq("ghl_contact_id", contact_id).single().execute()
        if not lead_res.data:
            continue
        lead_id = lead_res.data["id"]

        # 1 API call per conversation with recent inbound activity
        messages = get_conversation_messages_by_id(conv_id)
        if not messages:
            continue

        latest_new_body: str | None = None

        for msg in messages:
            direction = msg.get("direction", "")
            if direction not in ("inbound", "incoming"):
                continue

            date_raw = msg.get("dateAdded") or msg.get("createdAt") or ""
            try:
                if isinstance(date_raw, (int, float)):
                    msg_dt = datetime.fromtimestamp(date_raw / 1000 if date_raw > 1e12 else date_raw, tz=timezone.utc)
                else:
                    msg_dt = datetime.fromisoformat(str(date_raw).replace("Z", "+00:00"))
                if msg_dt < cutoff:
                    continue
            except ValueError:
                continue

            ghl_message_id = msg.get("id") or msg.get("messageId")
            body = msg.get("body") or msg.get("message") or ""

            # Dedup — skip if already in our DB
            if ghl_message_id:
                exists = db.table("messages").select("id").eq("ghl_message_id", ghl_message_id).execute()
                if exists.data:
                    continue

            # New message the webhook missed — store it
            msg_row = {
                "ghl_contact_id": contact_id,
                "lead_id": lead_id,
                "direction": "inbound",
                "body": body,
                "message_type": msg.get("messageType") or "SMS",
                "date_added": msg_dt.isoformat(),
            }
            if ghl_message_id:
                db.table("messages").upsert(
                    {**msg_row, "ghl_message_id": ghl_message_id},
                    on_conflict="ghl_message_id",
                ).execute()
            else:
                db.table("messages").insert(msg_row).execute()

            # Mark lead as responded
            db.table("leads").update({
                "customer_responded": True,
                "customer_response_text": body[:500],
            }).eq("id", lead_id).execute()

            latest_new_body = body
            new_messages_found += 1
            logger.info(f"Message sync: backfilled missed inbound from contact {contact_id} (lead {lead_id})")

        # Fire workflow once per lead using the latest new message
        if latest_new_body is not None:
            try:
                from services.workflow import on_customer_reply
                on_customer_reply(lead_id, latest_new_body)
            except Exception as e:
                logger.error(f"Message sync: workflow trigger failed for lead {lead_id}: {e}")

    if new_messages_found:
        logger.info(f"Message sync: backfilled {new_messages_found} missed message(s)")


async def sync_ghl_contacts_cache():
    """Background loop: keep the ghl_contacts cache fresh (re-sync every 3 days)."""
    await asyncio.sleep(20)  # Offset from other pollers
    logger.info("GHL contacts cache poller started (checks every hour, syncs every 3 days)")

    while True:
        try:
            from db import get_conn
            needs_sync = False

            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT MAX(synced_at) FROM ghl_contacts")
                    row = cur.fetchone()
                    last_synced = row[0] if row else None

            if not last_synced:
                logger.info("Contacts cache: never synced — triggering initial sync")
                needs_sync = True
            else:
                age = datetime.now(timezone.utc) - last_synced
                if age > timedelta(days=CONTACTS_CACHE_MAX_AGE_DAYS):
                    logger.info(f"Contacts cache: last synced {age.days}d ago — triggering refresh")
                    needs_sync = True

            if needs_sync:
                from api.contacts import run_contacts_sync
                result = run_contacts_sync()
                logger.info(f"Contacts cache synced: {result['total_upserted']} upserted, {result['marked_imported']} marked imported")
        except Exception as e:
            logger.error(f"Contacts cache sync error: {e}")

        await asyncio.sleep(CONTACTS_CACHE_CHECK_INTERVAL)


# NOTE: poll_proposal_follow_ups has been removed.
# Follow-up SMS is now handled by the workflow engine (services/sms_worker.py).
