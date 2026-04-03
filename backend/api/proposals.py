"""Public proposal API — no auth required. Used by customer-facing booking page."""
import logging
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from db import get_db, get_conn
from config import get_settings
from services.ghl import send_message_to_contact, update_opportunity_stage
from services.google_calendar import create_calendar_event

router = APIRouter(prefix="/api/proposal", tags=["proposals"])
logger = logging.getLogger(__name__)

# Hex codes for HOA color swatches — used in the HOA approval SMS
HOA_COLOR_HEX: dict[str, str] = {
    "Adobe": "#9A6B4F", "Antique Burgundy": "#5A2E36", "Autumn Fog": "#AEB6B7",
    "Autumn Russet": "#A45B3B", "Brickwood": "#8B3D32", "Brown": "#6B4F3A",
    "Cedar": "#9C6A3D", "Cedar Naturaltone": "#A66B3E", "Cilantro": "#666944",
    "Classic Buff": "#E1D2B6", "Clay Angel": "#CBB8A8", "Coffee Gelato": "#B8896B",
    "Corner Café": "#B88654", "Cowboy Boots": "#65534A", "Cowboy Suede": "#76422D",
    "Desert Sand": "#D7C3AA", "Dust Bunny": "#CCB9AC", "Filtered Shade": "#CBC9C4",
    "Forest Canopy": "#2F3837", "Frappe": "#BDB6AA", "Gallery Grey": "#C2B5A7",
    "Garden Ochre": "#B9803C", "Gravity": "#C3C6C7", "Gray Brook": "#AEBABD",
    "Greige": "#B7AD9F", "Hazy Stratus": "#A1A09B", "Heirloom Red": "#7B2E2E",
    "High-Speed Steel": "#616467", "Honey Gold": "#C8A15A", "Hopsack": "#D1BEAA",
    "Khaki": "#A39274", "King's Canyon": "#7A5B47", "Midnight Shadow": "#33353A",
    "Monticello Tan": "#9B8F7B", "Mountain Smoke": "#8A867F", "Mudslide": "#6A5A4F",
    "Natural Cork": "#895C3D", "Navajo Horizon": "#A08173", "Notre Dame": "#7F8587",
    "Nuance": "#C3BEB6", "Pale Powder": "#CDAB92", "Pitch Cobalt": "#293944",
    "Porcelain Shale": "#C0C0BB", "Quail Egg": "#EAE2D5", "Redwood": "#8B3F2B",
    "Reindeer": "#8B8061", "Riverbed's Edge": "#7F7A73", "Rusticanna": "#8A523D",
    "Safari Brown": "#5C4A3A", "Sahara Sands": "#E0C6AE", "Savannah Red": "#8A3C2E",
    "Scented Candle": "#846B59", "Seafoam Storm": "#939A91", "Sharkfin": "#7C878B",
    "Stampede": "#6C5A47", "Standing Still": "#8C6343", "Timber Dust": "#BAA693",
    "Universal Umber": "#9A7E65", "Very Black": "#2F3238", "Warm Buff": "#D1B390",
    "Wedgwood Blue": "#7A92A8",
}


STAGE_ORDER = ["sent", "opened", "hoa_selected", "package_selected", "color_selected", "date_selected", "checkout_started", "booked"]


class StageUpdate(BaseModel):
    stage: str


class SelectionUpdate(BaseModel):
    selected_tier: str | None = None
    selections: list | None = None  # [{estimate_id, selected_tier}, ...]
    color_mode: str | None = None
    selected_color: str | None = None
    hoa_colors: list | None = None
    custom_color: str | None = None


class ActivityUpdate(BaseModel):
    type: str  # "heartbeat" | "left"


class CheckoutRequest(BaseModel):
    selected_tier: str
    selections: list | None = None  # [{estimate_id, selected_tier}, ...] for multi-estimate
    booked_at: str
    contact_email: str | None = None
    backup_dates: list[str] | None = None
    selected_color: str | None = None
    color_mode: str = "gallery"
    hoa_colors: list | None = None
    custom_color: str | None = None
    additional_request: str | None = None


