"""Schedule slots API — public read + admin write for booking availability calendar."""
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import get_db
from api.auth import require_admin
from config import get_settings
from services.google_calendar import get_banana_event_dates

router = APIRouter(tags=["schedule"])


class SlotUpsert(BaseModel):
    date: str          # "2026-03-15"
    is_available: bool = True
    label: Optional[str] = None
    max_bookings: int = 1


# ── Public endpoint ──────────────────────────────────────────────────────────

@router.get("/api/schedule")
async def get_available_dates(month: Optional[str] = None):
    """
    Public — returns dates customers can book.
    Filters out dates where booked proposal count >= max_bookings,
    and dates that have banana-colored events on Alan's Google Calendar.
    month: "YYYY-MM" — defaults to current month.
    """
    db = get_db()
    settings = get_settings()

    if month:
        try:
            year, mo = month.split("-")
            start = f"{year}-{mo}-01"
            mo_int = int(mo)
            if mo_int == 12:
                end = f"{int(year)+1}-01-01"
            else:
                end = f"{year}-{mo_int+1:02d}-01"
        except ValueError:
            raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    else:
        now = datetime.now(timezone.utc)
        month = f"{now.year}-{now.month:02d}"
        start = f"{now.year}-{now.month:02d}-01"
        mo_int = now.month
        if mo_int == 12:
            end = f"{now.year+1}-01-01"
        else:
            end = f"{now.year}-{mo_int+1:02d}-01"

    slots = (
        db.table("schedule_slots")
        .select("*")
        .gte("date", start)
        .order("date")
        .execute()
    ).data or []

    # Filter to before end of month
    slots = [s for s in slots if str(s["date"]) < end]

    # Count bookings per date
    proposals_res = (
        db.table("proposals")
        .select("booked_at")
        .eq("status", "booked")
        .execute()
    ).data or []

    booked_dates: dict[str, int] = {}
    for p in proposals_res:
        if p.get("booked_at"):
            date_str = str(p["booked_at"])[:10]
            booked_dates[date_str] = booked_dates.get(date_str, 0) + 1

    # Fetch Alan's banana-colored events — these block dates from customer booking
    alan_blocked = set(get_banana_event_dates(
        month=month,
        credentials_json=settings.google_calendar_credentials_json,
        calendar_id=settings.google_calendar_id,
    ))

    available = []
    for slot in slots:
        if not slot.get("is_available"):
            continue
        date_str = str(slot["date"])
        if date_str in alan_blocked:
            continue  # Alan already has an appointment this day
        booked = booked_dates.get(date_str, 0)
        spots = slot["max_bookings"] - booked
        if spots > 0:
            available.append({
                "date": date_str,
                "label": slot.get("label") or "",
                "spots_remaining": spots,
            })

    return available


# ── Admin endpoints ──────────────────────────────────────────────────────────

