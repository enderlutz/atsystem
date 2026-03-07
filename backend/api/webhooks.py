"""
GHL Webhook receiver.
POST /webhook/ghl — called by GoHighLevel when a form is submitted.
"""
from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Request, BackgroundTasks, HTTPException

from db import get_db
from config import get_settings
from services.ghl import parse_webhook_payload
from services.estimator import calculate_estimate
from services.notify import notify_owner

router = APIRouter()
logger = logging.getLogger(__name__)


def get_pricing_config(service_type: str) -> dict | None:
    try:
        db = get_db()
        res = db.table("pricing_config").select("config").eq("service_type", service_type).single().execute()
        return res.data["config"] if res.data else None
    except Exception:
        return None


def get_field_map() -> dict[str, str]:
    """Load GHL field ID -> our field name mapping from DB."""
    db = get_db()
    res = db.table("ghl_field_mapping").select("ghl_field_id,ghl_field_key,our_field_name").not_.is_("our_field_name", "null").execute()
    mapping = {}
    for row in (res.data or []):
        if row.get("our_field_name"):
            mapping[row["ghl_field_id"]] = row["our_field_name"]
            if row.get("ghl_field_key"):
                mapping[row["ghl_field_key"]] = row["our_field_name"]
    return mapping


def _build_inputs_with_meta(form_data: dict, meta: dict) -> dict:
    return {
        **form_data,
        "_zone":            meta.get("zone", ""),
        "_sqft":            meta.get("sqft", 0),
        "_tiers":           meta.get("tiers", {}),
        "_approval_status": meta.get("approval_status", ""),
        "_approval_reason": meta.get("approval_reason", ""),
        "_priority":        meta.get("priority", ""),
        "_has_addons":      meta.get("has_addons", False),
    }


async def process_lead(lead_id: str, lead_data: dict):
    """Background task: calculate estimate + notify owner."""
    db = get_db()
    service_type = lead_data["service_type"]

    try:
        config = get_pricing_config(service_type)
        low, high, breakdown, meta = calculate_estimate(
            service_type,
            lead_data["form_data"],
            config,
            zip_code=lead_data.get("zip_code", ""),
        )

        estimate_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        estimate_row = {
            "id":            estimate_id,
            "lead_id":       lead_id,
            "service_type":  service_type,
            "status":        "pending",
            "inputs":        _build_inputs_with_meta(lead_data["form_data"], meta),
            "breakdown":     [b.model_dump() for b in breakdown],
            "estimate_low":  low,
            "estimate_high": high,
            "created_at":    now,
        }

        db.table("estimates").insert(estimate_row).execute()
        db.table("leads").update({"status": "estimated"}).eq("id", lead_id).execute()

        notify_owner({**estimate_row, "id": estimate_id}, lead_data)

        logger.info(
            f"Estimate {estimate_id} for lead {lead_id}: "
            f"${low}–${high} | zone={meta.get('zone')} | status={meta.get('approval_status')}"
        )
    except Exception as e:
        logger.error(f"Failed to process lead {lead_id}: {e}")


async def recalculate_estimate_for_lead(lead_id: str, lead_data: dict):
    """Re-run the estimator and update the existing pending estimate, if any."""
    db = get_db()
    service_type = lead_data["service_type"]

    est_res = (
        db.table("estimates")
        .select("id,status")
        .eq("lead_id", lead_id)
        .eq("status", "pending")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not est_res.data:
        # No pending estimate — create one fresh
        await process_lead(lead_id, lead_data)
        return

    estimate_id = est_res.data[0]["id"]

    try:
        config = get_pricing_config(service_type)
        low, high, breakdown, meta = calculate_estimate(
            service_type,
            lead_data["form_data"],
            config,
            zip_code=lead_data.get("zip_code", ""),
        )

        db.table("estimates").update({
            "inputs":        _build_inputs_with_meta(lead_data["form_data"], meta),
            "breakdown":     [b.model_dump() for b in breakdown],
            "estimate_low":  low,
            "estimate_high": high,
        }).eq("id", estimate_id).execute()

        logger.info(
            f"Recalculated estimate {estimate_id} for lead {lead_id}: "
            f"${low}–${high} | zone={meta.get('zone')} | status={meta.get('approval_status')}"
        )
    except Exception as e:
        logger.error(f"Failed to recalculate estimate for lead {lead_id}: {e}")


@router.post("/webhook/ghl")
async def ghl_webhook(request: Request, background_tasks: BackgroundTasks):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    logger.info(f"GHL webhook received: {list(payload.keys())}")

    field_map = get_field_map()
    lead_data = parse_webhook_payload(payload, field_map=field_map)

    if not lead_data["ghl_contact_id"]:
        logger.warning("GHL webhook missing contactId — ignoring")
        return {"status": "ignored", "reason": "missing contactId"}

    db = get_db()

    # Dedup: update existing lead if contact already exists
    existing = db.table("leads").select("id").eq("ghl_contact_id", lead_data["ghl_contact_id"]).execute()
    if existing.data:
        lead_id = existing.data[0]["id"]
        db.table("leads").update({
            "form_data": lead_data["form_data"],
            "address": lead_data["address"],
            "contact_name": lead_data.get("contact_name", ""),
            "contact_phone": lead_data.get("contact_phone", ""),
            "contact_email": lead_data.get("contact_email", ""),
        }).eq("id", lead_id).execute()
        logger.info(f"Lead {lead_id} updated for contact {lead_data['ghl_contact_id']}")
    else:
        lead_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        lead_row = {
            "id": lead_id,
            "ghl_contact_id": lead_data["ghl_contact_id"],
            "service_type": lead_data["service_type"],
            "status": "new",
            "address": lead_data["address"],
            "form_data": lead_data["form_data"],
            "contact_name": lead_data.get("contact_name", ""),
            "contact_phone": lead_data.get("contact_phone", ""),
            "contact_email": lead_data.get("contact_email", ""),
            "priority": lead_data.get("priority", "MEDIUM"),
            "tags": [],
            "created_at": now,
        }
        try:
            db.table("leads").insert(lead_row).execute()
            logger.info(f"Lead {lead_id} created for contact {lead_data['ghl_contact_id']}")
        except Exception as e:
            logger.error(f"Failed to insert lead: {e}")
            raise HTTPException(status_code=500, detail="Failed to store lead")

    background_tasks.add_task(process_lead, lead_id, lead_data)

    return {"status": "received", "lead_id": lead_id}