class BookingRequest(BaseModel):
    selected_tier: str          # "essential" | "signature" | "legacy"
    selections: list | None = None  # [{estimate_id, selected_tier}, ...] for multi-estimate
    booked_at: str              # ISO datetime string from customer
    contact_email: str | None = None
    backup_dates: list[str] | None = None
    selected_color: str | None = None
    color_mode: str = "gallery" # gallery | hoa_only | hoa_approved | custom
    hoa_colors: list | None = None
    custom_color: str | None = None
    additional_request: str | None = None
    stripe_session_id: str | None = None


def _apply_discount(tiers_raw: dict, military_discount: bool) -> dict:
    """Apply military discount ($50 off each tier) and return cleaned tier prices."""
    discount = 50.0 if military_discount else 0.0
    return {
        "essential": max(0.0, float(tiers_raw.get("essential") or 0) - discount),
        "signature": max(0.0, float(tiers_raw.get("signature") or 0) - discount),
        "legacy": max(0.0, float(tiers_raw.get("legacy") or 0) - discount),
    }


@router.get("/{token}")
async def get_proposal(token: str):
    """Public endpoint — returns proposal data for the customer booking page."""
    import asyncio
    from starlette.concurrency import run_in_threadpool

    db = get_db()
    result = db.table("proposals").select("*").eq("token", token).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Proposal not found")

    proposal = result.data
    is_preview = proposal["status"] == "preview"

    # Fetch estimate(s) + lead in PARALLEL (not sequential)
    estimate_ids = proposal.get("estimate_ids") or []
    has_multi = estimate_ids and len(estimate_ids) > 1

    def _fetch_estimates():
        if has_multi:
            res = get_db().table("estimates").select("*").in_("id", estimate_ids).execute()
            return res.data or []
        else:
            res = get_db().table("estimates").select("*").eq("id", proposal["estimate_id"]).single().execute()
            return [res.data] if res.data else []

    def _fetch_lead():
        res = get_db().table("leads").select("*").eq("id", proposal["lead_id"]).single().execute()
        return res.data or {}

    all_estimates_raw, lead = await asyncio.gather(
        run_in_threadpool(_fetch_estimates),
        run_in_threadpool(_fetch_lead),
    )

    if not all_estimates_raw:
        raise HTTPException(status_code=404, detail="Estimate not found")

    # For multi-estimate, maintain order from estimate_ids
    if has_multi:
        est_map = {e["id"]: e for e in all_estimates_raw}
        all_estimates = [est_map[eid] for eid in estimate_ids if eid in est_map]
    else:
        all_estimates = all_estimates_raw

    estimate = all_estimates[0]
    inputs = estimate.get("inputs") or {}
    tiers_raw = inputs.get("_tiers") or {}
    military_discount = bool(inputs.get("military_discount", False))
    tiers = _apply_discount(tiers_raw, military_discount)

    sections = []
    for est in all_estimates:
        est_inputs = est.get("inputs") or {}
        est_tiers_raw = est_inputs.get("_tiers") or {}
        est_military = bool(est_inputs.get("military_discount", False))
        est_tiers = _apply_discount(est_tiers_raw, est_military)
        sections.append({
            "estimate_id": est["id"],
            "label": est.get("label") or "",
            "tiers": est_tiers,
            "previously_stained": est_inputs.get("previously_stained") or "No",
            "fence_sides": est_inputs.get("fence_sides") or "",
            "custom_fence_sides": est_inputs.get("custom_fence_sides") or "",
        })

    # Mark as viewed — fire-and-forget (don't block customer's page load)
    if proposal["status"] == "sent":
        now = datetime.now(timezone.utc).isoformat()
        asyncio.get_event_loop().run_in_executor(
            None,
            lambda: get_db().table("proposals").update({"status": "viewed", "first_viewed_at": now}).eq("token", token).execute()
        )

    selected_tier = proposal.get("selected_tier")
    selected_tier_price = float(tiers.get(selected_tier) or 0) if selected_tier else 0

    color_mode = proposal.get("color_mode") or "gallery"
    if color_mode == "gallery" and proposal.get("selected_color"):
        color_display = proposal.get("selected_color")
    elif color_mode == "hoa_only" and proposal.get("hoa_colors"):
        colors = proposal.get("hoa_colors") or []
        color_display = f"HOA colors: {', '.join(str(c) for c in colors)}"
    elif color_mode == "hoa_approved":
        color_display = f"HOA Approved: {proposal.get('custom_color') or 'TBD'}"
    elif color_mode == "custom":
        color_display = f"Custom: {proposal.get('custom_color') or 'TBD'}"
    else:
        color_display = "Not specified"

    from fastapi.responses import JSONResponse

    data = {
        "status": proposal.get("status") if proposal.get("status") in ("booked", "cancelled") else ("preview" if is_preview else "viewed"),
        "token": token,
        "customer_name": lead.get("contact_name") or "",
        "address": lead.get("address") or "",
        "service_type": estimate.get("service_type", "fence_staining"),
        "previously_stained": inputs.get("previously_stained") or "No",
        "contact_email": lead.get("contact_email") or "",
        "military_discount": military_discount,
        "tiers": tiers,
        "sections": sections,
        "selections": proposal.get("selections") or [],
        "selected_tier": selected_tier,
        "booked_tier_price": selected_tier_price,
        "booked_total_price": proposal.get("booked_total_price"),
        "booked_at": proposal.get("booked_at"),
        "selected_color": proposal.get("selected_color"),
        "color_mode": color_mode,
        "hoa_colors": proposal.get("hoa_colors") or [],
        "custom_color": proposal.get("custom_color"),
        "color_display": color_display,
        "backup_dates": proposal.get("backup_dates") or [],
        "deposit_paid": bool(proposal.get("deposit_paid")),
        "funnel_stage": proposal.get("funnel_stage") or "sent",
        "fence_sides": inputs.get("fence_sides") or "",
        "custom_fence_sides": inputs.get("custom_fence_sides") or "",
        "last_active_at": proposal.get("last_active_at"),
        "left_page_at": proposal.get("left_page_at"),
    }

    # Cache for 30s on edge + browser — proposal data rarely changes mid-session
    return JSONResponse(
        content=data,
        headers={"Cache-Control": "public, max-age=30, stale-while-revalidate=60"},
    )


