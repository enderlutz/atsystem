"""
Core workflow engine for the 13-stage GHL pipeline automation.
Manages stage transitions, message scheduling, and GHL pipeline sync.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta
from enum import Enum

from db import get_db
from config import get_settings
from services.ghl import send_message_to_contact, update_opportunity_stage
from services.templates import get_stage_messages, render_message, get_current_season, get_current_month_name
from services.activity_log import log_event

logger = logging.getLogger(__name__)


class Stage(str, Enum):
    NEW_LEAD = "new_lead"
    NEW_BUILD = "new_build"
    ASKING_ADDRESS = "asking_address"
    HOT_LEAD = "hot_lead"
    PROPOSAL_SENT = "proposal_sent"
    NO_PACKAGE = "no_package_selection"
    PACKAGE_SELECTED = "package_selected"
    NO_DATE = "no_date_selected"
    DATE_SELECTED = "date_selected"
    DEPOSIT_PAID = "deposit_paid"
    ADDITIONAL_SERVICE = "additional_service"
    JOB_COMPLETE = "job_complete"
    COLD_NURTURE = "cold_nurture"
    PAST_CUSTOMER = "past_customer"


# Human-readable labels for dashboard display
STAGE_LABELS: dict[str, str] = {
    "new_lead": "New Lead",
    "new_build": "New Build – Asking for Photos",
    "asking_address": "Asking for Address",
    "hot_lead": "Hot Lead",
    "proposal_sent": "Proposal Sent",
    "no_package_selection": "No Package Selection",
    "package_selected": "Package Selected",
    "no_date_selected": "No Date Selected",
    "date_selected": "Date Selected",
    "deposit_paid": "Deposit Paid",
    "additional_service": "Additional Service",
    "job_complete": "Job Complete",
    "cold_nurture": "Cold Lead Nurture",
    "past_customer": "Past Customer",
}


# Known stain/color names (lowercase) for auto-detecting customer replies in PACKAGE_SELECTED stage.
# Derived from the HOA_COLOR_HEX dict in proposals.py + common gallery names.
KNOWN_COLORS: list[str] = [
    "adobe", "antique burgundy", "autumn fog", "autumn russet", "brickwood",
    "brown", "cedar", "cedar naturaltone", "cilantro", "classic buff",
    "clay angel", "coffee gelato", "corner café", "corner cafe", "cowboy boots",
    "cowboy suede", "desert sand", "dust bunny", "filtered shade", "forest canopy",
    "frappe", "gallery grey", "garden ochre", "gravity", "gray brook", "greige",
    "hazy stratus", "heirloom red", "high-speed steel", "honey gold", "hopsack",
    "khaki", "king's canyon", "kings canyon", "midnight shadow", "monticello tan",
    "mountain smoke", "mudslide", "natural cork", "navajo horizon", "notre dame",
    "nuance", "pale powder", "pitch cobalt", "porcelain shale", "quail egg",
    "redwood", "reindeer", "riverbed's edge", "rusticanna", "safari brown",
    "sahara sands", "savannah red", "scented candle", "seafoam storm", "sharkfin",
    "stampede", "standing still", "timber dust", "universal umber", "very black",
    "warm buff", "wedgwood blue",
    # Common short names customers might say
    "natural cedar", "dark walnut", "golden oak", "espresso", "driftwood",
    "silver gray", "weathered wood",
]


def _detect_color_in_message(text: str) -> str | None:
    """Try to detect a known stain color name in a customer's text reply."""
    text_lower = text.lower()
    # Prefer longer matches first to avoid partial matches (e.g. "cedar naturaltone" before "cedar")
    for color in sorted(KNOWN_COLORS, key=len, reverse=True):
        if color in text_lower:
            # Return title-cased version as the canonical color name
            return color.title()
    return None


def _get_workflow_config() -> dict[str, str]:
    """Load all workflow_config values from DB."""
    try:
        db = get_db()
        res = db.table("workflow_config").select("key, value").execute()
        return {r["key"]: r["value"] for r in (res.data or [])}
    except Exception:
        return {}


def _get_ghl_stage_map() -> dict[str, str]:
    """Load GHL pipeline stage ID mapping from workflow_config.
    Expects keys like 'ghl_stage_new_lead', 'ghl_stage_hot_lead', etc."""
    config = _get_workflow_config()
    result = {}
    for stage in Stage:
        key = f"ghl_stage_{stage.value}"
        if key in config and config[key]:
            result[stage.value] = config[key]
    return result


