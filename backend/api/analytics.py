"""Advanced analytics endpoints for the operations dashboard."""
from __future__ import annotations

import calendar
from datetime import datetime, timedelta, timezone
from typing import Optional

import psycopg2.extras
from fastapi import APIRouter, Depends, Query

from api.auth import get_current_user
from db import get_conn

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

STAGE_LABELS = {
    "new_lead": "New Lead",
    "new_build": "New Build",
    "asking_address": "Asking Address",
    "hot_lead": "Hot Lead",
    "proposal_sent": "Proposal Sent",
    "no_package_selection": "No Package",
    "package_selected": "Package Selected",
    "no_date_selected": "No Date",
    "date_selected": "Date Selected",
    "deposit_paid": "Deposit Paid",
    "additional_service": "Add-on Service",
    "job_complete": "Job Complete",
    "cold_nurture": "Cold Nurture",
    "past_customer": "Past Customer",
}


def _period_cutoff(period: str) -> Optional[datetime]:
    """Convert period string to a UTC cutoff datetime."""
    mapping = {"7d": 7, "30d": 30, "90d": 90}
    days = mapping.get(period)
    if days is None:
        return None
    return datetime.now(timezone.utc) - timedelta(days=days)


def _rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


def _one(cur) -> dict:
    r = cur.fetchone()
    return dict(r) if r else {}


# ---------------------------------------------------------------------------
# Endpoint 1: Revenue analytics
# ---------------------------------------------------------------------------

