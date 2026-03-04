from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Any
from datetime import datetime, timezone

from db import get_db
from config import get_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


class PricingUpdate(BaseModel):
    service_type: str
    config: dict[str, Any]


@router.get("/pricing")
async def get_pricing():
    db = get_db()
    res = db.table("pricing_config").select("*").execute()
    return res.data or []


@router.put("/pricing")
async def update_pricing(body: PricingUpdate):
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()

    existing = (
        db.table("pricing_config")
        .select("id")
        .eq("service_type", body.service_type)
        .execute()
    )

    if existing.data:
        db.table("pricing_config").update({
            "config": body.config,
            "updated_at": now,
        }).eq("service_type", body.service_type).execute()
    else:
        db.table("pricing_config").insert({
            "service_type": body.service_type,
            "config": body.config,
            "updated_at": now,
        }).execute()

    return {"status": "saved", "service_type": body.service_type}


@router.get("/stats")
async def get_stats():
    """Dashboard KPI stats."""
    from datetime import timedelta
    db = get_db()
    now = datetime.now(timezone.utc)
    week_ago = (now - timedelta(days=7)).isoformat()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()

    pending = db.table("estimates").select("id", count="exact").eq("status", "pending").execute()
    leads_week = db.table("leads").select("id", count="exact").gte("created_at", week_ago).execute()
    approved_month = (
        db.table("estimates")
        .select("id,estimate_low", count="exact")
        .in_("status", ["approved", "adjusted"])
        .gte("approved_at", month_start)
        .execute()
    )

    revenue = sum(r.get("estimate_low", 0) for r in (approved_month.data or []))

    return {
        "pending_estimates": pending.count or 0,
        "leads_this_week": leads_week.count or 0,
        "approved_this_month": approved_month.count or 0,
        "revenue_estimate_this_month": revenue,
    }
