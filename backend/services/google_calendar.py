"""Google Calendar service — creates job booking events using a service account."""
import json
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

# Google Calendar colorId for "Banana" (yellow) — Alan uses this for client appointments
BANANA_COLOR_ID = "5"


def create_calendar_event(
    summary: str,
    description: str,
    location: str,
    start_dt: datetime,
    duration_hours: int = 4,
    credentials_json: str = "",
    calendar_id: str = "primary",
) -> str | None:
    """
    Creates a Google Calendar event and returns the event ID.
    Returns None if credentials are not configured or on failure.
    """
    if not credentials_json:
        logger.warning("GOOGLE_CALENDAR_CREDENTIALS_JSON not set — skipping calendar event")
        return None

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        creds_dict = json.loads(credentials_json)
        credentials = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
        service = build("calendar", "v3", credentials=credentials, cache_discovery=False)

        end_dt = start_dt + timedelta(hours=duration_hours)

        event = {
            "summary": summary,
            "location": location,
            "description": description,
            "start": {
                "dateTime": start_dt.isoformat(),
                "timeZone": "America/Chicago",
            },
            "end": {
                "dateTime": end_dt.isoformat(),
                "timeZone": "America/Chicago",
            },
        }

        logger.info(f"Creating calendar event on calendar_id={calendar_id!r}")
        created = service.events().insert(calendarId=calendar_id, body=event).execute()
        event_id = created.get("id")
        logger.info(f"Calendar event created: {event_id}")
        return event_id

    except Exception as e:
        logger.error(f"Failed to create calendar event: {e}")
        return None


def get_banana_events(
    month: str,  # "YYYY-MM"
    credentials_json: str = "",
    calendar_id: str = "primary",
) -> list[dict]:
    """
    Returns banana/yellow-colored events on Alan's calendar with full details.
    Each entry: {date, summary, start_time (HH:MM AM/PM or None for all-day)}.
    Falls back to empty list if credentials aren't set or the API call fails.
    """
    if not credentials_json:
        return []

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        year_str, mo_str = month.split("-")
        year, mo_int = int(year_str), int(mo_str)
        time_min = datetime(year, mo_int, 1, tzinfo=timezone.utc)
        if mo_int == 12:
            time_max = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        else:
            time_max = datetime(year, mo_int + 1, 1, tzinfo=timezone.utc)

        creds_dict = json.loads(credentials_json)
        credentials = service_account.Credentials.from_service_account_info(
            creds_dict,
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
        service = build("calendar", "v3", credentials=credentials, cache_discovery=False)

        result = service.events().list(
            calendarId=calendar_id,
            timeMin=time_min.isoformat(),
            timeMax=time_max.isoformat(),
            singleEvents=True,
            orderBy="startTime",
        ).execute()

        events: list[dict] = []
        seen_dates: set[str] = set()
        for event in result.get("items", []):
            if event.get("colorId") != BANANA_COLOR_ID:
                continue
            start_info = event.get("start", {})
            date_str = start_info.get("date") or (start_info.get("dateTime") or "")[:10]
            if not date_str:
                continue
            # Parse time from dateTime if present (timed event)
            start_time = None
            if start_info.get("dateTime"):
                try:
                    dt = datetime.fromisoformat(start_info["dateTime"])
                    start_time = dt.strftime("%-I:%M %p")
                except Exception:
                    pass
            # Group multiple events on the same day — append to existing entry
            if date_str in seen_dates:
                for e in events:
                    if e["date"] == date_str:
                        e["summary"] = e["summary"] + " / " + (event.get("summary") or "Appointment")
                        break
            else:
                seen_dates.add(date_str)
                events.append({
                    "date": date_str,
                    "summary": event.get("summary") or "Appointment",
                    "start_time": start_time,
                })

        logger.info(f"Found {len(events)} banana-color events for {month}")
        return sorted(events, key=lambda e: e["date"])

    except Exception as e:
        logger.error(f"Failed to fetch banana calendar events: {e}")
        return []


def get_banana_event_dates(
    month: str,
    credentials_json: str = "",
    calendar_id: str = "primary",
) -> list[str]:
    """Returns just the dates (YYYY-MM-DD) of banana events — used by the public booking endpoint."""
    return [e["date"] for e in get_banana_events(month, credentials_json, calendar_id)]