def _build_message_context(lead: dict, metadata: dict | None = None) -> dict:
    """Build template variable context from lead data and metadata."""
    metadata = metadata or {}
    config = _get_workflow_config()
    name = (lead.get("contact_name") or "").strip()
    first_name = name.split()[0] if name else "there"

    settings = get_settings()
    proposal_link = metadata.get("proposal_url") or ""

    return {
        "first_name": first_name,
        "proposal_link": proposal_link,
        "review_link": config.get("google_review_link", ""),
        "incentive": config.get("cold_lead_incentive", "a special offer"),
        "referral_bonus": config.get("referral_bonus", "a discount on your next service"),
        "date": metadata.get("booked_date", ""),
        "address": lead.get("address") or "",
        "stripe_link": metadata.get("stripe_link") or proposal_link,
        "month": get_current_month_name(),
        "season": get_current_season(),
        "selected_tier": metadata.get("selected_tier", "signature"),
        # Color chart placeholders — to be filled in via workflow_config
        "entry_color_name": config.get("entry_color_name", "our signature color"),
        "entry_color_link": config.get("entry_color_link", ""),
        "signature_color_chart": config.get("signature_color_chart", ""),
        "legacy_color_chart": config.get("legacy_color_chart", ""),
        "color_1": config.get("popular_color_1", "Natural Cedar"),
        "color_2": config.get("popular_color_2", "Dark Walnut"),
    }


