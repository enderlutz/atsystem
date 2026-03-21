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
from services.geocoder import has_zip, complete_address as geocode_address

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


@router.post("/webhook/ghl/message")
async def ghl_message_webhook(request: Request):
    """Receives GHL InboundMessage / OutboundMessage events and stores them in the DB."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    msg_type = payload.get("type", "")
    logger.info(f"GHL message webhook: type={msg_type}")

    if msg_type not in ("InboundMessage", "OutboundMessage", "ConversationProviderOutboundMessage"):
        return {"status": "ignored", "type": msg_type}

    contact_id = payload.get("contactId") or payload.get("contact_id", "")
    if not contact_id:
        return {"status": "ignored", "reason": "no contactId"}

    direction = "inbound" if msg_type == "InboundMessage" else "outbound"
    body_text = payload.get("body") or payload.get("message") or ""
    date_added = payload.get("dateAdded") or payload.get("createdAt") or datetime.now(timezone.utc).isoformat()
    ghl_message_id = payload.get("messageId") or payload.get("id")
    message_type = payload.get("messageType") or "SMS"

    db = get_db()

    # Find the lead by contact_id
    lead_res = db.table("leads").select("id").eq("ghl_contact_id", contact_id).single().execute()
    lead_id = lead_res.data["id"] if lead_res.data else None

    msg_data = {
        "ghl_contact_id": contact_id,
        "lead_id": lead_id,
        "direction": direction,
        "body": body_text,
        "message_type": message_type,
        "date_added": date_added,
    }

    if ghl_message_id:
        db.table("messages").upsert({**msg_data, "ghl_message_id": ghl_message_id}, on_conflict="ghl_message_id").execute()
    else:
        db.table("messages").insert(msg_data).execute()

    # Auto-update customer_responded when an inbound message arrives
    if direction == "inbound" and lead_id:
        db.table("leads").update({
            "customer_responded": True,
            "customer_response_text": body_text[:500],
        }).eq("id", lead_id).execute()
        logger.info(f"Inbound message from {contact_id} — lead {lead_id} marked as responded")

        # Trigger workflow engine on customer reply
        try:
            from services.workflow import on_customer_reply
            on_customer_reply(lead_id, body_text)
        except Exception as e:
            logger.error(f"Workflow on_customer_reply failed for lead {lead_id}: {e}")

    return {"status": "ok"}


@router.post("/webhook/ghl")
async def ghl_webhook(request: Request, background_tasks: BackgroundTasks):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    logger.info(f"GHL webhook received: {list(payload.keys())}")

    field_map = get_field_map()
    lead_data = parse_webhook_payload(payload, field_map=field_map)

    # Autocomplete partial address (missing zip) via Google Geocoding
    settings = get_settings()
    _raw_addr = lead_data.get("address", "")
    if _raw_addr and not has_zip(_raw_addr) and settings.google_maps_api_key:
        geo = geocode_address(_raw_addr, settings.google_maps_api_key)
        if geo:
            lead_data["form_data"]["original_address"] = _raw_addr
            lead_data["form_data"]["address_autocompleted"] = True
            lead_data["form_data"]["address_confirmed"] = False
            lead_data["address"] = geo["full_address"]
            lead_data["form_data"]["zip_code"] = geo["zip_code"]
            logger.info(f"Address autocompleted for incoming lead: '{_raw_addr}' → '{geo['full_address']}'")

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

    # Start workflow for new leads (not updates to existing leads)
    if not existing.data:
        try:
            from services.workflow import transition_stage, Stage
            transition_stage(lead_id, Stage.NEW_LEAD, reason="new_lead_webhook")
        except Exception as e:
            logger.error(f"Workflow transition failed for new lead {lead_id}: {e}")

    return {"status": "received", "lead_id": lead_id}


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Safety-net: complete booking if customer paid but redirect back failed."""
    settings = get_settings()
    if not settings.stripe_webhook_secret:
        logger.warning("Stripe webhook received but STRIPE_WEBHOOK_SECRET not configured — ignoring")
        return {"status": "ignored"}

    body = await request.body()
    sig = request.headers.get("stripe-signature", "")

    import stripe as stripe_lib
    try:
        event = stripe_lib.Webhook.construct_event(body, sig, settings.stripe_webhook_secret)
    except stripe_lib.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Webhook error: {e}")

    if event["type"] != "checkout.session.completed":
        return {"status": "ignored", "event": event["type"]}

    session = event["data"]["object"]
    if session.get("payment_status") != "paid":
        return {"status": "not_paid"}

    token = (session.get("metadata") or {}).get("proposal_token")
    if not token:
        logger.error("Stripe webhook: no proposal_token in session metadata")
        return {"status": "no_token"}

    db = get_db()
    proposal_res = db.table("proposals").select("*").eq("token", token).single().execute()
    if not proposal_res.data:
        logger.error(f"Stripe webhook: proposal {token} not found")
        return {"status": "not_found"}

    proposal = proposal_res.data
    if proposal["status"] == "booked":
        logger.info(f"Stripe webhook: proposal {token} already booked — skipping duplicate")
        return {"status": "already_booked"}

    pending = proposal.get("pending_booking") or {}
    if not pending.get("selected_tier") or not pending.get("booked_at"):
        logger.error(f"Stripe webhook: missing pending_booking for proposal {token}")
        return {"status": "no_pending_booking"}

    from api.proposals import _finalize_booking
    try:
        await _finalize_booking(
            token=token,
            proposal=proposal,
            selected_tier=pending["selected_tier"],
            booked_at_str=pending["booked_at"],
            contact_email=pending.get("contact_email"),
            backup_dates=pending.get("backup_dates") or [],
            selected_color=pending.get("selected_color"),
            color_mode=pending.get("color_mode", "gallery"),
            hoa_colors=pending.get("hoa_colors"),
            custom_color=pending.get("custom_color"),
            stripe_session_id=session["id"],
            settings=settings,
            db=db,
        )
        logger.info(f"Stripe webhook: proposal {token} finalized successfully")

        # Trigger workflow transition to DEPOSIT_PAID
        try:
            from services.workflow import on_deposit_paid
            on_deposit_paid(proposal["lead_id"])
        except Exception as e:
            logger.error(f"Workflow on_deposit_paid failed for lead {proposal['lead_id']}: {e}")

    except Exception as e:
        logger.error(f"Stripe webhook: failed to finalize proposal {token}: {e}")
        raise

    return {"status": "booked"}