@router.post("/{token}/stage")
async def update_funnel_stage(token: str, body: StageUpdate):
    """Track customer funnel progress — no auth required."""
    if body.stage not in STAGE_ORDER:
        raise HTTPException(status_code=400, detail="Invalid stage")
    db = get_db()
    result = db.table("proposals").select("funnel_stage").eq("token", token).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Proposal not found")
    current = (result.data or {}).get("funnel_stage") or "sent"
    current_idx = STAGE_ORDER.index(current) if current in STAGE_ORDER else 0
    new_idx = STAGE_ORDER.index(body.stage)
    if new_idx > current_idx:
        db.table("proposals").update({"funnel_stage": body.stage}).eq("token", token).execute()

        # Trigger workflow engine on funnel stage change
        _WORKFLOW_EVENT_MAP = {
            "opened": "opened",
            "package_selected": "package_selected",
            "color_selected": "color_selected",
            "date_selected": "date_selected",
            "checkout_started": "checkout_started",
        }
        if body.stage in _WORKFLOW_EVENT_MAP:
            try:
                from services.workflow import on_proposal_event
                lead_res = db.table("proposals").select("lead_id").eq("token", token).single().execute()
                if lead_res.data:
                    on_proposal_event(lead_res.data["lead_id"], _WORKFLOW_EVENT_MAP[body.stage])
            except Exception as e:
                logger.error(f"Workflow on_proposal_event failed for token {token}: {e}")

        # Alert Alan on high-signal funnel milestones
        if body.stage in ("package_selected", "date_selected"):
            try:
                settings = get_settings()
                if settings.owner_ghl_contact_id:
                    prop = db.table("proposals").select("lead_id, selected_tier").eq("token", token).single().execute().data or {}
                    if prop.get("lead_id"):
                        lead = db.table("leads").select("contact_name").eq("id", prop["lead_id"]).single().execute().data or {}
                        full_name = lead.get("contact_name") or "A customer"
                        tier = (prop.get("selected_tier") or "").capitalize()
                        if body.stage == "package_selected" and tier:
                            msg = f"Proposal update: {full_name} selected the {tier} package."
                        elif body.stage == "date_selected":
                            msg = f"Proposal update: {full_name} has selected a date and is ready to confirm their booking."
                        else:
                            msg = None
                        if msg:
                            send_message_to_contact(settings.owner_ghl_contact_id, msg)
            except Exception as e:
                logger.error(f"Failed to send milestone SMS to Alan for token {token}: {e}")

    return {"status": "ok"}


