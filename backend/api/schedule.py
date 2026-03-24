"""Schedule slots API — public read + admin write for booking availability calendar."""
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import get_db
from api.auth import require_admin
from config import get_settings
from services.google_calendar import get_banana_event_dates, get_banana_events
from services.ghl import send_message_to_contact

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

    # Fetch Alan's banana-colored calendar events for the dashboard view (with full details)
    calendar_blocked = get_banana_events(
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


@router.get("/api/admin/schedule/test-calendar")
async def test_calendar_connection():
    """Debug — tests the Google Calendar connection and returns diagnostic info."""
    settings = get_settings()

    result = {
        "calendar_id": settings.google_calendar_id,
        "credentials_set": bool(settings.google_calendar_credentials_json),
        "status": "unknown",
        "error": None,
        "total_events": 0,
        "banana_events": [],
    }

    if not settings.google_calendar_credentials_json:
        result["status"] = "error"
        result["error"] = "GOOGLE_CALENDAR_CREDENTIALS_JSON env var is not set"
        return result

    try:
        import json
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        time_min = datetime(now.year, now.month, 1, tzinfo=timezone.utc).isoformat()
        mo_next = now.month + 1 if now.month < 12 else 1
        yr_next = now.year if now.month < 12 else now.year + 1
        time_max = datetime(yr_next, mo_next, 1, tzinfo=timezone.utc).isoformat()

        creds_dict = json.loads(settings.google_calendar_credentials_json)
        result["service_account_email"] = creds_dict.get("client_email", "unknown")

        credentials = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
        service = build("calendar", "v3", credentials=credentials, cache_discovery=False)

        events_result = service.events().list(
            calendarId=settings.google_calendar_id,
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
        ).execute()

        events = events_result.get("items", [])
        result["total_events"] = len(events)
        result["status"] = "ok"

        for e in events:
            color_id = e.get("colorId", "none")
            start = e.get("start", {})
            date_str = start.get("date") or (start.get("dateTime") or "")[:10]
            result["banana_events" if color_id == "5" else "status"]  # just collecting banana ones below

        result["banana_events"] = [
            {
                "date": (e.get("start", {}).get("date") or (e.get("start", {}).get("dateTime") or "")[:10]),
                "summary": e.get("summary", "(no title)"),
                "colorId": e.get("colorId"),
            }
            for e in events if e.get("colorId") == "5"
        ]
        result["all_event_colors"] = list({e.get("colorId", "none") for e in events})

    except Exception as ex:
        result["status"] = "error"
        result["error"] = str(ex)

    return result


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


# ── Date request queue ────────────────────────────────────────────────────────

@router.get("/api/admin/schedule/date-requests")
async def get_date_requests(_: dict = Depends(require_admin)):
    """Admin — returns booked proposals with a pending alternate-date request (backup_dates non-empty)."""
    db = get_db()
    proposals_res = (
        db.table("proposals")
        .select("id, booked_at, backup_dates, lead_id, selected_tier, booked_tier_price, selected_color, color_mode, hoa_colors")
        .eq("status", "booked")
        .execute()
    ).data or []

    # Only proposals that actually have a backup/requested date
    pending = [p for p in proposals_res if p.get("backup_dates")]

    lead_ids = list({p["lead_id"] for p in pending if p.get("lead_id")})
    lead_map: dict[str, dict] = {}
    if lead_ids:
        leads_res = db.table("leads").select("id, contact_name, contact_phone, address, form_data").in_("id", lead_ids).execute()
        lead_map = {l["id"]: l for l in (leads_res.data or [])}

    result = []
    for p in pending:
        lead = lead_map.get(p.get("lead_id", ""), {})
        backup = p["backup_dates"]
        requested_date = backup[0] if isinstance(backup, list) and backup else str(backup)

        # Compute color display
        color_mode = p.get("color_mode") or "gallery"
        if color_mode == "gallery" and p.get("selected_color"):
            color_display = p["selected_color"]
        elif color_mode in ("hoa_only", "hoa_approved") and p.get("hoa_colors"):
            hoa = p["hoa_colors"]
            color_display = ", ".join(str(c) for c in hoa) if isinstance(hoa, list) else str(hoa)
        elif color_mode == "custom":
            color_display = "Custom color"
        else:
            color_display = None

        if color_mode == "hoa_only":
            hoa_label = "HOA Colors Only"
        elif color_mode == "hoa_approved":
            hoa_label = "HOA Approved"
        else:
            hoa_label = None

        form_data = lead.get("form_data") or {}
        result.append({
            "proposal_id": p["id"],
            "customer_name": lead.get("contact_name") or "Unknown",
            "contact_phone": lead.get("contact_phone") or "",
            "address": lead.get("address") or "",
            "booked_at": str(p["booked_at"])[:10],
            "requested_date": requested_date,
            "selected_tier": p.get("selected_tier") or "",
            "tier_price": float(p.get("booked_tier_price") or 0),
            "color_display": color_display,
            "hoa_label": hoa_label,
            "linear_feet": form_data.get("linear_feet") or None,
            "fence_height": form_data.get("fence_height") or None,
        })

    return sorted(result, key=lambda r: r["requested_date"])


@router.post("/api/admin/schedule/date-requests/{proposal_id}/approve")
async def approve_date_request(proposal_id: str, _: dict = Depends(require_admin)):
    """Admin — approve: swap booked_at to the requested date, clear backup_dates, and SMS the customer."""
    db = get_db()
    row = (
        db.table("proposals")
        .select("id, backup_dates, lead_id")
        .eq("id", proposal_id)
        .single()
        .execute()
    ).data
    if not row or not row.get("backup_dates"):
        raise HTTPException(status_code=404, detail="Request not found")

    backup = row["backup_dates"]
    new_date_str = backup[0] if isinstance(backup, list) else str(backup)
    new_booked_at = datetime.fromisoformat(f"{new_date_str}T09:00:00+00:00")

    db.table("proposals").update({
        "booked_at": new_booked_at.isoformat(),
        "backup_dates": [],
    }).eq("id", proposal_id).execute()

    # Ensure a schedule_slot exists for the new date
    existing = db.table("schedule_slots").select("date").eq("date", new_date_str).execute()
    if not existing.data:
        db.table("schedule_slots").insert({
            "date": new_date_str,
            "is_available": True,
            "label": "",
            "max_bookings": 1,
        }).execute()

    # SMS the customer with their updated date
    if row.get("lead_id"):
        lead = (
            db.table("leads")
            .select("contact_name, ghl_contact_id")
            .eq("id", row["lead_id"])
            .single()
            .execute()
        ).data or {}
        ghl_contact_id = lead.get("ghl_contact_id")
        if ghl_contact_id:
            first = (lead.get("contact_name") or "there").split()[0]
            friendly_date = new_booked_at.strftime("%A, %B %-d")
            sms = (
                f"Hi {first}! Good news, we were able to get you on {friendly_date} "
                f"for your fence restoration. Your booking has been updated to that date.\n\n"
                f"See you then!\nA&T's Fence Restoration"
            )
            send_message_to_contact(ghl_contact_id, sms)

    return {"status": "approved", "new_date": new_date_str}


@router.post("/api/admin/schedule/date-requests/{proposal_id}/decline")
async def decline_date_request(proposal_id: str, _: dict = Depends(require_admin)):
    """Admin — decline: keep original booked_at, clear backup_dates, SMS customer."""
    db = get_db()

    row = (
        db.table("proposals")
        .select("id, backup_dates, lead_id, booked_at")
        .eq("id", proposal_id)
        .single()
        .execute()
    ).data
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")

    db.table("proposals").update({"backup_dates": []}).eq("id", proposal_id).execute()

    # SMS the customer: their alternate date wasn't available, original date still stands
    if row.get("lead_id"):
        lead = (
            db.table("leads")
            .select("contact_name, ghl_contact_id")
            .eq("id", row["lead_id"])
            .single()
            .execute()
        ).data or {}
        ghl_contact_id = lead.get("ghl_contact_id")
        if ghl_contact_id and row.get("booked_at"):
            first = (lead.get("contact_name") or "there").split()[0]
            try:
                original_dt = datetime.fromisoformat(str(row["booked_at"]).replace("Z", "+00:00"))
                friendly_date = original_dt.strftime("%A, %B %-d")
            except ValueError:
                friendly_date = str(row["booked_at"])[:10]
            sms = (
                f"Hi {first}, unfortunately we weren't able to accommodate your alternate date request. "
                f"Your original booking on {friendly_date} is still confirmed.\n\n"
                f"If you'd like to reschedule, just give us a call and we'll do our best to find a time that works.\n\n"
                f"— A&T's Fence Restoration"
            )
            send_message_to_contact(ghl_contact_id, sms)

    return {"status": "declined"}
