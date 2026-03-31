"""
Background workers for the SMS workflow engine.
1. poll_sms_queue — sends due messages every 60 seconds
2. poll_stage_timeouts — checks for time-based auto-transitions every 5 minutes
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

CENTRAL_TZ = ZoneInfo("America/Chicago")

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
            # Check if lead is paused + get location for SMS routing
            lead_res = (
                db.table("leads")
                .select("workflow_paused, workflow_stage, ghl_location_id")
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

            # TEMPORARY: Skip follow-up messages (sequence_index > 0) — only first messages allowed
            if msg.get("sequence_index", 0) > 0:
                _update_message_status(db, msg["id"], "cancelled", cancel_reason="followups_disabled")
                logger.info(f"SMS worker: cancelled follow-up msg {msg['id']} (follow-ups disabled)")
                continue

            # Check stage still matches (don't send messages from old stages)
            if lead_res.data.get("workflow_stage") != msg["stage"]:
                _update_message_status(db, msg["id"], "cancelled", cancel_reason="stage_changed")
                continue

            # Quiet hours: non-immediate messages only send 6 AM – 10 PM Central.
            # A message is "immediate" if send_at is within 2 minutes of created_at.
            created = datetime.fromisoformat(msg["created_at"].replace("Z", "+00:00"))
            scheduled = datetime.fromisoformat(msg["send_at"].replace("Z", "+00:00"))
            was_immediate = abs((scheduled - created).total_seconds()) < 120

            if not was_immediate:
                now_central = datetime.now(CENTRAL_TZ)
                if now_central.hour < 6 or now_central.hour >= 22:
                    next_6am = now_central.replace(hour=6, minute=0, second=0, microsecond=0)
                    if now_central.hour >= 22:
                        next_6am += timedelta(days=1)
                    new_send_at = next_6am.astimezone(timezone.utc).isoformat()
                    db.table("sms_queue").update({"send_at": new_send_at}).eq("id", msg["id"]).execute()
                    logger.info(f"SMS worker: deferred msg {msg['id']} to 6 AM Central (quiet hours)")
                    continue

            # WF5/WF6/WF7/WF8: For proposal-driven stages, wait N min after customer leaves the page
            PROPOSAL_EXIT_GATE_SECONDS = {
                "no_package_selection": 1200,  # 20 minutes
                "package_selected":     1200,  # 20 minutes
                "no_date_selected":      900,  # 15 minutes
                "date_selected":         900,  # 15 minutes
            }
            if (
                msg["stage"] in PROPOSAL_EXIT_GATE_SECONDS
                and msg["sequence_index"] == 0
            ):
                gate_seconds = PROPOSAL_EXIT_GATE_SECONDS[msg["stage"]]
                prop_res_ps = (
                    db.table("proposals")
                    .select("last_active_at, left_page_at")
                    .eq("lead_id", msg["lead_id"])
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                if prop_res_ps.data:
                    left_at = prop_res_ps.data[0].get("left_page_at")

                    if not left_at:
                        # Customer hasn't left the page yet — defer by 1 min and check again
                        new_send_at = (datetime.now(timezone.utc) + timedelta(minutes=1)).isoformat()
                        db.table("sms_queue").update({"send_at": new_send_at}).eq("id", msg["id"]).execute()
                        logger.info(f"SMS worker: deferred {msg['stage']} msg {msg['id']} — customer still on page")
                        continue

                    try:
                        left_dt = datetime.fromisoformat(left_at.replace("Z", "+00:00"))
                        since_left = (datetime.now(timezone.utc) - left_dt).total_seconds()
                        if since_left < gate_seconds:
                            wait = int(gate_seconds - since_left) + 5  # small buffer
                            new_send_at = (datetime.now(timezone.utc) + timedelta(seconds=wait)).isoformat()
                            db.table("sms_queue").update({"send_at": new_send_at}).eq("id", msg["id"]).execute()
                            logger.info(f"SMS worker: deferred {msg['stage']} msg {msg['id']} — customer left {int(since_left)}s ago, waiting for {gate_seconds // 60} min")
                            continue
                    except ValueError:
                        pass

            # Multi-instance claim guard: atomically mark as sent_at=now while still pending.
            # If another instance already changed status, this returns no rows.
            claim_ts = datetime.now(timezone.utc).isoformat()
            claim_res = (
                db.table("sms_queue")
                .update({"sent_at": claim_ts})
                .eq("id", msg["id"])
                .eq("status", "pending")
                .execute()
            )
            if not claim_res.data:
                logger.info(f"SMS worker: msg {msg['id']} already claimed or cancelled, skipping")
                continue

            # Race condition guard: re-check stage right before sending
            recheck = db.table("leads").select("workflow_stage").eq("id", msg["lead_id"]).single().execute()
            if recheck.data and recheck.data.get("workflow_stage") != msg["stage"]:
                _update_message_status(db, msg["id"], "cancelled", cancel_reason="stage_changed_at_send")
                continue

            # Sent-recently guard: skip if identical message sent to this contact in last 5 min
            five_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
            recent_sent = (
                db.table("sms_queue")
                .select("id, sent_at")
                .eq("ghl_contact_id", msg["ghl_contact_id"])
                .eq("status", "sent")
                .eq("message_body", msg["message_body"])
                .order("sent_at", desc=True)
                .limit(1)
                .execute()
            )
            if recent_sent.data and (recent_sent.data[0].get("sent_at", "") > five_min_ago):
                _update_message_status(db, msg["id"], "cancelled", cancel_reason="duplicate_body_recently_sent")
                logger.warning(f"SMS worker: skipping msg {msg['id']} — identical message sent in last 5 min")
                continue

            # Get attachments for this message (if any)
            from services.templates import get_message_attachments
            from config import get_settings
            settings = get_settings()
            attach_context = {"proposal_base_url": settings.proposal_base_url or settings.frontend_url or ""}

            # Determine branch for package_selected stage
            attach_branch = None
            if msg["stage"] == "package_selected":
                prop_res = db.table("proposals").select("selected_tier").eq("lead_id", msg["lead_id"]).order("created_at", desc=True).limit(1).execute()
                if prop_res.data:
                    attach_branch = prop_res.data[0].get("selected_tier") or "signature"

            attachments = get_message_attachments(msg["stage"], msg["sequence_index"], attach_context, branch=attach_branch)

            # Send via GHL — use the lead's location for multi-location routing
            lead_location_id = lead_res.data.get("ghl_location_id") if lead_res.data else None
            sent = send_message_to_contact(msg["ghl_contact_id"], msg["message_body"], attachments=attachments or None, location_id=lead_location_id)

            if sent:
                _update_message_status(db, msg["id"], "sent")
                logger.info(
                    f"SMS worker: sent message {msg['id']} to {msg['ghl_contact_id']} "
                    f"(stage: {msg['stage']}, seq: {msg['sequence_index']})"
                )
                from services.activity_log import log_event
                preview = msg["message_body"][:80] + ("..." if len(msg["message_body"]) > 80 else "")
                log_event(msg["lead_id"], "sms_sent", f"Sent SMS: {preview}", {"stage": msg["stage"], "sequence_index": msg["sequence_index"]})
            else:
                _handle_send_failure(db, msg, "GHL send_message returned false")

        except Exception as e:
            _handle_send_failure(db, msg, str(e)[:500])


MAX_SEND_ATTEMPTS = 3
RETRY_DELAYS = [300, 900]  # 5 min, then 15 min before final failure


def _handle_send_failure(db, msg: dict, error: str):
    """Handle a failed SMS send with retry logic (up to 3 attempts)."""
    from services.activity_log import log_event

    # Track attempts via error_message prefix: "attempt:N|actual error"
    prev_error = msg.get("error_message") or ""
    if prev_error.startswith("attempt:"):
        try:
            attempt = int(prev_error.split("|")[0].split(":")[1]) + 1
        except (IndexError, ValueError):
            attempt = 2
    else:
        attempt = 1

    if attempt < MAX_SEND_ATTEMPTS:
        # Retry: reset status to pending, push send_at forward
        retry_delay = RETRY_DELAYS[attempt - 1] if attempt - 1 < len(RETRY_DELAYS) else 900
        new_send_at = (datetime.now(timezone.utc) + timedelta(seconds=retry_delay)).isoformat()
        db.table("sms_queue").update({
            "status": "pending",
            "sent_at": None,
            "error_message": f"attempt:{attempt}|{error}",
            "send_at": new_send_at,
        }).eq("id", msg["id"]).execute()
        logger.warning(
            f"SMS worker: send failed for msg {msg['id']} (attempt {attempt}/{MAX_SEND_ATTEMPTS}), "
            f"retrying in {retry_delay}s — {error}"
        )
        log_event(msg["lead_id"], "sms_retry", f"SMS send failed (attempt {attempt}), retrying in {retry_delay // 60}min", {"stage": msg["stage"], "error": error})
    else:
        # Final failure after all retries exhausted
        _update_message_status(db, msg["id"], "failed", error=f"attempt:{attempt}|{error}")
        logger.error(f"SMS worker: msg {msg['id']} permanently failed after {attempt} attempts — {error}")
        log_event(msg["lead_id"], "sms_failed", f"SMS permanently failed after {attempt} attempts", {"stage": msg["stage"], "error": error})


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
    )

    db = get_db()
    now = datetime.now(timezone.utc)

    # 0. PROPOSAL_SENT > 15 min with no package selected → NO_PACKAGE
    cutoff_15m = (now - timedelta(minutes=15)).isoformat()
    proposal_sent_res = (
        db.table("leads")
        .select("id")
        .eq("workflow_stage", Stage.PROPOSAL_SENT.value)
        .eq("workflow_paused", False)
        .lt("workflow_stage_entered_at", cutoff_15m)
        .execute()
    )
    for lead in (proposal_sent_res.data or []):
        prop = (
            db.table("proposals")
            .select("selected_tier")
            .eq("lead_id", lead["id"])
            .neq("status", "booked")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if prop.data and not prop.data[0].get("selected_tier"):
            logger.info(
                f"Timeout: lead {lead['id']} in PROPOSAL_SENT > 15 min, "
                f"no package selected → NO_PACKAGE"
            )
            transition_stage(
                lead["id"], Stage.NO_PACKAGE, reason="no_package_15min_timeout"
            )

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
        logger.error(f"Booking reminders: malformed booked_at for lead {lead['id']}: {prop_res.data[0].get('booked_at')}")
        return

    name = (lead.get("contact_name") or "").strip()
    first_name = name.split()[0] if name else "there"
    context = {
        "first_name": first_name,
        "address": lead.get("address") or "",
    }

    # Convert booked_at to Central time for scheduling
    booked_central = booked_at.astimezone(CENTRAL_TZ)

    # Day-before reminder: 6 PM Central the day before the job
    day_before_central = booked_central.replace(hour=18, minute=0, second=0) - timedelta(days=1)
    day_before_utc = day_before_central.astimezone(timezone.utc)
    if day_before_utc > now:
        _schedule_if_not_exists(
            db, lead_id, "deposit_paid", 10,
            render_message(DEPOSIT_PAID_DAY_BEFORE_TEMPLATE, context),
            day_before_utc, lead.get("ghl_contact_id", ""),
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