@router.patch("/{token}/selection")
async def save_selection(token: str, body: SelectionUpdate):
    """Save mid-funnel selections (package, color mode, color) as the customer makes choices."""
    db = get_db()
    result = db.table("proposals").select("status").eq("token", token).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if result.data["status"] == "booked":
        return {"status": "ok"}  # Already booked — don't overwrite confirmed values

    updates: dict = {}
    if body.selections is not None:
        updates["selections"] = body.selections
        # Also set selected_tier from first selection for backward compat
        if body.selections:
            updates["selected_tier"] = body.selections[0].get("selected_tier")
    elif body.selected_tier is not None:
        updates["selected_tier"] = body.selected_tier
    if body.color_mode is not None:
        updates["color_mode"] = body.color_mode
    if body.selected_color is not None:
        updates["selected_color"] = body.selected_color
    if body.hoa_colors is not None:
        updates["hoa_colors"] = body.hoa_colors
    if body.custom_color is not None:
        updates["custom_color"] = body.custom_color

    if updates:
        db.table("proposals").update(updates).eq("token", token).execute()

    return {"status": "ok"}


@router.post("/{token}/activity")
async def report_activity(token: str, body: ActivityUpdate):
    """Track customer page activity — heartbeat or left page. No auth required."""
    if body.type not in ("heartbeat", "left"):
        raise HTTPException(status_code=400, detail="Invalid activity type")
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    if body.type == "heartbeat":
        db.table("proposals").update({"last_active_at": now, "left_page_at": None}).eq("token", token).execute()
    else:
        db.table("proposals").update({"last_active_at": now, "left_page_at": now}).eq("token", token).execute()
    return {"status": "ok"}


