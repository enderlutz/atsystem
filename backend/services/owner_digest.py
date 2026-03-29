"""
Background worker: sends Alan a periodic SMS digest summarizing automation activity.
Runs every 30 minutes. Skips if nothing happened or during quiet hours (10 PM – 6 AM Central).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

CENTRAL_TZ = ZoneInfo("America/Chicago")
DIGEST_INTERVAL = 1800  # 30 minutes


async def poll_owner_digest():
    """Background loop: every 30 min, send Alan a summary of automation activity."""
    await asyncio.sleep(30)  # Let app finish startup
    logger.info("Owner digest worker started (every 30 minutes)")

    while True:
        try:
            _send_digest_if_needed()
        except Exception as e:
            logger.error(f"Owner digest error: {e}")

        await asyncio.sleep(DIGEST_INTERVAL)


def _send_digest_if_needed():
    from db import get_db
    from config import get_settings
    from services.ghl import send_message_to_contact

    settings = get_settings()
    if not settings.owner_ghl_contact_id:
        return

    # Quiet hours: 10 PM – 6 AM Central
    now_central = datetime.now(CENTRAL_TZ)
    if now_central.hour < 6 or now_central.hour >= 22:
        return

    db = get_db()

    # Get last digest timestamp from workflow_config
    cfg_res = db.table("workflow_config").select("value").eq("key", "owner_digest_last_sent_at").execute()
    if cfg_res.data:
        last_sent = cfg_res.data[0]["value"]
    else:
        # First run — only look back 30 minutes
        last_sent = (datetime.now(timezone.utc) - timedelta(seconds=DIGEST_INTERVAL)).isoformat()

    # Query automation_log for sms_sent and sms_failed events since last digest
    events_res = (
        db.table("automation_log")
        .select("lead_id, event_type, detail, metadata")
        .in_("event_type", ["sms_sent", "sms_failed"])
        .gt("created_at", last_sent)
        .order("created_at")
        .execute()
    )

    events = events_res.data or []
    if not events:
        # Update timestamp even if nothing happened, so we don't re-scan old events
        _update_last_sent(db)
        return

    # Group by lead
    leads: dict[str, dict] = {}
    fail_count = 0
    for evt in events:
        lid = evt["lead_id"]
        if lid not in leads:
            leads[lid] = {"sent": 0, "failed": 0, "stages": set()}
        if evt["event_type"] == "sms_sent":
            leads[lid]["sent"] += 1
        else:
            leads[lid]["failed"] += 1
            fail_count += 1
        stage = (evt.get("metadata") or {}).get("stage", "")
        if stage:
            leads[lid]["stages"].add(stage.replace("_", " "))

    # Look up contact names
    lead_ids = list(leads.keys())
    names_res = db.table("leads").select("id, contact_name").in_("id", lead_ids).execute()
    name_map = {r["id"]: r.get("contact_name") or "Unknown" for r in (names_res.data or [])}

    total_sent = sum(l["sent"] for l in leads.values())
    total_failed = sum(l["failed"] for l in leads.values())

    # Build message
    lines = [f"📊 Automation Update ({len(leads)} lead{'s' if len(leads) != 1 else ''}, {total_sent} SMS sent):\n"]

    # Show up to 8 leads to keep SMS under ~500 chars
    shown = 0
    for lid, info in leads.items():
        if shown >= 8:
            remaining = len(leads) - shown
            lines.append(f"...and {remaining} more lead{'s' if remaining != 1 else ''}")
            break
        name = name_map.get(lid, "Unknown").split()[0]  # First name only
        stage_text = ", ".join(sorted(info["stages"]))[:40] if info["stages"] else ""
        count_text = f"{info['sent']} sent"
        if info["failed"]:
            count_text += f", {info['failed']} failed"
        line = f"• {name}: {count_text}"
        if stage_text:
            line += f" ({stage_text})"
        lines.append(line)
        shown += 1

    if total_failed:
        lines.append(f"\n⚠️ {total_failed} message{'s' if total_failed != 1 else ''} failed to deliver")

    msg = "\n".join(lines)
    sent = send_message_to_contact(settings.owner_ghl_contact_id, msg)
    if sent:
        logger.info(f"Owner digest sent: {total_sent} SMS across {len(leads)} leads")
    else:
        logger.warning("Failed to send owner digest SMS")

    _update_last_sent(db)


def _update_last_sent(db):
    now = datetime.now(timezone.utc).isoformat()
    db.table("workflow_config").upsert({
        "key": "owner_digest_last_sent_at",
        "value": now,
    }).execute()