def _get_proposal_url_for_lead(lead_id: str) -> str:
    """Look up the proposal URL for a lead, if one exists."""
    try:
        db = get_db()
        settings = get_settings()
        res = (
            db.table("proposals")
            .select("token")
            .eq("lead_id", lead_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if res.data:
            return f"{settings.proposal_base_url}/proposal/{res.data[0]['token']}"
    except Exception:
        pass
    return ""


def transition_stage(
    lead_id: str,
    new_stage: Stage,
    reason: str = "",
    metadata: dict | None = None,
) -> None:
    """
    Move a lead to a new workflow stage:
    1. Cancel all pending messages for the lead
    2. Update leads.workflow_stage
    3. Enqueue new stage's messages
    4. Sync GHL opportunity stage
    """
    metadata = metadata or {}
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()

    # Get current stage
    lead_res = db.table("leads").select(
        "workflow_stage, ghl_contact_id, contact_name, address, ghl_opportunity_id"
    ).eq("id", lead_id).single().execute()
    if not lead_res.data:
        logger.error(f"Workflow: lead {lead_id} not found")
        return

    lead = lead_res.data
    current_stage = lead.get("workflow_stage")

    # Don't re-enter the same stage
    if current_stage == new_stage.value:
        logger.info(f"Workflow: lead {lead_id} already in stage {new_stage.value}")
        return

    # 1. Cancel all pending messages
    cancelled = cancel_pending_messages(lead_id, reason=f"transition_to_{new_stage.value}")
    if cancelled:
        logger.info(f"Workflow: cancelled {cancelled} pending messages for lead {lead_id}")

    # 2. Update lead's workflow stage
    db.table("leads").update({
        "workflow_stage": new_stage.value,
        "workflow_stage_entered_at": now,
        "workflow_paused": False,
    }).eq("id", lead_id).execute()

    contact_name = lead.get("contact_name", "")
    logger.info(
        f"Workflow: lead {lead_id} transitioned "
        f"{current_stage or 'none'} -> {new_stage.value} (reason: {reason})"
    )
    log_event(
        lead_id, "stage_transition",
        f"{STAGE_LABELS.get(current_stage, current_stage or 'none')} → {STAGE_LABELS.get(new_stage.value, new_stage.value)}",
        {"from_stage": current_stage, "to_stage": new_stage.value, "reason": reason, "contact_name": contact_name},
    )

    # 3. Enqueue new stage's messages
    ghl_contact_id = lead.get("ghl_contact_id")
    if not ghl_contact_id:
        logger.warning(f"Workflow: lead {lead_id} has no ghl_contact_id — skipping message enqueue")
        return

    # Build context for templates
    if "proposal_url" not in metadata:
        metadata["proposal_url"] = _get_proposal_url_for_lead(lead_id)

    context = _build_message_context(lead, metadata)
    enqueue_stage_messages(lead_id, new_stage.value, ghl_contact_id, context, metadata)

    # 4. Sync GHL opportunity stage
    ghl_stage_map = _get_ghl_stage_map()
    ghl_stage_id = ghl_stage_map.get(new_stage.value)
    opp_id = lead.get("ghl_opportunity_id")
    if ghl_stage_id and opp_id:
        moved = update_opportunity_stage(opp_id, ghl_stage_id)
        if moved:
            logger.info(f"Workflow: GHL opportunity {opp_id} moved to stage {ghl_stage_id}")
        else:
            logger.warning(f"Workflow: failed to move GHL opportunity {opp_id}")


def enqueue_stage_messages(
    lead_id: str,
    stage: str,
    ghl_contact_id: str,
    context: dict,
    metadata: dict | None = None,
) -> int:
    """Enqueue all SMS messages for a stage. Returns count of messages enqueued."""
    metadata = metadata or {}
    messages = get_stage_messages(stage, metadata)
    if not messages:
        return 0

    db = get_db()

    # Dedup guard: skip if pending messages already exist for this lead+stage
    existing = (
        db.table("sms_queue")
        .select("id")
        .eq("lead_id", lead_id)
        .eq("stage", stage)
        .eq("status", "pending")
        .limit(1)
        .execute()
    )
    if existing.data:
        logger.warning(f"Workflow: skipping enqueue for lead {lead_id} stage {stage} — pending messages already exist")
        return 0

    now = datetime.now(timezone.utc)
    count = 0

    for i, (delay_seconds, template) in enumerate(messages):
        rendered = render_message(template, context)
        send_at = now + timedelta(seconds=delay_seconds)
        msg_id = str(uuid.uuid4())

        # Send immediate messages (delay=0) right now instead of queuing
        if delay_seconds == 0:
            # Get attachments for this message
            from services.templates import STAGE_ATTACHMENTS
            settings = get_settings()
            base_url = settings.PROPOSAL_BASE_URL or settings.FRONTEND_URL
            attach_urls = None
            stage_attach = STAGE_ATTACHMENTS.get(stage)
            if stage_attach:
                branch = metadata.get("selected_tier", metadata.get("branch"))
                if branch and branch in stage_attach:
                    attach_urls = [f"{base_url}{p}" for p in stage_attach[branch]]
                elif None in stage_attach:
                    attach_urls = [f"{base_url}{p}" for p in stage_attach[None]]

            success = send_message_to_contact(ghl_contact_id, rendered, attachments=attach_urls)
            db.table("sms_queue").insert({
                "id": msg_id,
                "lead_id": lead_id,
                "stage": stage,
                "sequence_index": i,
                "message_body": rendered,
                "send_at": now.isoformat(),
                "ghl_contact_id": ghl_contact_id,
                "status": "sent" if success else "failed",
                "sent_at": now.isoformat() if success else None,
            }).execute()
            if success:
                log_event(lead_id, "sms_sent", f"Sent immediately: {rendered[:60]}...", {"stage": stage, "sequence_index": i})
            else:
                log_event(lead_id, "sms_failed", f"Immediate send failed: {rendered[:60]}...", {"stage": stage, "sequence_index": i})
            count += 1
            continue

        db.table("sms_queue").insert({
            "id": msg_id,
            "lead_id": lead_id,
            "stage": stage,
            "sequence_index": i,
            "message_body": rendered,
            "send_at": send_at.isoformat(),
            "ghl_contact_id": ghl_contact_id,
            "status": "pending",
        }).execute()
        count += 1

    logger.info(f"Workflow: enqueued {count} messages for lead {lead_id} stage {stage}")
    log_event(lead_id, "sms_queued", f"Scheduled {count} SMS for stage {STAGE_LABELS.get(stage, stage)}", {"stage": stage, "count": count})
    return count


def cancel_pending_messages(
    lead_id: str,
    stage: str | None = None,
    reason: str = "cancelled",
) -> int:
    """Cancel all pending messages for a lead, optionally filtered by stage."""
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()

    query = (
        db.table("sms_queue")
        .update({
            "status": "cancelled",
            "cancelled_at": now,
            "cancel_reason": reason,
        })
        .eq("lead_id", lead_id)
        .eq("status", "pending")
    )
    if stage:
        query = query.eq("stage", stage)

    res = query.execute()
    count = len(res.data) if res.data else 0
    return count


def on_customer_reply(lead_id: str, message_text: str = "") -> None:
    """
    Called when an inbound message arrives from a customer.
    1. Cancel ALL pending drip messages
    2. Based on current stage, determine next action
    3. Notify VA about the reply
    """
    db = get_db()
    lead_res = db.table("leads").select(
        "workflow_stage, address, contact_name, ghl_contact_id"
    ).eq("id", lead_id).single().execute()

    if not lead_res.data:
        return

    lead = lead_res.data
    current_stage = lead.get("workflow_stage")

    # Cancel all pending messages — customer engaged
    cancelled = cancel_pending_messages(lead_id, reason="customer_replied")
    if cancelled:
        logger.info(f"Workflow: cancelled {cancelled} messages after customer reply (lead {lead_id})")

    log_event(lead_id, "customer_reply", f"Customer replied in stage {STAGE_LABELS.get(current_stage or '', current_stage or 'unknown')}", {"stage": current_stage, "cancelled_messages": cancelled})

    if not current_stage:
        return

    # Stage-specific reply handling
    if current_stage == Stage.NEW_LEAD.value:
        # Check if they have an address
        address = (lead.get("address") or "").strip()
        if address:
            transition_stage(lead_id, Stage.HOT_LEAD, reason="customer_reply_with_address")
        else:
            transition_stage(lead_id, Stage.ASKING_ADDRESS, reason="customer_reply_no_address")

    elif current_stage == Stage.ASKING_ADDRESS.value:
        # VA will manually confirm address, then transition to HOT_LEAD
        # For now, just pause — VA reviews and transitions manually
        logger.info(f"Workflow: lead {lead_id} replied in ASKING_ADDRESS — VA should review")

    elif current_stage == Stage.PACKAGE_SELECTED.value:
        # Try to detect a color name from the customer's reply
        detected_color = _detect_color_in_message(message_text)
        if detected_color:
            # Save the color to the latest proposal and transition to NO_DATE
            try:
                db = get_db()
                prop_res = (
                    db.table("proposals")
                    .select("id")
                    .eq("lead_id", lead_id)
                    .neq("status", "booked")
                    .order("created_at", desc=True)
                    .limit(1)
                    .execute()
                )
                if prop_res.data:
                    db.table("proposals").update({
                        "selected_color": detected_color,
                        "color_mode": "gallery",
                    }).eq("id", prop_res.data[0]["id"]).execute()
                    logger.info(
                        f"Workflow: auto-detected color '{detected_color}' from reply "
                        f"for lead {lead_id}"
                    )
            except Exception as e:
                logger.warning(f"Workflow: failed to save auto-detected color for lead {lead_id}: {e}")
            transition_stage(lead_id, Stage.NO_DATE, reason="color_detected_from_reply")
        else:
            # No color detected — pause for VA to review the reply
            db.table("leads").update({"workflow_paused": True}).eq("id", lead_id).execute()
            logger.info(
                f"Workflow: lead {lead_id} replied in PACKAGE_SELECTED but no color "
                f"detected — paused for VA review"
            )

    elif current_stage in (Stage.COLD_NURTURE.value, Stage.PAST_CUSTOMER.value):
        # Re-enter active pipeline
        transition_stage(lead_id, Stage.HOT_LEAD, reason=f"reactivated_from_{current_stage}")

    else:
        # For other stages, pause the workflow — VA should review the reply
        db.table("leads").update({"workflow_paused": True}).eq("id", lead_id).execute()
        logger.info(
            f"Workflow: lead {lead_id} replied in stage {current_stage} — "
            f"paused workflow for VA review"
        )

    # Notify VA (Olga) about the reply
    _notify_va_of_reply(lead_id, lead, message_text)


def _notify_va_of_reply(lead_id: str, lead: dict, message_text: str) -> None:
    """Send notification to VA about a customer reply. Uses owner GHL contact for now."""
    settings = get_settings()
    if not settings.owner_ghl_contact_id:
        return

    name = lead.get("contact_name") or "Unknown"
    stage = lead.get("workflow_stage") or "unknown"
    preview = (message_text or "")[:200]

    msg = (
        f"\U0001f4e9 Customer Reply!\n"
        f"Lead: {name}\n"
        f"Stage: {STAGE_LABELS.get(stage, stage)}\n"
        f"Message: {preview}"
    )
    send_message_to_contact(settings.owner_ghl_contact_id, msg)


def on_proposal_event(lead_id: str, event: str) -> None:
    """
    Called when the proposal page fires a funnel stage update.
    Maps proposal events to workflow stage transitions.
    """
    db = get_db()
    lead_res = db.table("leads").select("workflow_stage").eq("id", lead_id).single().execute()
    if not lead_res.data:
        return

    current = lead_res.data.get("workflow_stage")

    if event == "opened":
        log_event(lead_id, "proposal_opened", "Customer opened proposal link")
        if current in (Stage.HOT_LEAD.value, None):
            transition_stage(lead_id, Stage.PROPOSAL_SENT, reason="proposal_opened")

    elif event == "package_selected":
        metadata = _get_proposal_metadata(lead_id)
        tier = metadata.get("selected_tier", "unknown")
        log_event(lead_id, "package_selected", f"Customer chose {tier.title()} package", {"tier": tier})
        if current in (Stage.PROPOSAL_SENT.value, Stage.NO_PACKAGE.value, None):
            transition_stage(
                lead_id, Stage.PACKAGE_SELECTED,
                reason="package_selected",
                metadata=metadata,
            )

    elif event == "color_selected":
        log_event(lead_id, "color_selected", "Customer chose a stain color")
        if current in (Stage.PACKAGE_SELECTED.value, None):
            transition_stage(lead_id, Stage.NO_DATE, reason="color_selected")

    elif event == "date_selected":
        metadata = _get_proposal_metadata(lead_id)
        log_event(lead_id, "date_selected", f"Customer selected a date", {"booked_date": metadata.get("booked_date", "")})
        if current in (Stage.NO_DATE.value, None):
            transition_stage(
                lead_id, Stage.DATE_SELECTED,
                reason="date_selected",
                metadata=metadata,
            )

    elif event == "checkout_started":
        log_event(lead_id, "deposit_started", "Customer started checkout")
        logger.info(f"Workflow: lead {lead_id} started checkout")


def _get_proposal_metadata(lead_id: str) -> dict:
    """Get proposal-related metadata for a lead."""
    try:
        db = get_db()
        settings = get_settings()
        res = (
            db.table("proposals")
            .select("token, selected_tier, booked_at")
            .eq("lead_id", lead_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        if res.data:
            p = res.data[0]
            return {
                "proposal_url": f"{settings.proposal_base_url}/proposal/{p['token']}",
                "selected_tier": p.get("selected_tier") or "signature",
                "booked_date": p.get("booked_at") or "",
            }
    except Exception:
        pass
    return {}


def on_deposit_paid(lead_id: str) -> None:
    """Called by Stripe webhook after successful payment."""
    metadata = _get_proposal_metadata(lead_id)
    # Format the booked date nicely
    booked_at = metadata.get("booked_date", "")
    if booked_at:
        try:
            dt = datetime.fromisoformat(booked_at.replace("Z", "+00:00"))
            metadata["booked_date"] = dt.strftime("%A, %B %-d at %-I:%M %p")
        except ValueError:
            pass

    log_event(lead_id, "deposit_paid", "Deposit payment received")
    transition_stage(lead_id, Stage.DEPOSIT_PAID, reason="deposit_paid", metadata=metadata)


def on_job_complete(lead_id: str) -> None:
    """Called when VA marks a job as complete."""
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    db.table("leads").update({"job_completed_at": now}).eq("id", lead_id).execute()
    log_event(lead_id, "job_complete", "VA marked job as complete")
    transition_stage(lead_id, Stage.JOB_COMPLETE, reason="job_marked_complete")


def on_estimate_sent(lead_id: str) -> None:
    """Called when an estimate is approved and the proposal link is sent.
    Transitions the lead to HOT_LEAD stage."""
    log_event(lead_id, "estimate_approved", "Estimate approved, proposal link sent")
    transition_stage(lead_id, Stage.HOT_LEAD, reason="estimate_sent")
