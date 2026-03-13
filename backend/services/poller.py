"""
GHL Pipeline Poller — runs every 5 minutes to keep leads in sync with GHL.
Imports new pipeline leads and refreshes data for existing ones.

Also runs a follow-up SMS loop every 30 minutes:
- 2 hours after a proposal is "viewed" (but not booked), send a follow-up text.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 300   # 5 minutes
FOLLOW_UP_INTERVAL_SECONDS = 1800  # 30 minutes
FOLLOW_UP_DELAY_HOURS = 2


async def poll_ghl_contacts():
    """Background loop: sync the GHL pipeline into the dashboard every 5 minutes."""
    await asyncio.sleep(5)  # Let app finish startup
    logger.info("GHL pipeline poller started (every 5 minutes)")

    while True:
        try:
            from api.sync import run_pipeline_sync
            result = await run_pipeline_sync()
            if result.get("status") == "done":
                logger.info(
                    f"Auto-sync complete: {result['imported']} imported, "
                    f"{result['updated']} updated, {result['errors']} errors"
                )
            else:
                logger.warning(f"Auto-sync issue: {result.get('message', result)}")
        except Exception as e:
            logger.error(f"GHL pipeline poll error: {e}")

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def poll_proposal_follow_ups():
    """Background loop: send follow-up SMS to customers who viewed but haven't booked."""
    await asyncio.sleep(30)  # Let app finish startup
    logger.info("Proposal follow-up poller started (every 30 minutes)")

    while True:
        try:
            _send_proposal_follow_ups()
        except Exception as e:
            logger.error(f"Proposal follow-up poll error: {e}")

        await asyncio.sleep(FOLLOW_UP_INTERVAL_SECONDS)


def _send_proposal_follow_ups():
    from db import get_db
    from config import get_settings
    from services.ghl import send_message_to_contact

    db = get_db()
    settings = get_settings()
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=FOLLOW_UP_DELAY_HOURS)).isoformat()

    # Find proposals that are "viewed" (not booked), updated > 2 hours ago, no follow-up sent yet
    res = (
        db.table("proposals")
        .select("token, lead_id, updated_at")
        .eq("status", "viewed")
        .is_("follow_up_sent_at", "null")
        .lt("updated_at", cutoff)
        .execute()
    )

    proposals = res.data or []
    if not proposals:
        return

    logger.info(f"Follow-up: found {len(proposals)} proposals to follow up on")

    for proposal in proposals:
        try:
            lead_res = db.table("leads").select("contact_name, ghl_contact_id").eq("id", proposal["lead_id"]).single().execute()
            lead = lead_res.data or {}
            contact_id = lead.get("ghl_contact_id")
            if not contact_id:
                continue

            name = (lead.get("contact_name") or "").split()[0] or "there"
            msg = (
                f"Hi {name}! Just checking in — did you get a chance to review your fence restoration proposal? "
                f"Feel free to reply with any questions or go ahead and book your appointment directly from the link. "
                f"We'd love to get you on the schedule! 🏡"
            )

            sent = send_message_to_contact(contact_id, msg)
            if sent:
                db.table("proposals").update({
                    "follow_up_sent_at": now.isoformat(),
                }).eq("token", proposal["token"]).execute()
                logger.info(f"Follow-up sent for proposal {proposal['token']} (lead {proposal['lead_id']})")
            else:
                logger.warning(f"Failed to send follow-up for proposal {proposal['token']}")
        except Exception as e:
            logger.error(f"Follow-up error for proposal {proposal['token']}: {e}")