@router.get("/revenue")
def analytics_revenue(
    period: str = Query("30d"),
    _user: dict = Depends(get_current_user),
):
    cutoff = _period_cutoff(period)
    now = datetime.now(timezone.utc)

    # Current month boundaries
    cur_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    cur_month_end = cur_month_start + timedelta(days=days_in_month)

    # Previous month boundaries
    prev_month_end = cur_month_start
    prev_month_start = (prev_month_end - timedelta(days=1)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    days_elapsed = max(now.day, 1)

    cutoff_clause = "AND p.booked_at >= %s" if cutoff else ""
    cutoff_params: list = [cutoff] if cutoff else []

    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # 1. Total revenue, bookings, avg deal
            sql = f"""
                SELECT
                    COALESCE(SUM(p.total_price), 0) AS total_revenue,
                    COUNT(*) AS total_bookings,
                    COALESCE(AVG(p.total_price), 0) AS avg_deal_value
                FROM proposals p
                WHERE p.status = 'booked' {cutoff_clause}
            """
            cur.execute(sql, cutoff_params)
            totals = _one(cur)

            # 2. Current month revenue
            cur.execute(
                """
                SELECT COALESCE(SUM(total_price), 0) AS revenue
                FROM proposals
                WHERE status = 'booked'
                  AND booked_at >= %s AND booked_at < %s
                """,
                [cur_month_start, cur_month_end],
            )
            current_month_revenue = float(_one(cur).get("revenue", 0))

            # 3. Previous month revenue
            cur.execute(
                """
                SELECT COALESCE(SUM(total_price), 0) AS revenue
                FROM proposals
                WHERE status = 'booked'
                  AND booked_at >= %s AND booked_at < %s
                """,
                [prev_month_start, prev_month_end],
            )
            previous_month_revenue = float(_one(cur).get("revenue", 0))

            # 4. Month change pct
            if previous_month_revenue > 0:
                month_change_pct = round(
                    (current_month_revenue - previous_month_revenue)
                    / previous_month_revenue
                    * 100,
                    1,
                )
            else:
                month_change_pct = 0.0

            # 5. Projected month revenue
            projected_month_revenue = round(
                current_month_revenue / days_elapsed * days_in_month, 2
            )

            # 6. Revenue trend (weekly)
            sql = f"""
                SELECT
                    date_trunc('week', p.booked_at)::date AS period,
                    COALESCE(SUM(p.total_price), 0) AS revenue,
                    COUNT(*) AS bookings,
                    COALESCE(AVG(p.total_price), 0) AS avg_deal
                FROM proposals p
                WHERE p.status = 'booked' {cutoff_clause}
                GROUP BY date_trunc('week', p.booked_at)
                ORDER BY period
            """
            cur.execute(sql, cutoff_params)
            revenue_trend = []
            for r in _rows(cur):
                revenue_trend.append({
                    "period": r["period"].isoformat() if hasattr(r["period"], "isoformat") else str(r["period"]),
                    "revenue": float(r["revenue"]),
                    "bookings": r["bookings"],
                    "avg_deal": round(float(r["avg_deal"]), 2),
                })

            # 7. Tier distribution
            sql = f"""
                SELECT
                    p.selected_tier AS tier,
                    COUNT(*) AS count,
                    COALESCE(SUM(p.total_price), 0) AS revenue
                FROM proposals p
                WHERE p.status = 'booked' {cutoff_clause}
                GROUP BY p.selected_tier
                ORDER BY revenue DESC
            """
            cur.execute(sql, cutoff_params)
            tier_distribution = []
            for r in _rows(cur):
                tier_distribution.append({
                    "tier": r["tier"],
                    "count": r["count"],
                    "revenue": float(r["revenue"]),
                })

            # 8. Top zip codes
            sql = f"""
                SELECT
                    l.form_data->>'zip_code' AS zip_code,
                    COUNT(*) AS bookings,
                    COALESCE(SUM(p.total_price), 0) AS revenue
                FROM proposals p
                JOIN leads l ON l.id = p.lead_id
                WHERE p.status = 'booked'
                  AND l.form_data->>'zip_code' IS NOT NULL
                  {cutoff_clause}
                GROUP BY l.form_data->>'zip_code'
                ORDER BY revenue DESC
                LIMIT 15
            """
            cur.execute(sql, cutoff_params)
            top_zip_codes = []
            for r in _rows(cur):
                top_zip_codes.append({
                    "zip_code": r["zip_code"],
                    "bookings": r["bookings"],
                    "revenue": float(r["revenue"]),
                })

    return {
        "total_revenue": float(totals.get("total_revenue", 0)),
        "total_bookings": totals.get("total_bookings", 0),
        "avg_deal_value": round(float(totals.get("avg_deal_value", 0)), 2),
        "current_month_revenue": current_month_revenue,
        "previous_month_revenue": previous_month_revenue,
        "month_change_pct": month_change_pct,
        "projected_month_revenue": projected_month_revenue,
        "revenue_trend": revenue_trend,
        "tier_distribution": tier_distribution,
        "top_zip_codes": top_zip_codes,
    }


# ---------------------------------------------------------------------------
# Endpoint 2: Conversion funnel
# ---------------------------------------------------------------------------

@router.get("/funnel")
def analytics_funnel(
    period: str = Query("30d"),
    _user: dict = Depends(get_current_user),
):
    cutoff = _period_cutoff(period)
    lead_cutoff_clause = "AND l.created_at >= %s" if cutoff else ""
    lead_cutoff_params: list = [cutoff] if cutoff else []

    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Stage 1: Total leads
            sql = f"""
                SELECT COUNT(*) AS cnt
                FROM leads l
                WHERE l.archived = false {lead_cutoff_clause}
            """
            cur.execute(sql, lead_cutoff_params)
            leads_count = _one(cur).get("cnt", 0)

            # Stage 2: Estimated (have an estimate)
            sql = f"""
                SELECT COUNT(DISTINCT e.lead_id) AS cnt
                FROM estimates e
                JOIN leads l ON l.id = e.lead_id
                WHERE l.archived = false {lead_cutoff_clause}
            """
            cur.execute(sql, lead_cutoff_params)
            estimated_count = _one(cur).get("cnt", 0)

            # Stage 3: Proposal sent
            sql = f"""
                SELECT COUNT(DISTINCT p.lead_id) AS cnt
                FROM proposals p
                JOIN leads l ON l.id = p.lead_id
                WHERE l.archived = false
                  AND p.status != 'preview'
                  {lead_cutoff_clause}
            """
            cur.execute(sql, lead_cutoff_params)
            proposal_sent_count = _one(cur).get("cnt", 0)

            # Stage 4: Viewed (proposal opened — funnel_stage is not just 'sent')
            sql = f"""
                SELECT COUNT(DISTINCT p.lead_id) AS cnt
                FROM proposals p
                JOIN leads l ON l.id = p.lead_id
                WHERE l.archived = false
                  AND p.status != 'preview'
                  AND (p.funnel_stage IS NOT NULL AND p.funnel_stage != 'sent')
                  {lead_cutoff_clause}
            """
            cur.execute(sql, lead_cutoff_params)
            viewed_count = _one(cur).get("cnt", 0)

            # Stage 5: Package selected
            sql = f"""
                SELECT COUNT(DISTINCT p.lead_id) AS cnt
                FROM proposals p
                JOIN leads l ON l.id = p.lead_id
                WHERE l.archived = false
                  AND p.funnel_stage IN (
                      'package_selected', 'color_selected', 'date_selected',
                      'checkout_started', 'booked'
                  )
                  {lead_cutoff_clause}
            """
            cur.execute(sql, lead_cutoff_params)
            package_selected_count = _one(cur).get("cnt", 0)

            # Stage 6: Booked
            sql = f"""
                SELECT COUNT(DISTINCT p.lead_id) AS cnt
                FROM proposals p
                JOIN leads l ON l.id = p.lead_id
                WHERE l.archived = false
                  AND p.status = 'booked'
                  {lead_cutoff_clause}
            """
            cur.execute(sql, lead_cutoff_params)
            booked_count = _one(cur).get("cnt", 0)

            # Conversion trend (weekly)
            sql = f"""
                SELECT
                    date_trunc('week', l.created_at)::date AS week,
                    COUNT(*) AS leads,
                    COUNT(*) FILTER (
                        WHERE EXISTS (
                            SELECT 1 FROM proposals p
                            WHERE p.lead_id = l.id AND p.status = 'booked'
                        )
                    ) AS booked
                FROM leads l
                WHERE l.archived = false {lead_cutoff_clause}
                GROUP BY date_trunc('week', l.created_at)
                ORDER BY week
            """
            cur.execute(sql, lead_cutoff_params)
            conversion_trend = []
            for r in _rows(cur):
                leads_wk = r["leads"]
                booked_wk = r["booked"]
                rate = round(booked_wk / leads_wk * 100, 1) if leads_wk > 0 else 0.0
                conversion_trend.append({
                    "week": r["week"].isoformat() if hasattr(r["week"], "isoformat") else str(r["week"]),
                    "leads": leads_wk,
                    "booked": booked_wk,
                    "rate": rate,
                })

    # Build funnel stages list
    funnel_stages = [
        {"stage": "Leads", "count": leads_count},
        {"stage": "Estimated", "count": estimated_count},
        {"stage": "Proposal Sent", "count": proposal_sent_count},
        {"stage": "Viewed", "count": viewed_count},
        {"stage": "Package Selected", "count": package_selected_count},
        {"stage": "Booked", "count": booked_count},
    ]

    # Overall conversion rate
    overall_conversion_rate = (
        round(booked_count / leads_count * 100, 1) if leads_count > 0 else 0.0
    )

    # Find biggest dropoff
    biggest_dropoff = {"from": "", "to": "", "drop_pct": 0.0}
    for i in range(len(funnel_stages) - 1):
        current = funnel_stages[i]
        next_stage = funnel_stages[i + 1]
        if current["count"] > 0:
            drop_pct = round(
                (1 - next_stage["count"] / current["count"]) * 100, 1
            )
        else:
            drop_pct = 0.0
        if drop_pct > biggest_dropoff["drop_pct"]:
            biggest_dropoff = {
                "from": current["stage"],
                "to": next_stage["stage"],
                "drop_pct": drop_pct,
            }

    return {
        "funnel_stages": funnel_stages,
        "overall_conversion_rate": overall_conversion_rate,
        "biggest_dropoff": biggest_dropoff,
        "conversion_trend": conversion_trend,
    }


# ---------------------------------------------------------------------------
# Endpoint 3: Speed / velocity metrics
# ---------------------------------------------------------------------------

@router.get("/speed")
def analytics_speed(
    period: str = Query("30d"),
    _user: dict = Depends(get_current_user),
):
    cutoff = _period_cutoff(period)
    lead_cutoff_clause = "AND l.created_at >= %s" if cutoff else ""
    lead_cutoff_params: list = [cutoff] if cutoff else []

    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # 1. Avg hours to estimate
            sql = f"""
                SELECT COALESCE(
                    AVG(EXTRACT(EPOCH FROM (e.created_at - l.created_at)) / 3600),
                    0
                ) AS avg_hours
                FROM estimates e
                JOIN leads l ON l.id = e.lead_id
                WHERE 1=1 {lead_cutoff_clause}
            """
            cur.execute(sql, lead_cutoff_params)
            avg_hours_to_estimate = round(float(_one(cur).get("avg_hours", 0)), 1)

            # 2. Avg hours to booking (from estimate approval)
            sql = f"""
                SELECT COALESCE(
                    AVG(EXTRACT(EPOCH FROM (p.booked_at - e.approved_at)) / 3600),
                    0
                ) AS avg_hours
                FROM proposals p
                JOIN estimates e ON e.id = p.estimate_id
                JOIN leads l ON l.id = e.lead_id
                WHERE p.status = 'booked'
                  AND e.approved_at IS NOT NULL
                  {lead_cutoff_clause}
            """
            cur.execute(sql, lead_cutoff_params)
            avg_hours_to_booking = round(float(_one(cur).get("avg_hours", 0)), 1)

            # 3. Avg days lead to booking
            sql = f"""
                SELECT COALESCE(
                    AVG(EXTRACT(EPOCH FROM (p.booked_at - l.created_at)) / 86400),
                    0
                ) AS avg_days
                FROM proposals p
                JOIN leads l ON l.id = p.lead_id
                WHERE p.status = 'booked' {lead_cutoff_clause}
            """
            cur.execute(sql, lead_cutoff_params)
            avg_days_lead_to_booking = round(float(_one(cur).get("avg_days", 0)), 1)

            # 4. Stage dwell times (current snapshot)
            cur.execute(
                """
                SELECT
                    workflow_stage AS stage,
                    COUNT(*) AS count,
                    COALESCE(
                        AVG(EXTRACT(EPOCH FROM (NOW() - workflow_stage_entered_at)) / 3600),
                        0
                    ) AS avg_hours
                FROM leads
                WHERE workflow_stage IS NOT NULL
                  AND workflow_stage_entered_at IS NOT NULL
                  AND archived = false
                GROUP BY workflow_stage
                ORDER BY avg_hours DESC
                """
            )
            stage_dwell_times = []
            for r in _rows(cur):
                stage_key = r["stage"]
                stage_dwell_times.append({
                    "stage": stage_key,
                    "label": STAGE_LABELS.get(stage_key, stage_key),
                    "avg_hours": round(float(r["avg_hours"]), 1),
                    "count": r["count"],
                })

            # 5. Current bottlenecks
            cur.execute(
                """
                SELECT
                    workflow_stage AS stage,
                    COUNT(*) AS count,
                    COALESCE(
                        AVG(EXTRACT(EPOCH FROM (NOW() - workflow_stage_entered_at)) / 86400),
                        0
                    ) AS avg_days_stuck
                FROM leads
                WHERE workflow_stage IS NOT NULL
                  AND workflow_stage_entered_at IS NOT NULL
                  AND archived = false
                GROUP BY workflow_stage
                HAVING COUNT(*) > 0
                ORDER BY avg_days_stuck DESC
                """
            )
            current_bottlenecks = []
            for r in _rows(cur):
                stage_key = r["stage"]
                current_bottlenecks.append({
                    "stage": stage_key,
                    "label": STAGE_LABELS.get(stage_key, stage_key),
                    "count": r["count"],
                    "avg_days_stuck": round(float(r["avg_days_stuck"]), 1),
                })

            # 6. Speed trend (weekly avg days to booking)
            sql = f"""
                SELECT
                    date_trunc('week', l.created_at)::date AS week,
                    COALESCE(
                        AVG(EXTRACT(EPOCH FROM (p.booked_at - l.created_at)) / 86400),
                        0
                    ) AS avg_days
                FROM proposals p
                JOIN leads l ON l.id = p.lead_id
                WHERE p.status = 'booked' {lead_cutoff_clause}
                GROUP BY date_trunc('week', l.created_at)
                ORDER BY week
            """
            cur.execute(sql, lead_cutoff_params)
            speed_trend = []
            for r in _rows(cur):
                speed_trend.append({
                    "week": r["week"].isoformat() if hasattr(r["week"], "isoformat") else str(r["week"]),
                    "avg_days": round(float(r["avg_days"]), 1),
                })

    return {
        "avg_hours_to_estimate": avg_hours_to_estimate,
        "avg_hours_to_booking": avg_hours_to_booking,
        "avg_days_lead_to_booking": avg_days_lead_to_booking,
        "stage_dwell_times": stage_dwell_times,
        "current_bottlenecks": current_bottlenecks,
        "speed_trend": speed_trend,
    }


# ---------------------------------------------------------------------------
# Endpoint 4: SMS engagement metrics
# ---------------------------------------------------------------------------

@router.get("/engagement")
def analytics_engagement(
    period: str = Query("30d"),
    _user: dict = Depends(get_current_user),
):
    cutoff = _period_cutoff(period)
    cutoff_clause = "AND sq.created_at >= %s" if cutoff else ""
    cutoff_params: list = [cutoff] if cutoff else []
    lead_cutoff_clause = "AND l.created_at >= %s" if cutoff else ""
    lead_cutoff_params: list = [cutoff] if cutoff else []

    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # 1. SMS stats by status
            sql = f"""
                SELECT
                    sq.status,
                    COUNT(*) AS count
                FROM sms_queue sq
                WHERE 1=1 {cutoff_clause}
                GROUP BY sq.status
            """
            cur.execute(sql, cutoff_params)
            sms_raw = {r["status"]: r["count"] for r in _rows(cur)}
            sms_stats = {
                "sent": sms_raw.get("sent", 0),
                "failed": sms_raw.get("failed", 0),
                "cancelled": sms_raw.get("cancelled", 0),
                "pending": sms_raw.get("pending", 0),
            }

            # 2. Delivery rate
            sent = sms_stats["sent"]
            failed = sms_stats["failed"]
            total_attempts = sent + failed
            delivery_rate = (
                round(sent / total_attempts * 100, 1) if total_attempts > 0 else 0.0
            )

            # 3. Response rate by workflow stage
            sql = f"""
                SELECT
                    l.workflow_stage AS stage,
                    COUNT(DISTINCT sq.lead_id) AS messaged,
                    COUNT(DISTINCT sq.lead_id) FILTER (
                        WHERE EXISTS (
                            SELECT 1 FROM messages m
                            WHERE m.lead_id = sq.lead_id
                              AND m.direction = 'inbound'
                              AND m.created_at >= sq.sent_at
                              AND m.created_at <= sq.sent_at + INTERVAL '24 hours'
                        )
                    ) AS responded
                FROM sms_queue sq
                JOIN leads l ON l.id = sq.lead_id
                WHERE sq.status = 'sent'
                  AND l.archived = false
                  {cutoff_clause}
                GROUP BY l.workflow_stage
                ORDER BY messaged DESC
            """
            cur.execute(sql, cutoff_params)
            stage_response_rates = []
            for r in _rows(cur):
                stage_key = r["stage"] or "unknown"
                messaged = r["messaged"]
                responded = r["responded"]
                rate = round(responded / messaged * 100, 1) if messaged > 0 else 0.0
                stage_response_rates.append({
                    "stage": stage_key,
                    "label": STAGE_LABELS.get(stage_key, stage_key),
                    "messaged": messaged,
                    "responded": responded,
                    "rate": rate,
                })

            # 4. Overall response rate
            sql = f"""
                SELECT
                    COUNT(*) FILTER (WHERE l.customer_responded = true) AS responded,
                    COUNT(*) AS total
                FROM leads l
                WHERE l.archived = false {lead_cutoff_clause}
            """
            cur.execute(sql, lead_cutoff_params)
            resp_row = _one(cur)
            resp_total = resp_row.get("total", 0)
            resp_responded = resp_row.get("responded", 0)
            overall_response_rate = (
                round(resp_responded / resp_total * 100, 1) if resp_total > 0 else 0.0
            )

            # 5. Message volume (daily sent/failed)
            sql = f"""
                SELECT
                    date_trunc('day', sq.sent_at)::date AS day,
                    COUNT(*) FILTER (WHERE sq.status = 'sent') AS sent,
                    COUNT(*) FILTER (WHERE sq.status = 'failed') AS failed
                FROM sms_queue sq
                WHERE sq.sent_at IS NOT NULL {cutoff_clause}
                GROUP BY date_trunc('day', sq.sent_at)
                ORDER BY day
            """
            cur.execute(sql, cutoff_params)
            message_volume = []
            for r in _rows(cur):
                message_volume.append({
                    "day": r["day"].isoformat() if hasattr(r["day"], "isoformat") else str(r["day"]),
                    "sent": r["sent"],
                    "failed": r["failed"],
                })

            # 6. Schedule capacity (next 30 days)
            now = datetime.now(timezone.utc).date()
            end_date = now + timedelta(days=30)
            cur.execute(
                """
                SELECT
                    ss.date,
                    ss.max_bookings,
                    COALESCE(COUNT(p.id), 0) AS booked
                FROM schedule_slots ss
                LEFT JOIN proposals p
                    ON p.booked_date = ss.date
                    AND p.status = 'booked'
                WHERE ss.date >= %s AND ss.date <= %s
                GROUP BY ss.date, ss.max_bookings
                ORDER BY ss.date
                """,
                [now, end_date],
            )
            schedule_capacity = []
            for r in _rows(cur):
                schedule_capacity.append({
                    "date": r["date"].isoformat() if hasattr(r["date"], "isoformat") else str(r["date"]),
                    "max_bookings": r["max_bookings"],
                    "booked": r["booked"],
                })

    return {
        "sms_stats": sms_stats,
        "delivery_rate": delivery_rate,
        "stage_response_rates": stage_response_rates,
        "overall_response_rate": overall_response_rate,
        "message_volume": message_volume,
        "schedule_capacity": schedule_capacity,
    }
