"""
Workflow management API — view/control the SMS automation pipeline.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional

from db import get_db
from api.auth import get_current_user
from services.workflow import (
    Stage, STAGE_LABELS, transition_stage, cancel_pending_messages,
    on_job_complete,
)

router = APIRouter(prefix="/api/workflow", tags=["workflow"])
logger = logging.getLogger(__name__)


class TransitionRequest(BaseModel):
    stage: str
    reason: str = "manual_va"


class ConfigUpdate(BaseModel):
    value: str


# ── Lead workflow status ──────────────────────────────────────────────

@router.get("/leads/{lead_id}/status")
async def get_workflow_status(lead_id: str, _: dict = Depends(get_current_user)):
    """Get workflow status for a lead: current stage, pending messages, history."""
    db = get_db()

    lead_res = (
        db.table("leads")
        .select("workflow_stage, workflow_stage_entered_at, workflow_paused")
        .eq("id", lead_id)
        .single()
        .execute()
    )
    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = lead_res.data
    stage = lead.get("workflow_stage")

    # Pending messages
    pending_res = (
        db.table("sms_queue")
        .select("id, stage, sequence_index, message_body, send_at, status")
        .eq("lead_id", lead_id)
        .eq("status", "pending")
        .order("send_at")
        .execute()
    )

    # Recent sent/cancelled messages (last 20)
    history_res = (
        db.table("sms_queue")
        .select("id, stage, sequence_index, message_body, send_at, sent_at, status, cancel_reason")
        .eq("lead_id", lead_id)
        .neq("status", "pending")
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )

    return {
        "lead_id": lead_id,
        "current_stage": stage,
        "stage_label": STAGE_LABELS.get(stage, stage) if stage else None,
        "stage_entered_at": lead.get("workflow_stage_entered_at"),
        "paused": lead.get("workflow_paused", False),
        "pending_messages": [
            {
                "id": m["id"],
                "stage": m["stage"],
                "sequence_index": m["sequence_index"],
                "message_body": m["message_body"],
                "send_at": m["send_at"],
            }
            for m in (pending_res.data or [])
        ],
        "message_history": [
            {
                "id": m["id"],
                "stage": m["stage"],
                "message_body": m["message_body"],
                "send_at": m["send_at"],
                "sent_at": m.get("sent_at"),
                "status": m["status"],
                "cancel_reason": m.get("cancel_reason"),
            }
            for m in (history_res.data or [])
        ],
    }


# ── Manual stage transition ───────────────────────────────────────────

@router.post("/leads/{lead_id}/transition")
async def manual_transition(lead_id: str, body: TransitionRequest, user: dict = Depends(get_current_user)):
    """Manually move a lead to a different workflow stage."""
    try:
        new_stage = Stage(body.stage)
    except ValueError:
        valid = [s.value for s in Stage]
        raise HTTPException(status_code=400, detail=f"Invalid stage. Valid: {valid}")

    transition_stage(lead_id, new_stage, reason=f"manual:{user.get('name', user.get('sub'))}")
    return {"status": "ok", "new_stage": new_stage.value}


# ── Pause / Resume ────────────────────────────────────────────────────

@router.post("/leads/{lead_id}/pause")
async def pause_workflow(lead_id: str, _: dict = Depends(get_current_user)):
    """Pause all drip messages for a lead."""
    db = get_db()
    db.table("leads").update({"workflow_paused": True}).eq("id", lead_id).execute()
    return {"status": "paused"}


@router.post("/leads/{lead_id}/resume")
async def resume_workflow(lead_id: str, _: dict = Depends(get_current_user)):
    """Resume drip messages for a lead."""
    db = get_db()
    db.table("leads").update({"workflow_paused": False}).eq("id", lead_id).execute()
    return {"status": "resumed"}


# ── Mark job complete ─────────────────────────────────────────────────

@router.post("/leads/{lead_id}/job-complete")
async def mark_job_complete(lead_id: str, _: dict = Depends(get_current_user)):
    """Mark a job as complete — triggers review + referral workflow."""
    on_job_complete(lead_id)
    return {"status": "ok"}


# ── Message queue management ──────────────────────────────────────────

@router.get("/queue")
async def get_message_queue(
    _: dict = Depends(get_current_user),
    status: Optional[str] = Query(None),
    stage: Optional[str] = Query(None),
    lead_id: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
):
    """List scheduled/sent messages across all leads."""
    db = get_db()
    query = db.table("sms_queue").select(
        "id, lead_id, stage, sequence_index, message_body, send_at, sent_at, status, ghl_contact_id, error_message, created_at"
    )

    if status:
        query = query.eq("status", status)
    else:
        query = query.eq("status", "pending")

    if stage:
        query = query.eq("stage", stage)

    if lead_id:
        query = query.eq("lead_id", lead_id)

    res = query.order("send_at").limit(limit).execute()

    # Enrich with lead names
    messages = res.data or []
    if messages:
        lead_ids = list({m["lead_id"] for m in messages})
        leads_res = db.table("leads").select("id, contact_name").in_("id", lead_ids).execute()
        name_map = {l["id"]: l["contact_name"] for l in (leads_res.data or [])}
        for m in messages:
            m["contact_name"] = name_map.get(m["lead_id"], "")

    return messages


@router.post("/queue/{message_id}/cancel")
async def cancel_message(message_id: str, _: dict = Depends(get_current_user)):
    """Cancel a specific scheduled message."""
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    res = db.table("sms_queue").update({
        "status": "cancelled",
        "cancelled_at": now,
        "cancel_reason": "manual_cancel",
    }).eq("id", message_id).eq("status", "pending").execute()

    if not res.data:
        raise HTTPException(status_code=404, detail="Message not found or already sent")
    return {"status": "cancelled"}


@router.post("/queue/{message_id}/send-now")
async def send_now(message_id: str, _: dict = Depends(get_current_user)):
    """Force-send a scheduled message immediately (atomic claim)."""
    from services.ghl import send_message_to_contact

    db = get_db()
    now = datetime.now(timezone.utc).isoformat()

    # Atomically claim the message — prevents background worker from also sending it
    claim_res = db.table("sms_queue").update({
        "sent_at": now,
    }).eq("id", message_id).eq("status", "pending").execute()

    if not claim_res.data:
        raise HTTPException(status_code=404, detail="Message not found or already sent/cancelled")

    msg = claim_res.data[0]
    sent = send_message_to_contact(msg["ghl_contact_id"], msg["message_body"])

    if sent:
        db.table("sms_queue").update({"status": "sent"}).eq("id", message_id).execute()
        return {"status": "sent"}
    else:
        db.table("sms_queue").update({
            "status": "failed",
            "sent_at": None,
            "error_message": "GHL send failed",
        }).eq("id", message_id).execute()
        raise HTTPException(status_code=502, detail="Failed to send via GHL")


# ── Workflow stats ────────────────────────────────────────────────────

@router.get("/stats")
async def get_workflow_stats(_: dict = Depends(get_current_user)):
    """Workflow overview stats."""
    db = get_db()

    # Leads per stage
    leads_res = db.table("leads").select("workflow_stage").not_.is_("workflow_stage", "null").execute()
    stage_counts: dict[str, int] = {}
    for l in (leads_res.data or []):
        s = l["workflow_stage"]
        stage_counts[s] = stage_counts.get(s, 0) + 1

    # Pending messages count
    pending_res = db.table("sms_queue").select("id").eq("status", "pending").execute()
    # This is an approximation — for exact count we'd need count()

    # Messages sent today
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0).isoformat()
    sent_today_res = (
        db.table("sms_queue")
        .select("id")
        .eq("status", "sent")
        .gte("sent_at", today_start)
        .execute()
    )

    # Paused leads
    paused_res = db.table("leads").select("id").eq("workflow_paused", True).execute()

    return {
        "stage_counts": stage_counts,
        "stage_labels": STAGE_LABELS,
        "pending_messages": len(pending_res.data or []),
        "sent_today": len(sent_today_res.data or []),
        "paused_leads": len(paused_res.data or []),
    }


# ── Workflow config ───────────────────────────────────────────────────

@router.get("/config")
async def get_workflow_config(_: dict = Depends(get_current_user)):
    """Get all editable workflow config values."""
    db = get_db()
    res = db.table("workflow_config").select("*").execute()
    return res.data or []


@router.put("/config/{key}")
async def update_workflow_config(key: str, body: ConfigUpdate, _: dict = Depends(get_current_user)):
    """Update a workflow config value (incentive text, review link, etc.)."""
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()

    res = db.table("workflow_config").upsert({
        "key": key,
        "value": body.value,
        "updated_at": now,
    }).execute()

    return {"status": "ok", "key": key, "value": body.value}


# ── Available stages (for frontend dropdown) ──────────────────────────

@router.get("/stages")
async def list_stages(_: dict = Depends(get_current_user)):
    """List all workflow stages with labels."""
    return [
        {"value": s.value, "label": STAGE_LABELS.get(s.value, s.value)}
        for s in Stage
    ]


# ── GHL Pipeline stage mapping ───────────────────────────────────────

@router.get("/ghl-pipelines")
async def get_ghl_pipelines(_: dict = Depends(get_current_user)):
    """Fetch all GHL pipelines with their stages so the user can map them."""
    from services.ghl import get_pipelines
    from config import get_settings

    settings = get_settings()
    pipelines = get_pipelines(settings.ghl_location_id)

    result = []
    for p in pipelines:
        result.append({
            "id": p.get("id"),
            "name": p.get("name"),
            "stages": [
                {"id": s.get("id"), "name": s.get("name")}
                for s in p.get("stages", [])
            ],
        })
    return result


# ── VA shortcut: ask for address ─────────────────────────────────────

@router.post("/leads/{lead_id}/ask-address")
async def ask_for_address(lead_id: str, _: dict = Depends(get_current_user)):
    """Transition lead to ASKING_ADDRESS stage — sends the address request SMS."""
    transition_stage(lead_id, Stage.ASKING_ADDRESS, reason="va_ask_address")
    return {"status": "ok", "new_stage": Stage.ASKING_ADDRESS.value}


# ── VA shortcut: new build ────────────────────────────────────────────

@router.post("/leads/{lead_id}/new-build")
async def trigger_new_build(lead_id: str, _: dict = Depends(get_current_user)):
    """Transition lead to NEW_BUILD stage — sends 'can't measure, send photos or in-person?' SMS."""
    transition_stage(lead_id, Stage.NEW_BUILD, reason="va_new_build")
    return {"status": "ok", "new_stage": Stage.NEW_BUILD.value}


