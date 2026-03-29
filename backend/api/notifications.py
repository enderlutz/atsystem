"""Lightweight notifications API for the dashboard notification bell."""
from __future__ import annotations

from fastapi import APIRouter, Query, Depends
from db import get_db
from api.auth import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/recent")
async def get_recent_notifications(
    since: str | None = Query(default=None, description="ISO timestamp — count events after this"),
    limit: int = Query(default=20, le=50),
    _: dict = Depends(get_current_user),
):
    """Return recent automation events + count of new events since a given timestamp."""
    db = get_db()

    # Recent events (always return the latest N)
    query = (
        db.table("automation_log")
        .select("id, lead_id, event_type, detail, metadata, created_at")
        .order("created_at", desc=True)
        .limit(limit)
    )
    res = query.execute()
    events = res.data or []

    # Enrich with lead names
    lead_ids = list({e["lead_id"] for e in events if e.get("lead_id")})
    lead_names: dict[str, str] = {}
    if lead_ids:
        leads_res = db.table("leads").select("id, contact_name").in_("id", lead_ids).execute()
        lead_names = {r["id"]: r.get("contact_name", "") for r in (leads_res.data or [])}

    enriched = [
        {**e, "contact_name": lead_names.get(e.get("lead_id", ""), "")}
        for e in events
    ]

    # Count of events since the given timestamp (for unread badge)
    count_since = 0
    if since:
        count_res = (
            db.table("automation_log")
            .select("id")
            .gt("created_at", since)
            .execute()
        )
        count_since = len(count_res.data or [])

    return {"events": enriched, "count_since": count_since}
