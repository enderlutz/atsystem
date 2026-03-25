"""
Persistent automation activity log.
Writes events to the automation_log table for dashboard visibility.
"""
from __future__ import annotations

import logging
import uuid

logger = logging.getLogger(__name__)


def log_event(
    lead_id: str,
    event_type: str,
    detail: str,
    metadata: dict | None = None,
) -> None:
    """Insert a single automation event into the log.

    Fails silently — logging should never break the workflow.
    """
    try:
        from db import get_db
        db = get_db()
        db.table("automation_log").insert({
            "id": str(uuid.uuid4()),
            "lead_id": lead_id,
            "event_type": event_type,
            "detail": detail,
            "metadata": metadata or {},
        }).execute()
    except Exception as e:
        logger.warning(f"Failed to write automation log: {e}")
