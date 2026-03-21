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
    """Force-send a scheduled message immediately."""
    from services.ghl import send_message_to_contact

    db = get_db()
    res = db.table("sms_queue").select("*").eq("id", message_id).eq("status", "pending").single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Message not found or already sent")

    msg = res.data
    sent = send_message_to_contact(msg["ghl_contact_id"], msg["message_body"])

    now = datetime.now(timezone.utc).isoformat()
    if sent:
        db.table("sms_queue").update({"status": "sent", "sent_at": now}).eq("id", message_id).execute()
        return {"status": "sent"}
    else:
        db.table("sms_queue").update({"status": "failed", "error_message": "GHL send failed"}).eq("id", message_id).execute()
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