@router.get("/api/admin/schedule")
async def get_admin_schedule(month: Optional[str] = None):
    """Admin — returns all schedule slots with booking counts, plus Alan's calendar-blocked dates."""
    db = get_db()
    settings = get_settings()

    if month:
        try:
            year, mo = month.split("-")
            start = f"{year}-{mo}-01"
            mo_int = int(mo)
            if mo_int == 12:
                end = f"{int(year)+1}-01-01"
            else:
                end = f"{year}-{mo_int+1:02d}-01"
        except ValueError:
            raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    else:
        now = datetime.now(timezone.utc)
        month = f"{now.year}-{now.month:02d}"
        start = f"{now.year}-{now.month:02d}-01"
        mo_int = now.month
        if mo_int == 12:
            end = f"{now.year+1}-01-01"
        else:
            end = f"{now.year}-{mo_int+1:02d}-01"

    slots = (
        db.table("schedule_slots")
        .select("*")
        .gte("date", start)
        .order("date")
        .execute()
    ).data or []

    slots = [s for s in slots if str(s["date"]) < end]

    proposals_res = (
        db.table("proposals")
        .select("booked_at, selected_tier, booked_tier_price, lead_id, selected_color, color_mode, hoa_colors")
        .eq("status", "booked")
        .execute()
    ).data or []

    # Fetch lead info for all booked proposals
    lead_ids = list({p["lead_id"] for p in proposals_res if p.get("lead_id")})
    lead_map: dict[str, dict] = {}
    if lead_ids:
        leads_res = db.table("leads").select("id, contact_name, contact_phone, form_data").in_("id", lead_ids).execute()
        lead_map = {l["id"]: l for l in (leads_res.data or [])}

    booked_dates: dict[str, int] = {}
    bookings_by_date: dict[str, list] = {}
    for p in proposals_res:
        if p.get("booked_at"):
            date_str = str(p["booked_at"])[:10]
            booked_dates[date_str] = booked_dates.get(date_str, 0) + 1
            lead = lead_map.get(p.get("lead_id", ""), {})
            form_data = lead.get("form_data") or {}

            # Determine color display
            color_mode = p.get("color_mode") or "gallery"
            if color_mode == "gallery" and p.get("selected_color"):
                color_display = p["selected_color"]
            elif color_mode in ("hoa_only", "hoa_approved") and p.get("hoa_colors"):
                hoa = p["hoa_colors"]
                if isinstance(hoa, list):
                    color_display = ", ".join(str(c) for c in hoa)
                else:
                    color_display = str(hoa)
            elif color_mode == "custom":
                color_display = "Custom color"
            else:
                color_display = None

            # Derive HOA label from color_mode
            if color_mode == "hoa_only":
                hoa_label = "HOA Colors Only"
            elif color_mode == "hoa_approved":
                hoa_label = "HOA Approved"
            else:
                hoa_label = None

            bookings_by_date.setdefault(date_str, []).append({
                "customer_name": lead.get("contact_name") or "Unknown",
                "contact_phone": lead.get("contact_phone") or "",
                "selected_tier": p.get("selected_tier") or "",
                "tier_price": float(p.get("booked_tier_price") or 0),
                "booked_at": p.get("booked_at") or "",
                "color_display": color_display,
                "hoa_label": hoa_label,
                "linear_feet": form_data.get("linear_feet") or None,
                "fence_height": form_data.get("fence_height") or None,
            })

    # Fetch Alan's banana-colored calendar events for the dashboard view
    calendar_blocked = get_banana_event_dates(
        month=month,
        credentials_json=settings.google_calendar_credentials_json,
        calendar_id=settings.google_calendar_id,
    )

    return {
        "slots": [
            {
                "date": str(s["date"]),
                "is_available": s["is_available"],
                "label": s.get("label") or "",
                "max_bookings": s["max_bookings"],
                "booked_count": booked_dates.get(str(s["date"]), 0),
                "bookings": bookings_by_date.get(str(s["date"]), []),
            }
            for s in slots
        ],
        "calendar_blocked": calendar_blocked,
    }


@router.post("/api/admin/schedule")
async def upsert_schedule_slot(body: SlotUpsert, _: dict = Depends(require_admin)):
    """Admin — add or update a booking slot."""
    db = get_db()

    existing = (
        db.table("schedule_slots")
        .select("date")
        .eq("date", body.date)
        .execute()
    ).data

    if existing:
        db.table("schedule_slots").update({
            "is_available": body.is_available,
            "label": body.label or "",
            "max_bookings": body.max_bookings,
        }).eq("date", body.date).execute()
    else:
        db.table("schedule_slots").insert({
            "date": body.date,
            "is_available": body.is_available,
            "label": body.label or "",
            "max_bookings": body.max_bookings,
        }).execute()

    return {"status": "ok", "date": body.date}


@router.delete("/api/admin/schedule/{date}")
async def delete_schedule_slot(date: str, _: dict = Depends(require_admin)):
    """Admin — remove a slot entirely."""
    db = get_db()
    db.table("schedule_slots").delete().eq("date", date).execute()
    return {"status": "deleted", "date": date}
