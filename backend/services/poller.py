"""
GHL Pipeline Poller — runs every 5 minutes to keep leads in sync with GHL.
Imports new pipeline leads and refreshes data for existing ones.
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 300  # 5 minutes


async def poll_ghl_contacts():
    """Background loop: sync the GHL pipeline into the dashboard every 5 minutes."""
    await asyncio.sleep(5)  # Let app finish startup
    logger.info("GHL pipeline poller started (every 5 minutes)")

    while True:
        try:
            from api.sync import run_pipeline_sync
            result = await run_pipeline_sync()
            if result.get("status") == "done":
                logger.info(
                    f"Auto-sync complete: {result['imported']} imported, "
                    f"{result['updated']} updated, {result['errors']} errors"
                )
            else:
                logger.warning(f"Auto-sync issue: {result.get('message', result)}")
        except Exception as e:
            logger.error(f"GHL pipeline poll error: {e}")

        await asyncio.sleep(POLL_INTERVAL_SECONDS)