# ── VA shortcut: send date-selection link ────────────────────────────

@router.post("/leads/{lead_id}/send-date-link")
async def send_date_link(lead_id: str, _: dict = Depends(get_current_user)):
    """Send a proposal link that jumps straight to the date picker (color already chosen).
    Transitions lead to NO_DATE stage."""
    from services.ghl import send_message_to_contact
    from config import get_settings

    db = get_db()
    settings = get_settings()

    lead_res = (
        db.table("leads")
        .select("ghl_contact_id, contact_name")
        .eq("id", lead_id)
        .single()
        .execute()
    )
    if not lead_res.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = lead_res.data
    contact_id = lead.get("ghl_contact_id")
    if not contact_id:
        raise HTTPException(status_code=400, detail="Lead has no GHL contact ID")

    prop_res = (
        db.table("proposals")
        .select("token")
        .eq("lead_id", lead_id)
        .neq("status", "booked")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not prop_res.data:
        raise HTTPException(status_code=404, detail="No active proposal found for this lead")

    token = prop_res.data[0]["token"]
    date_url = f"{settings.proposal_base_url}/proposal/{token}?step=date"

    name = (lead.get("contact_name") or "").strip()
    first_name = name.split()[0] if name else "there"

    msg = (
        f"Hey {first_name}! Great news — your color is all set! Now just pick a "
        f"date that works for you and we'll get everything locked in: {date_url}"
    )
    send_message_to_contact(contact_id, msg)

    transition_stage(lead_id, Stage.NO_DATE, reason="va_send_date_link")
    return {"status": "ok", "new_stage": Stage.NO_DATE.value, "url": date_url}


class StageMapRequest(BaseModel):
    mapping: dict[str, str]


@router.post("/ghl-stage-map")
async def save_ghl_stage_map(body: StageMapRequest, _: dict = Depends(get_current_user)):
    """Save GHL stage ID mapping. Expects {"mapping": {workflow_stage: ghl_stage_id}}."""
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()

    for workflow_stage, ghl_stage_id in body.mapping.items():
        key = f"ghl_stage_{workflow_stage}"
        db.table("workflow_config").upsert({
            "key": key,
            "value": ghl_stage_id,
            "updated_at": now,
        }).execute()

    return {"status": "ok", "mapped": len(body.mapping)}


# ── Activity Log ────────────────────────────────────────────────────

@router.get("/log")
async def get_automation_log(
    lead_id: str | None = Query(default=None),
    event_type: str | None = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
    _: dict = Depends(get_current_user),
):
    """Paginated automation activity log."""
    db = get_db()
    query = db.table("automation_log").select(
        "id, lead_id, event_type, detail, metadata, created_at"
    )
    if lead_id:
        query = query.eq("lead_id", lead_id)
    if event_type:
        query = query.eq("event_type", event_type)
    query = query.order("created_at", desc=True).limit(limit)
    # Manual offset via Python since QueryBuilder may not support .offset()
    res = query.execute()
    rows = (res.data or [])[offset:offset + limit] if offset else (res.data or [])

    # Enrich with lead names
    lead_ids = list({r["lead_id"] for r in rows if r.get("lead_id")})
    lead_names: dict[str, str] = {}
    if lead_ids:
        leads_res = db.table("leads").select("id, contact_name").in_("id", lead_ids).execute()
        lead_names = {r["id"]: r.get("contact_name", "") for r in (leads_res.data or [])}

    return {
        "events": [
            {
                **row,
                "contact_name": lead_names.get(row.get("lead_id", ""), ""),
            }
            for row in rows
        ],
        "total": len(res.data or []),
    }


# ── Template editing ────────────────────────────────────────────────

class TemplateMessage(BaseModel):
    delay_seconds: int
    message_body: str


class TemplateSaveRequest(BaseModel):
    branch: str | None = None
    messages: list[TemplateMessage]


class TemplatePreviewRequest(BaseModel):
    message_body: str
    sample_data: dict = {}


class TemplateTestSendRequest(BaseModel):
    message_body: str
    contact_id: str | None = None


@router.get("/templates/overrides")
async def get_overridden_stages(_: dict = Depends(get_current_user)):
    """Return list of stages that have user overrides."""
    db = get_db()
    res = db.table("workflow_templates").select("stage").execute()
    stages = list({r["stage"] for r in (res.data or [])})
    return {"overridden_stages": stages}


@router.get("/templates/{stage}")
async def get_stage_templates(
    stage: str,
    branch: str | None = Query(default=None),
    _: dict = Depends(get_current_user),
):
    """Return effective templates for a stage (overrides if exist, else defaults)."""
    from services.templates import get_default_stage_messages, _load_template_overrides

    overrides = _load_template_overrides(stage, branch)
    is_overridden = overrides is not None

    if is_overridden:
        messages = overrides
    else:
        messages = get_default_stage_messages(stage, branch)

    return {
        "stage": stage,
        "branch": branch,
        "is_overridden": is_overridden,
        "messages": [
            {"sequence_index": i, "delay_seconds": d, "message_body": m}
            for i, (d, m) in enumerate(messages)
        ],
    }


@router.put("/templates/{stage}")
async def save_stage_templates(
    stage: str,
    body: TemplateSaveRequest,
    _: dict = Depends(get_current_user),
):
    """Save full message chain as overrides for a stage."""
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()

    # Delete existing overrides for this stage+branch
    q = db.table("workflow_templates").delete().eq("stage", stage)
    if body.branch:
        q = q.eq("branch", body.branch)
    else:
        q = q.is_("branch", "null")
    q.execute()

    # Insert new overrides
    for i, msg in enumerate(body.messages):
        db.table("workflow_templates").insert({
            "stage": stage,
            "sequence_index": i,
            "branch": body.branch,
            "delay_seconds": msg.delay_seconds,
            "message_body": msg.message_body,
            "updated_at": now,
        }).execute()

    return {"status": "ok", "saved": len(body.messages)}


@router.delete("/templates/{stage}")
async def reset_stage_templates(
    stage: str,
    branch: str | None = Query(default=None),
    _: dict = Depends(get_current_user),
):
    """Delete all overrides for a stage, reverting to hardcoded defaults."""
    db = get_db()
    q = db.table("workflow_templates").delete().eq("stage", stage)
    if branch:
        q = q.eq("branch", branch)
    else:
        q = q.is_("branch", "null")
    q.execute()
    return {"status": "ok"}


@router.post("/templates/preview")
async def preview_template(body: TemplatePreviewRequest, _: dict = Depends(get_current_user)):
    """Render a template with sample data."""
    from services.templates import render_message

    sample = {
        "first_name": "John",
        "proposal_link": "https://proposal.atpressurewash.com/sample",
        "review_link": "https://g.page/review/sample",
        "date": "April 5th",
        "address": "123 Oak St, Houston TX",
        "incentive": "15% off your next service",
        "referral_bonus": "$50 off",
        "stripe_link": "https://checkout.stripe.com/sample",
        "month": "April",
        "entry_color_name": "Natural Cedar",
        "entry_color_link": "https://example.com/color.jpg",
        "signature_color_chart": "https://example.com/sig-chart.jpg",
        "legacy_color_chart": "https://example.com/leg-chart.jpg",
        "color_1": "Dark Walnut",
        "color_2": "Canyon Brown",
        "selected_tier": "Signature",
    }
    sample.update(body.sample_data)
    rendered = render_message(body.message_body, sample)
    return {"rendered": rendered}


@router.post("/templates/test-send")
async def test_send_template(body: TemplateTestSendRequest, _: dict = Depends(get_current_user)):
    """Send a rendered test message to a GHL contact."""
    from services.ghl import send_message_to_contact
    from services.templates import render_message

    contact_id = body.contact_id
    if not contact_id:
        # Fall back to config
        db = get_db()
        res = db.table("workflow_config").select("value").eq("key", "test_sms_contact_id").execute()
        if res.data:
            contact_id = res.data[0]["value"]

    if not contact_id:
        raise HTTPException(400, "No contact_id provided and test_sms_contact_id not configured")

    # Pull real lead data for this contact
    lead_res = db.table("leads").select(
        "id, contact_name, address, form_data"
    ).eq("ghl_contact_id", contact_id).execute()

    lead = lead_res.data[0] if lead_res.data else {}
    contact_name = lead.get("contact_name", "")
    first_name = contact_name.split()[0] if contact_name else "Friend"
    address = lead.get("address", "")
    form_data = lead.get("form_data") or {}

    # Build context from real lead data + config values
    from datetime import datetime as dt
    month = dt.now().strftime("%B")

    # Load workflow config for template variables
    cfg_res = db.table("workflow_config").select("key, value").execute()
    cfg = {r["key"]: r["value"] for r in (cfg_res.data or [])}

    # Check for a proposal token (proposals link via lead_id, not ghl_contact_id)
    lead_id = lead.get("id", "")
    prop_res = db.table("proposals").select("token").eq("lead_id", lead_id).execute() if lead_id else None
    proposal_token = prop_res.data[0]["token"] if prop_res and prop_res.data else "test"
    from config import get_settings
    settings = get_settings()
    proposal_base = settings.proposal_base_url or settings.frontend_url or "https://proposal.atpressurewash.com"

    sample = {
        "first_name": first_name,
        "proposal_link": f"{proposal_base}/proposal/{proposal_token}",
        "date": form_data.get("booked_date", "TBD"),
        "address": address,
        "month": month,
        "review_link": cfg.get("google_review_link", ""),
        "incentive": cfg.get("cold_lead_incentive", ""),
        "referral_bonus": cfg.get("referral_bonus", ""),
        "stripe_link": "https://checkout.stripe.com/test",
        "entry_color_name": cfg.get("entry_color_name", ""),
        "entry_color_link": cfg.get("entry_color_link", ""),
        "signature_color_chart": cfg.get("signature_color_chart", ""),
        "legacy_color_chart": cfg.get("legacy_color_chart", ""),
        "color_1": cfg.get("popular_color_1", ""),
        "color_2": cfg.get("popular_color_2", ""),
        "selected_tier": form_data.get("selected_tier", "Signature"),
    }
    rendered = render_message(body.message_body, sample)
    success = send_message_to_contact(contact_id, rendered)

    if not success:
        raise HTTPException(500, "Failed to send test SMS via GHL")

    return {"status": "sent", "rendered": rendered}