@router.post("/{token}/create-checkout")
async def create_checkout(token: str, body: CheckoutRequest):
    db = get_db()
    settings = get_settings()

    result = db.table("proposals").select("*").eq("token", token).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if result.data["status"] == "booked":
        raise HTTPException(status_code=409, detail="Already booked")
    if body.selected_tier not in ("essential", "signature", "legacy"):
        raise HTTPException(status_code=400, detail="Invalid tier")
    try:
        datetime.fromisoformat(body.booked_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid booked_at")

    # Store pending booking data
    pending_data: dict = {
        "selected_tier": body.selected_tier,
        "booked_at": body.booked_at,
        "contact_email": body.contact_email,
        "backup_dates": body.backup_dates,
        "selected_color": body.selected_color,
        "color_mode": body.color_mode,
        "hoa_colors": body.hoa_colors,
        "custom_color": body.custom_color,
        "additional_request": body.additional_request,
    }
    if body.selections:
        pending_data["selections"] = body.selections
    db.table("proposals").update({"pending_booking": pending_data}).eq("token", token).execute()

    # Bypass mode — no Stripe key configured (dev/testing only)
    if not settings.stripe_secret_key:
        logger.warning(f"STRIPE_BYPASS: no STRIPE_SECRET_KEY — skipping payment for proposal {token}")
        return {"checkout_url": f"{settings.frontend_url}/proposal/{token}?session_id=bypass"}

    import stripe as stripe_lib
    stripe_lib.api_key = settings.stripe_secret_key
    session = stripe_lib.checkout.Session.create(
        mode="payment",
        line_items=[{
            "price_data": {
                "currency": "usd",
                "unit_amount": 5000,
                "product_data": {"name": "Fence Restoration Deposit", "description": "Applied toward your total balance. Remaining balance due day of service."},
            },
            "quantity": 1,
        }],
        metadata={"proposal_token": token},
        success_url=f"{settings.frontend_url}/proposal/{token}?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{settings.frontend_url}/proposal/{token}",
    )
    return {"checkout_url": session.url}


async def _finalize_booking(
    *,
    token: str,
    proposal: dict,
    selected_tier: str,
    selections: list | None = None,
    booked_at_str: str,
    contact_email: str | None,
    backup_dates: list | None,
    selected_color: str | None,
    color_mode: str,
    hoa_colors: list | None,
    custom_color: str | None,
    additional_request: str | None,
    stripe_session_id: str | None,
    settings,
    db,
) -> dict:
    """Shared booking completion — called by redirect path and Stripe webhook."""
    try:
        booked_dt = datetime.fromisoformat(booked_at_str.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid booked_at datetime")

    parsed_backup_dates: list[str] = []
    for raw_date in (backup_dates or []):
        try:
            parsed_dt = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
            parsed_backup_dates.append(parsed_dt.date().isoformat())
        except ValueError:
            continue
    parsed_backup_dates = [d for d in parsed_backup_dates if d != booked_dt.date().isoformat()]
    parsed_backup_dates = list(dict.fromkeys(parsed_backup_dates))[:1]

    lead_result = db.table("leads").select("*").eq("id", proposal["lead_id"]).single().execute()
    lead = lead_result.data or {}

    # Multi-estimate: resolve all selected sections with their prices
    is_multi = bool(selections and len(selections) > 0)
    booked_sections: list[dict] = []  # [{label, tier_label, tier_price, estimate_id}, ...]
    booked_total_price = 0.0

    if is_multi:
        sel_est_ids = [s["estimate_id"] for s in selections]
        all_est_res = db.table("estimates").select("*").in_("id", sel_est_ids).execute()
        est_map = {e["id"]: e for e in (all_est_res.data or [])}
        for sel in selections:
            est = est_map.get(sel["estimate_id"], {})
            est_inputs = est.get("inputs") or {}
            est_tiers = _apply_discount(est_inputs.get("_tiers") or {}, bool(est_inputs.get("military_discount", False)))
            sel_tier = sel.get("selected_tier", selected_tier)
            sel_price = float(est_tiers.get(sel_tier, 0))
            booked_sections.append({
                "estimate_id": sel["estimate_id"],
                "label": est.get("label") or "",
                "tier_label": sel_tier.capitalize(),
                "tier_price": sel_price,
            })
            booked_total_price += sel_price
    else:
        # Single estimate (backward compat)
        est_result = db.table("estimates").select("*").eq("id", proposal["estimate_id"]).single().execute()
        estimate = est_result.data or {}
        est_inputs = estimate.get("inputs") or {}
        tiers = _apply_discount(est_inputs.get("_tiers") or {}, bool(est_inputs.get("military_discount", False)))
        tier_price = float(tiers.get(selected_tier, 0))
        booked_sections.append({
            "estimate_id": proposal["estimate_id"],
            "label": "",
            "tier_label": selected_tier.capitalize(),
            "tier_price": tier_price,
        })
        booked_total_price = tier_price

    customer_name = lead.get("contact_name") or "Customer"
    address = lead.get("address") or ""
    tier_label = booked_sections[0]["tier_label"] if booked_sections else selected_tier.capitalize()
    tier_price = booked_total_price
    date_str = booked_dt.strftime("%A, %B %-d at %-I:%M %p")

    color_display = ""
    if color_mode == "gallery" and selected_color:
        color_display = selected_color
    elif color_mode == "hoa_only" and hoa_colors:
        color_display = f"HOA multi-select: {', '.join(str(c) for c in hoa_colors)}"
    elif color_mode == "hoa_approved":
        color_display = f"HOA Approved: {custom_color or 'TBD'}"
    elif color_mode == "custom":
        color_display = f"Custom: {custom_color or 'TBD'}"

    backup_dates_text = "None selected"
    if parsed_backup_dates:
        backup_dates_text = ", ".join(
            datetime.fromisoformat(f"{d}T12:00:00").strftime("%A, %B %-d") for d in parsed_backup_dates
        )

    # Build calendar description with all sections
    if is_multi and len(booked_sections) > 1:
        pkg_lines = []
        for sec in booked_sections:
            lbl = f" ({sec['label']})" if sec["label"] else ""
            pkg_lines.append(f"  {sec['tier_label']} — ${sec['tier_price']:,.2f}{lbl}")
        pkg_desc = "\n".join(pkg_lines)
        summary = f"Fence Staining — {customer_name} (${booked_total_price:,.0f})"
        description = (
            f"Customer: {customer_name}\n"
            f"Address: {address}\n\n"
            f"Packages:\n{pkg_desc}\n"
            f"Total: ${booked_total_price:,.2f}\n\n"
            f"Color: {color_display or 'Not specified'}\n"
            f"Backup dates: {backup_dates_text}\n"
            f"Phone: {lead.get('contact_phone') or 'N/A'}\n"
            f"Booked via proposal link"
        )
    else:
        summary = f"Fence Staining — {customer_name} ({tier_label})"
        description = (
            f"Customer: {customer_name}\n"
            f"Address: {address}\n"
            f"Package: {tier_label} — ${tier_price:,.2f}\n"
            f"Color: {color_display or 'Not specified'}\n"
            f"Backup dates: {backup_dates_text}\n"
            f"Phone: {lead.get('contact_phone') or 'N/A'}\n"
            f"Booked via proposal link"
        )
    calendar_event_id = create_calendar_event(
        summary=summary, description=description, location=address,
        start_dt=booked_dt, duration_hours=4,
        credentials_json=settings.google_calendar_credentials_json,
        calendar_id=settings.google_calendar_id,
    )
    if not calendar_event_id:
        logger.warning(
            f"Calendar event was NOT created for proposal {token} "
            f"(calendar_id={settings.google_calendar_id!r}). "
            "Check GOOGLE_CALENDAR_CREDENTIALS_JSON and GOOGLE_CALENDAR_ID env vars. "
            "If using a shared team calendar, ensure the service account has Editor access."
        )

    if settings.owner_ghl_contact_id:
        if is_multi and len(booked_sections) > 1:
            pkg_lines = "\n".join(
                f"  {sec['tier_label']} — ${sec['tier_price']:,.0f}" + (f" ({sec['label']})" if sec["label"] else "")
                for sec in booked_sections
            )
            alan_msg = (
                f"📅 New Booking!\n"
                f"Customer: {customer_name}\n"
                f"Packages:\n{pkg_lines}\n"
                f"Total: ${booked_total_price:,.0f}\n"
                f"Color: {color_display or 'Not specified'}\n"
                f"Date: {date_str}\n"
                f"Backup: {backup_dates_text}\n"
                f"Address: {address}"
            )
        else:
            alan_msg = (
                f"📅 New Booking!\n"
                f"Customer: {customer_name}\n"
                f"Package: {tier_label} (${tier_price:,.0f})\n"
                f"Color: {color_display or 'Not specified'}\n"
                f"Date: {date_str}\n"
                f"Backup: {backup_dates_text}\n"
                f"Address: {address}"
            )
        if additional_request:
            alan_msg += f"\n\n🔧 Additional services requested: {additional_request}"
        sent = send_message_to_contact(settings.owner_ghl_contact_id, alan_msg)
        if not sent:
            logger.warning("Failed to send booking notification to Alan via GHL")
    else:
        logger.warning("OWNER_GHL_CONTACT_ID not set — Alan not notified")

    # Send booking confirmation SMS to customer via GHL
    customer_ghl_id = lead.get("ghl_contact_id")
    if customer_ghl_id:
        first = customer_name.split()[0] if customer_name else "there"
        color_line = color_display or "HOA color pending approval"
        backup_line = f"\n📅 Backup: {backup_dates_text}" if parsed_backup_dates else ""
        if is_multi and len(booked_sections) > 1:
            pkg_lines = "\n".join(
                f"  {sec['tier_label']} — ${sec['tier_price']:,.0f}" + (f" ({sec['label']})" if sec["label"] else "")
                for sec in booked_sections
            )
            customer_sms = (
                f"Hi {first}! 🎉 Your fence restoration is confirmed.\n\n"
                f"📦 Packages:\n{pkg_lines}\n"
                f"💰 Total: ${booked_total_price:,.0f}\n"
                f"🎨 Color: {color_line}\n"
                f"📅 Date: {date_str}{backup_line}\n"
                f"🏠 Address: {address}\n\n"
                f"Our crew arrives between 8:00–9:00 AM. "
                f"We'll send a reminder the night before.\n\n"
                f"Need to cancel or reschedule? Please let us know "
                f"at least 48 hours in advance.\n\n"
                f"— A&T's Fence Restoration"
            )
        else:
            customer_sms = (
                f"Hi {first}! 🎉 Your fence restoration is confirmed.\n\n"
                f"📦 Package: {tier_label} — ${booked_total_price:,.0f}\n"
                f"🎨 Color: {color_line}\n"
                f"📅 Date: {date_str}{backup_line}\n"
                f"🏠 Address: {address}\n\n"
                f"Our crew arrives between 8:00–9:00 AM. "
                f"We'll send a reminder the night before.\n\n"
                f"Need to cancel or reschedule? Please let us know "
                f"at least 48 hours in advance.\n\n"
                f"— A&T's Fence Restoration"
            )
        lead_add_svcs = ((lead.get("form_data") or {}).get("additional_services") or "").strip()
        if lead_add_svcs:
            customer_sms += (
                "\n\nOur team will also be in touch to discuss your additional service "
                "request — we'll reach out shortly to get more details."
            )
        sent_cust = send_message_to_contact(customer_ghl_id, customer_sms, location_id=lead.get("ghl_location_id"))
        if not sent_cust:
            logger.warning(f"Failed to send booking confirmation SMS to customer {customer_ghl_id}")

        # HOA-specific follow-up SMS with ranked color choices and hex codes
        if color_mode == "hoa_only" and hoa_colors:
            color_lines = []
            for i, name in enumerate(hoa_colors, 1):
                hex_code = HOA_COLOR_HEX.get(str(name), "")
                if hex_code:
                    color_lines.append(f"{i}. {name} ({hex_code})")
                else:
                    color_lines.append(f"{i}. {name}")
            hoa_sms = (
                f"Here are your ranked color choices for your HOA submission:\n\n"
                + "\n".join(color_lines)
                + "\n\nAll colors are from the Ready Seal Exterior Stain & Sealer line."
                "\n\nWe'll prepare a full HOA approval packet — spec sheets, color swatches,"
                " and a pre-written letter. Reply with your HOA board's email and we'll"
                " send it directly."
                "\n\n— A&T's Fence Restoration"
            )
            send_message_to_contact(customer_ghl_id, hoa_sms)
    else:
        logger.warning(f"No ghl_contact_id on lead {proposal['lead_id']} — skipping customer confirmation SMS")

    booking_now = datetime.now(timezone.utc).isoformat()
    proposal_update: dict = {
        "status": "booked",
        "funnel_stage": "booked",
        "selected_tier": selected_tier,
        "booked_tier_price": float(booked_sections[0]["tier_price"] if booked_sections else 0),
        "booked_at": booked_dt.isoformat(),
        "booking_completed_at": booking_now,
        "calendar_event_id": calendar_event_id,
        "backup_dates": parsed_backup_dates,
        "selected_color": selected_color,
        "color_mode": color_mode,
        "hoa_colors": hoa_colors,
        "custom_color": custom_color,
        "stripe_session_id": stripe_session_id,
        "deposit_paid": bool(stripe_session_id),
        "deposit_paid_at": booking_now if stripe_session_id else None,
    }
    # Always store total price; store selections for multi-estimate
    proposal_update["booked_total_price"] = booked_total_price
    if is_multi and selections:
        proposal_update["selections"] = selections
    db.table("proposals").update(proposal_update).eq("token", token).execute()

    # Ensure a schedule_slot row exists for the booked date so it appears on the dashboard calendar
    booked_date_str = booked_dt.date().isoformat()
    existing_slot = db.table("schedule_slots").select("date, max_bookings").eq("date", booked_date_str).execute()
    if not existing_slot.data:
        db.table("schedule_slots").insert({
            "date": booked_date_str,
            "is_available": True,
            "label": "",
            "max_bookings": 1,
        }).execute()
        logger.info(f"Auto-created schedule slot for booked date {booked_date_str}")

    logger.info(f"Proposal {token} booked: {tier_label} on {date_str} for {customer_name}")

    if settings.ghl_booked_stage_id:
        opp_res = db.table("leads").select("ghl_opportunity_id").eq("id", proposal["lead_id"]).single().execute()
        opp_id = (opp_res.data or {}).get("ghl_opportunity_id")
        if opp_id:
            moved = update_opportunity_stage(opp_id, settings.ghl_booked_stage_id)
            if not moved:
                logger.warning(f"Failed to move GHL opportunity {opp_id} to booked stage")

    result = {
        "status": "booked",
        "booked_at": booked_dt.isoformat(),
        "selected_tier": selected_tier,
        "booked_tier_price": float(booked_sections[0]["tier_price"] if booked_sections else 0),
        "booked_total_price": booked_total_price,
        "color_display": color_display or "Not specified",
        "backup_dates": parsed_backup_dates,
        "deposit_paid": bool(stripe_session_id),
        "address": address,
    }
    if is_multi and selections:
        result["selections"] = selections
    return result


@router.post("/{token}/book")
async def book_proposal(token: str, body: BookingRequest):
    """Customer submits their tier choice + date. Creates calendar event, notifies Alan."""
    db = get_db()
    settings = get_settings()

    result = db.table("proposals").select("*").eq("token", token).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Proposal not found")

    proposal = result.data
    if proposal["status"] == "booked":
        raise HTTPException(status_code=409, detail="This proposal has already been booked")

    # If coming from Stripe redirect, verify payment and load pending booking data
    if body.stripe_session_id:
        settings_inner = get_settings()
        if body.stripe_session_id == "bypass":
            # Dev bypass — only allowed when Stripe is not configured
            if settings_inner.stripe_secret_key:
                raise HTTPException(status_code=400, detail="Payment bypass not allowed in production")
            logger.warning(f"STRIPE_BYPASS: booking proposal {token} without payment")
        else:
            if not settings_inner.stripe_secret_key:
                raise HTTPException(status_code=503, detail="Payment not configured")
            import stripe as stripe_lib
            stripe_lib.api_key = settings_inner.stripe_secret_key
            try:
                session = stripe_lib.checkout.Session.retrieve(body.stripe_session_id)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Could not verify payment: {e}")
            if session.payment_status != "paid":
                raise HTTPException(status_code=400, detail="Payment not completed")
            if session.metadata.get("proposal_token") != token:
                raise HTTPException(status_code=400, detail="Payment does not match this proposal")
        # Load pending booking from DB
        pending_result = db.table("proposals").select("pending_booking").eq("token", token).single().execute()
        pending = (pending_result.data or {}).get("pending_booking") or {}
        body.selected_tier = pending.get("selected_tier") or body.selected_tier
        body.booked_at = pending.get("booked_at") or body.booked_at
        body.contact_email = pending.get("contact_email")
        body.backup_dates = pending.get("backup_dates") or []
        body.selected_color = pending.get("selected_color")
        body.color_mode = pending.get("color_mode", "gallery")
        body.hoa_colors = pending.get("hoa_colors")
        body.custom_color = pending.get("custom_color")
        body.additional_request = pending.get("additional_request")
        body.selections = pending.get("selections")

    if body.selected_tier not in ("essential", "signature", "legacy"):
        raise HTTPException(status_code=400, detail="Invalid tier")

    return await _finalize_booking(
        token=token, proposal=proposal,
        selected_tier=body.selected_tier, selections=body.selections,
        booked_at_str=body.booked_at,
        contact_email=body.contact_email, backup_dates=body.backup_dates,
        selected_color=body.selected_color, color_mode=body.color_mode,
        hoa_colors=body.hoa_colors, custom_color=body.custom_color,
        additional_request=body.additional_request,
        stripe_session_id=body.stripe_session_id, settings=settings, db=db,
    )


# ── PDF proposal serving ───────────────────────────────────────────────

@router.get("/{token}/pdf-file")
async def get_proposal_pdf(token: str):
    """Public endpoint — serves the generated PDF for a PDF-version proposal."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pdf_data FROM proposals WHERE token = %s AND pdf_data IS NOT NULL",
                (token,),
            )
            row = cur.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="PDF proposal not found")

    pdf_bytes = bytes(row[0])

    # Mark as viewed (same as interactive proposals)
    db = get_db()
    proposal = db.table("proposals").select("status").eq("token", token).single().execute()
    if proposal.data and proposal.data["status"] == "sent":
        now = datetime.now(timezone.utc).isoformat()
        db.table("proposals").update({"status": "viewed", "first_viewed_at": now}).eq("token", token).execute()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=AT-Fence-Proposal.pdf"},
    )
