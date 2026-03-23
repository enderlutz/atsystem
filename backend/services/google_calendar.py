"""Google Calendar service — creates job booking events using a service account."""
import json
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


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
