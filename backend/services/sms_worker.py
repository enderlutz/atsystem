"""
Background workers for the SMS workflow engine.
1. poll_sms_queue — sends due messages every 60 seconds
2. poll_stage_timeouts — checks for time-based auto-transitions every 5 minutes
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

SMS_WORKER_INTERVAL = 60       # seconds
TIMEOUT_CHECK_INTERVAL = 300   # 5 minutes


async def poll_sms_queue():
    """Background loop: every 60 seconds, send all due SMS messages."""
    await asyncio.sleep(10)  # Let app finish startup
    logger.info("SMS worker started (every 60 seconds)")

    while True:
        try:
            _process_pending_messages()
        except Exception as e:
            logger.error(f"SMS worker error: {e}")

        await asyncio.sleep(SMS_WORKER_INTERVAL)


def _process_pending_messages():
    from db import get_db
    from services.ghl import send_message_to_contact

    db = get_db()
    now = datetime.now(timezone.utc).isoformat()

    # Fetch pending messages that are due
    res = (
        db.table("sms_queue")
        .select("*")
        .eq("status", "pending")
        .lte("send_at", now)
        .order("send_at")
        .limit(50)
        .execute()
    )

    messages = res.data or []
    if not messages:
        return

    logger.info(f"SMS worker: processing {len(messages)} due messages")

    for msg in messages:
        try:
            # Check if lead is paused
            lead_res = (
                db.table("leads")
                .select("workflow_paused, workflow_stage")
                .eq("id", msg["lead_id"])
                .single()
                .execute()
            )

            if not lead_res.data:
                _update_message_status(db, msg["id"], "cancelled", cancel_reason="lead_not_found")
                continue

            if lead_res.data.get("workflow_paused"):
                # Don't cancel — just skip. Will send when resumed.
                continue

            # Check stage still matches (don't send messages from old stages)
            if lead_res.data.get("workflow_stage") != msg["stage"]:
                _update_message_status(db, msg["id"], "cancelled", cancel_reason="stage_changed")
                continue

            # Send via GHL
            sent = send_message_to_contact(msg["ghl_contact_id"], msg["message_body"])

            if sent:
                _update_message_status(db, msg["id"], "sent")
                logger.info(
                    f"SMS worker: sent message {msg['id']} to {msg['ghl_contact_id']} "
                    f"(stage: {msg['stage']}, seq: {msg['sequence_index']})"
                )
            else:
                _update_message_status(db, msg["id"], "failed", error="GHL send_message returned false")
                logger.warning(f"SMS worker: GHL send failed for message {msg['id']}")

        except Exception as e:
            _update_message_status(db, msg["id"], "failed", error=str(e)[:500])
            logger.error(f"SMS worker: error processing message {msg['id']}: {e}")


def _update_message_status(
    db, msg_id: str, status: str,
    cancel_reason: str = "", error: str = "",
):
    now = datetime.now(timezone.utc).isoformat()
    update: dict = {"status": status}

    if status == "sent":
        update["sent_at"] = now
    elif status == "cancelled":
        update["cancelled_at"] = now
        update["cancel_reason"] = cancel_reason
    elif status == "failed":
        update["error_message"] = error

    db.table("sms_queue").update(update).eq("id", msg_id).execute()


# ── Stage timeout checker ─────────────────────────────────────────────


async def poll_stage_timeouts():
    """Background loop: check for time-based auto-transitions every 5 minutes."""
    await asyncio.sleep(60)  # Let app finish startup
    logger.info("Stage timeout checker started (every 5 minutes)")

    while True:
        try:
            _check_timeouts()
        except Exception as e:
            logger.error(f"Stage timeout checker error: {e}")

        await asyncio.sleep(TIMEOUT_CHECK_INTERVAL)


def _check_timeouts():
    from db import get_db
    from services.workflow import Stage, transition_stage, enqueue_stage_messages
    from services.templates import (
        render_message,
        DEPOSIT_PAID_DAY_BEFORE_TEMPLATE,
        DEPOSIT_PAID_JOB_DAY_TEMPLATE,
    )

    db = get_db()
    now = datetime.now(timezone.utc)

    # 1. NO_PACKAGE > 7 days → COLD_NURTURE
    cutoff_7d = (now - timedelta(days=7)).isoformat()
    no_pkg_res = (
        db.table("leads")
        .select("id")
        .eq("workflow_stage", Stage.NO_PACKAGE.value)
        .eq("workflow_paused", False)
        .lt("workflow_stage_entered_at", cutoff_7d)
        .execute()
    )
    for lead in (no_pkg_res.data or []):
        logger.info(f"Timeout: lead {lead['id']} in NO_PACKAGE > 7 days → COLD_NURTURE")
        transition_stage(lead["id"], Stage.COLD_NURTURE, reason="no_package_timeout_7d")

    # 2. JOB_COMPLETE > 14 days → PAST_CUSTOMER
    cutoff_14d = (now - timedelta(days=14)).isoformat()
    job_res = (
        db.table("leads")
        .select("id")
        .eq("workflow_stage", Stage.JOB_COMPLETE.value)
        .eq("workflow_paused", False)
        .lt("workflow_stage_entered_at", cutoff_14d)
        .execute()
    )
    for lead in (job_res.data or []):
        logger.info(f"Timeout: lead {lead['id']} in JOB_COMPLETE > 14 days → PAST_CUSTOMER")
        transition_stage(lead["id"], Stage.PAST_CUSTOMER, reason="job_complete_timeout_14d")

    # 3. DEPOSIT_PAID: schedule day-before and job-day reminders
    # Find leads in DEPOSIT_PAID that have a booked_at date
    deposit_res = (
        db.table("leads")
        .select("id, ghl_contact_id, contact_name, address")
        .eq("workflow_stage", Stage.DEPOSIT_PAID.value)
        .eq("workflow_paused", False)
        .execute()
    )

    for lead in (deposit_res.data or []):
        _schedule_booking_reminders(db, lead, now)


def _schedule_booking_reminders(db, lead: dict, now: datetime):
    """Schedule day-before and job-day reminders for DEPOSIT_PAID leads."""
    from services.templates import (
        render_message,
        DEPOSIT_PAID_DAY_BEFORE_TEMPLATE,
        DEPOSIT_PAID_JOB_DAY_TEMPLATE,
    )
    import uuid as uuid_mod

    lead_id = lead["id"]

    # Get the proposal's booked_at date
    prop_res = (
        db.table("proposals")
        .select("booked_at")
        .eq("lead_id", lead_id)
        .eq("status", "booked")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not prop_res.data or not prop_res.data[0].get("booked_at"):
        return

    try:
        booked_at = datetime.fromisoformat(
            prop_res.data[0]["booked_at"].replace("Z", "+00:00")
        )
    except ValueError:
        return

    name = (lead.get("contact_name") or "").strip()
    first_name = name.split()[0] if name else "there"
    context = {
        "first_name": first_name,
        "address": lead.get("address") or "",
    }

    # Day-before reminder: 6 PM the day before the job
    day_before = booked_at.replace(hour=18, minute=0, second=0) - timedelta(days=1)
    if day_before > now:
        _schedule_if_not_exists(
            db, lead_id, "deposit_paid", 10,
            render_message(DEPOSIT_PAID_DAY_BEFORE_TEMPLATE, context),
            day_before, lead.get("ghl_contact_id", ""),
        )

    # Job-day morning: 7 AM on the job day
    job_morning = booked_at.replace(hour=7, minute=0, second=0)
    if job_morning > now:
        _schedule_if_not_exists(
            db, lead_id, "deposit_paid", 11,
            render_message(DEPOSIT_PAID_JOB_DAY_TEMPLATE, context),
            job_morning, lead.get("ghl_contact_id", ""),
        )


def _schedule_if_not_exists(
    db, lead_id: str, stage: str, seq_index: int,
    message_body: str, send_at: datetime, ghl_contact_id: str,
):
    """Only insert if no pending message exists for this lead/stage/sequence."""
    import uuid as uuid_mod

    existing = (
        db.table("sms_queue")
        .select("id")
        .eq("lead_id", lead_id)
        .eq("stage", stage)
        .eq("sequence_index", seq_index)
        .eq("status", "pending")
        .execute()
    )
    if existing.data:
        return  # Already scheduled

    db.table("sms_queue").insert({
        "id": str(uuid_mod.uuid4()),
        "lead_id": lead_id,
        "stage": stage,
        "sequence_index": seq_index,
        "message_body": message_body,
        "send_at": send_at.isoformat(),
        "ghl_contact_id": ghl_contact_id,
        "status": "pending",
    }).execute()
