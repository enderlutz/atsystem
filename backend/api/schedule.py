"""Schedule slots API — public read + admin write for booking availability calendar."""
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import get_db
from api.auth import require_admin

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
    Filters out dates where booked proposal count >= max_bookings.
    month: "YYYY-MM" — defaults to current month.
    """
    db = get_db()

    if month:
        try:
            year, mo = month.split("-")
            start = f"{year}-{mo}-01"
            # Last day of month: advance to next month, subtract 1 day
            mo_int = int(mo)
            if mo_int == 12:
                end = f"{int(year)+1}-01-01"
            else:
                end = f"{year}-{mo_int+1:02d}-01"
        except ValueError:
            raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    else:
        now = datetime.now(timezone.utc)
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

    available = []
    for slot in slots:
        if not slot.get("is_available"):
            continue
        date_str = str(slot["date"])
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
    """Admin — returns all schedule slots with booking counts."""
    db = get_db()

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
        .select("booked_at")
        .eq("status", "booked")
        .execute()
    ).data or []

    booked_dates: dict[str, int] = {}
    for p in proposals_res:
        if p.get("booked_at"):
            date_str = str(p["booked_at"])[:10]
            booked_dates[date_str] = booked_dates.get(date_str, 0) + 1

    return [
        {
            "date": str(s["date"]),
            "is_available": s["is_available"],
            "label": s.get("label") or "",
            "max_bookings": s["max_bookings"],
            "booked_count": booked_dates.get(str(s["date"]), 0),
        }
        for s in slots
    ]


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
