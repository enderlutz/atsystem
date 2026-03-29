"""
AT System MCP Server — gives Claude read-only access to the AT System database.

Run: python server.py
Or via Claude Code settings (see README.md).
"""
from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]

mcp = FastMCP("AT System Analytics")

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

@contextmanager
def get_conn():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        conn.set_session(readonly=True, autocommit=True)
        yield conn
    finally:
        conn.close()


def _query(sql: str, params: list | None = None) -> list[dict]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or [])
            return [_serialize(dict(r)) for r in cur.fetchall()]


def _query_one(sql: str, params: list | None = None) -> dict:
    rows = _query(sql, params)
    return rows[0] if rows else {}


def _serialize(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, Decimal):
            out[k] = float(v)
        elif hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


def _period_clause(period: str, col: str = "created_at", alias: str = "") -> tuple[str, list]:
    """Return (SQL clause, params) for period filtering."""
    mapping = {"7d": 7, "30d": 30, "90d": 90, "180d": 180, "365d": 365}
    days = mapping.get(period)
    if days is None:
        return "", []
    prefix = f"{alias}." if alias else ""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    return f"AND {prefix}{col} >= %s", [cutoff]


STAGE_LABELS = {
    "new_lead": "New Lead",
    "new_build": "New Build",
    "asking_address": "Asking Address",
    "hot_lead": "Hot Lead",
    "proposal_sent": "Proposal Sent",
    "no_package_selection": "No Package Selection",
    "package_selected": "Package Selected",
    "no_date_selected": "No Date Selected",
    "date_selected": "Date Selected",
    "deposit_paid": "Deposit Paid",
    "additional_service": "Add-on Service",
    "job_complete": "Job Complete",
    "cold_nurture": "Cold Nurture",
    "past_customer": "Past Customer",
}


# ---------------------------------------------------------------------------
# MCP Tools
# ---------------------------------------------------------------------------

@mcp.tool()
def get_business_summary(period: str = "30d") -> str:
    """Get a high-level business summary with KPIs: total leads, estimates,
    proposals sent, bookings, revenue, conversion rate, avg deal size.
    Period: 7d, 30d, 90d, 180d, 365d, or 'all'."""

    period_clause, params = _period_clause(period, "l.created_at")

    # Leads count
    leads = _query_one(
        f"SELECT COUNT(*) AS cnt FROM leads l WHERE archived = false {period_clause}",
        params,
    )

    # Estimates count
    estimates = _query_one(
        f"""SELECT COUNT(*) AS cnt FROM estimates e
            JOIN leads l ON l.id = e.lead_id
            WHERE 1=1 {period_clause}""",
        params,
    )

    # Proposals sent
    proposals_sent = _query_one(
        f"""SELECT COUNT(*) AS cnt FROM proposals p
            JOIN leads l ON l.id = p.lead_id
            WHERE p.status != 'preview' {period_clause}""",
        params,
    )

    # Bookings + revenue
    rev_clause, rev_params = _period_clause(period, "p.booked_at")
    revenue = _query_one(
        f"""SELECT
                COUNT(*) AS bookings,
                COALESCE(SUM(p.booked_tier_price), 0) AS total_revenue,
                COALESCE(AVG(p.booked_tier_price), 0) AS avg_deal
            FROM proposals p
            WHERE p.status = 'booked' {rev_clause}""",
        rev_params,
    )

    # Conversion rate
    leads_count = leads.get("cnt", 0)
    bookings = revenue.get("bookings", 0)
    conversion = round(bookings / leads_count * 100, 1) if leads_count > 0 else 0.0

    # Pipeline value (pending estimates)
    pipeline = _query_one(
        """SELECT
               COALESCE(SUM(estimate_high), 0) AS pipeline_high,
               COALESCE(SUM(estimate_low), 0) AS pipeline_low,
               COUNT(*) AS pending_count
           FROM estimates
           WHERE status = 'pending'"""
    )

    return json.dumps({
        "period": period,
        "total_leads": leads_count,
        "total_estimates": estimates.get("cnt", 0),
        "proposals_sent": proposals_sent.get("cnt", 0),
        "total_bookings": bookings,
        "total_revenue": round(revenue.get("total_revenue", 0), 2),
        "avg_deal_value": round(revenue.get("avg_deal", 0), 2),
        "conversion_rate_pct": conversion,
        "pending_pipeline_count": pipeline.get("pending_count", 0),
        "pending_pipeline_value_low": round(pipeline.get("pipeline_low", 0), 2),
        "pending_pipeline_value_high": round(pipeline.get("pipeline_high", 0), 2),
    }, indent=2)


@mcp.tool()
def get_revenue_metrics(period: str = "30d") -> str:
    """Revenue analytics: total, monthly, projected, trend, tier breakdown, top zip codes.
    Period: 7d, 30d, 90d, 180d, 365d, or 'all'."""

    rev_clause, rev_params = _period_clause(period, "p.booked_at")
    now = datetime.now(timezone.utc)

    # Totals
    totals = _query_one(
        f"""SELECT
                COALESCE(SUM(p.booked_tier_price), 0) AS total_revenue,
                COUNT(*) AS total_bookings,
                COALESCE(AVG(p.booked_tier_price), 0) AS avg_deal
            FROM proposals p
            WHERE p.status = 'booked' {rev_clause}""",
        rev_params,
    )

    # Current month
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    cur_month = _query_one(
        """SELECT COALESCE(SUM(booked_tier_price), 0) AS revenue, COUNT(*) AS bookings
           FROM proposals WHERE status = 'booked' AND booked_at >= %s""",
        [month_start],
    )

    # Previous month
    prev_month_end = month_start
    prev_month_start = (prev_month_end - timedelta(days=1)).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    prev_month = _query_one(
        """SELECT COALESCE(SUM(booked_tier_price), 0) AS revenue
           FROM proposals WHERE status = 'booked' AND booked_at >= %s AND booked_at < %s""",
        [prev_month_start, prev_month_end],
    )

    # Weekly trend
    trend = _query(
        f"""SELECT
                date_trunc('week', p.booked_at)::date AS week,
                COALESCE(SUM(p.booked_tier_price), 0) AS revenue,
                COUNT(*) AS bookings
            FROM proposals p
            WHERE p.status = 'booked' {rev_clause}
            GROUP BY date_trunc('week', p.booked_at)
            ORDER BY week""",
        rev_params,
    )

    # Tier breakdown
    tiers = _query(
        f"""SELECT
                p.selected_tier AS tier,
                COUNT(*) AS count,
                COALESCE(SUM(p.booked_tier_price), 0) AS revenue,
                COALESCE(AVG(p.booked_tier_price), 0) AS avg_price
            FROM proposals p
            WHERE p.status = 'booked' {rev_clause}
            GROUP BY p.selected_tier ORDER BY revenue DESC""",
        rev_params,
    )

    # Top zip codes
    zips = _query(
        f"""SELECT
                l.form_data->>'zip_code' AS zip_code,
                COUNT(*) AS bookings,
                COALESCE(SUM(p.booked_tier_price), 0) AS revenue,
                COALESCE(AVG(p.booked_tier_price), 0) AS avg_deal
            FROM proposals p
            JOIN leads l ON l.id = p.lead_id
            WHERE p.status = 'booked' AND l.form_data->>'zip_code' IS NOT NULL {rev_clause}
            GROUP BY l.form_data->>'zip_code' ORDER BY revenue DESC LIMIT 15""",
        rev_params,
    )

    prev_rev = prev_month.get("revenue", 0)
    cur_rev = cur_month.get("revenue", 0)
    mom_change = round((cur_rev - prev_rev) / prev_rev * 100, 1) if prev_rev > 0 else 0.0

    return json.dumps({
        "period": period,
        "total_revenue": round(totals.get("total_revenue", 0), 2),
        "total_bookings": totals.get("total_bookings", 0),
        "avg_deal_value": round(totals.get("avg_deal", 0), 2),
        "current_month_revenue": round(cur_rev, 2),
        "current_month_bookings": cur_month.get("bookings", 0),
        "previous_month_revenue": round(prev_rev, 2),
        "month_over_month_change_pct": mom_change,
        "weekly_trend": trend,
        "tier_breakdown": tiers,
        "top_zip_codes": zips,
    }, indent=2)


@mcp.tool()
def get_conversion_funnel(period: str = "30d") -> str:
    """Full conversion funnel: leads -> estimated -> proposal sent -> viewed ->
    package selected -> booked. Includes drop-off analysis and weekly trend.
    Period: 7d, 30d, 90d, 180d, 365d, or 'all'."""

    clause, params = _period_clause(period, "l.created_at")

    stages = {}
    # Leads
    stages["leads"] = _query_one(
        f"SELECT COUNT(*) AS cnt FROM leads l WHERE archived = false {clause}", params
    ).get("cnt", 0)

    # Estimated
    stages["estimated"] = _query_one(
        f"""SELECT COUNT(DISTINCT e.lead_id) AS cnt FROM estimates e
            JOIN leads l ON l.id = e.lead_id WHERE l.archived = false {clause}""", params
    ).get("cnt", 0)

    # Proposal sent
    stages["proposal_sent"] = _query_one(
        f"""SELECT COUNT(DISTINCT p.lead_id) AS cnt FROM proposals p
            JOIN leads l ON l.id = p.lead_id
            WHERE l.archived = false AND p.status != 'preview' {clause}""", params
    ).get("cnt", 0)

    # Viewed
    stages["viewed"] = _query_one(
        f"""SELECT COUNT(DISTINCT p.lead_id) AS cnt FROM proposals p
            JOIN leads l ON l.id = p.lead_id
            WHERE l.archived = false AND p.status != 'preview'
              AND p.funnel_stage IS NOT NULL AND p.funnel_stage != 'sent' {clause}""", params
    ).get("cnt", 0)

    # Package selected
    stages["package_selected"] = _query_one(
        f"""SELECT COUNT(DISTINCT p.lead_id) AS cnt FROM proposals p
            JOIN leads l ON l.id = p.lead_id
            WHERE l.archived = false AND p.funnel_stage IN (
                'package_selected','color_selected','date_selected','checkout_started','booked'
            ) {clause}""", params
    ).get("cnt", 0)

    # Booked
    stages["booked"] = _query_one(
        f"""SELECT COUNT(DISTINCT p.lead_id) AS cnt FROM proposals p
            JOIN leads l ON l.id = p.lead_id
            WHERE l.archived = false AND p.status = 'booked' {clause}""", params
    ).get("cnt", 0)

    # Build funnel with drop-off
    funnel = []
    stage_names = ["leads", "estimated", "proposal_sent", "viewed", "package_selected", "booked"]
    labels = ["Leads", "Estimated", "Proposal Sent", "Viewed", "Package Selected", "Booked"]
    for i, (key, label) in enumerate(zip(stage_names, labels)):
        count = stages[key]
        pct_of_total = round(count / stages["leads"] * 100, 1) if stages["leads"] > 0 else 0.0
        drop_from_prev = 0.0
        if i > 0:
            prev_count = stages[stage_names[i - 1]]
            drop_from_prev = round((1 - count / prev_count) * 100, 1) if prev_count > 0 else 0.0
        funnel.append({
            "stage": label,
            "count": count,
            "pct_of_total": pct_of_total,
            "drop_from_previous_pct": drop_from_prev,
        })

    # Weekly conversion trend
    trend = _query(
        f"""SELECT
                date_trunc('week', l.created_at)::date AS week,
                COUNT(*) AS leads,
                COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM proposals p WHERE p.lead_id = l.id AND p.status = 'booked'
                )) AS booked
            FROM leads l WHERE l.archived = false {clause}
            GROUP BY date_trunc('week', l.created_at) ORDER BY week""",
        params,
    )
    for row in trend:
        row["conversion_rate"] = round(row["booked"] / row["leads"] * 100, 1) if row["leads"] > 0 else 0.0

    overall = round(stages["booked"] / stages["leads"] * 100, 1) if stages["leads"] > 0 else 0.0

    return json.dumps({
        "period": period,
        "overall_conversion_rate_pct": overall,
        "funnel": funnel,
        "weekly_trend": trend,
    }, indent=2)


@mcp.tool()
def get_pipeline_snapshot() -> str:
    """Current pipeline: how many leads are in each workflow stage right now,
    how long they've been there, and their estimated values."""

    rows = _query("""
        SELECT
            l.workflow_stage AS stage,
            COUNT(*) AS count,
            COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - l.workflow_stage_entered_at)) / 3600), 0) AS avg_hours_in_stage,
            COALESCE(SUM(e.estimate_high), 0) AS total_value_high,
            COALESCE(SUM(e.estimate_low), 0) AS total_value_low
        FROM leads l
        LEFT JOIN estimates e ON e.lead_id = l.id AND e.status = 'pending'
        WHERE l.archived = false AND l.workflow_stage IS NOT NULL
        GROUP BY l.workflow_stage
        ORDER BY count DESC
    """)

    for row in rows:
        row["label"] = STAGE_LABELS.get(row["stage"], row["stage"])
        row["avg_hours_in_stage"] = round(row["avg_hours_in_stage"], 1)
        row["total_value_high"] = round(row["total_value_high"], 2)
        row["total_value_low"] = round(row["total_value_low"], 2)

    total_leads = sum(r["count"] for r in rows)
    return json.dumps({
        "total_active_leads": total_leads,
        "stages": rows,
    }, indent=2)


@mcp.tool()
def get_speed_metrics(period: str = "30d") -> str:
    """Operational speed: avg time from lead to estimate, estimate to booking,
    full cycle, stage dwell times, and bottlenecks.
    Period: 7d, 30d, 90d, 180d, 365d, or 'all'."""

    clause, params = _period_clause(period, "l.created_at")

    # Avg hours to estimate
    to_est = _query_one(
        f"""SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (e.created_at - l.created_at)) / 3600), 0) AS hrs
            FROM estimates e JOIN leads l ON l.id = e.lead_id WHERE 1=1 {clause}""", params
    )

    # Avg hours from approval to booking
    to_book = _query_one(
        f"""SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (p.booked_at - e.approved_at)) / 3600), 0) AS hrs
            FROM proposals p JOIN estimates e ON e.id = p.estimate_id JOIN leads l ON l.id = e.lead_id
            WHERE p.status = 'booked' AND e.approved_at IS NOT NULL {clause}""", params
    )

    # Full cycle
    full = _query_one(
        f"""SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (p.booked_at - l.created_at)) / 86400), 0) AS days
            FROM proposals p JOIN leads l ON l.id = p.lead_id
            WHERE p.status = 'booked' {clause}""", params
    )

    # Current bottlenecks
    bottlenecks = _query("""
        SELECT
            workflow_stage AS stage,
            COUNT(*) AS count,
            COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - workflow_stage_entered_at)) / 86400), 0) AS avg_days_stuck
        FROM leads
        WHERE workflow_stage IS NOT NULL AND workflow_stage_entered_at IS NOT NULL AND archived = false
        GROUP BY workflow_stage
        HAVING AVG(EXTRACT(EPOCH FROM (NOW() - workflow_stage_entered_at)) / 3600) > 24
        ORDER BY avg_days_stuck DESC
    """)
    for b in bottlenecks:
        b["label"] = STAGE_LABELS.get(b["stage"], b["stage"])
        b["avg_days_stuck"] = round(b["avg_days_stuck"], 1)

    return json.dumps({
        "period": period,
        "avg_hours_to_estimate": round(to_est.get("hrs", 0), 1),
        "avg_hours_approval_to_booking": round(to_book.get("hrs", 0), 1),
        "avg_days_full_cycle": round(full.get("days", 0), 1),
        "bottlenecks": bottlenecks,
    }, indent=2)


@mcp.tool()
def get_zip_code_performance(period: str = "all") -> str:
    """Performance by zip code: bookings, revenue, avg deal, conversion rate.
    Period: 7d, 30d, 90d, 180d, 365d, or 'all'."""

    clause, params = _period_clause(period, "l.created_at")

    rows = _query(
        f"""SELECT
                l.form_data->>'zip_code' AS zip_code,
                COUNT(DISTINCT l.id) AS total_leads,
                COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'booked') AS bookings,
                COALESCE(SUM(p.booked_tier_price) FILTER (WHERE p.status = 'booked'), 0) AS revenue,
                COALESCE(AVG(p.booked_tier_price) FILTER (WHERE p.status = 'booked'), 0) AS avg_deal
            FROM leads l
            LEFT JOIN proposals p ON p.lead_id = l.id
            WHERE l.archived = false AND l.form_data->>'zip_code' IS NOT NULL {clause}
            GROUP BY l.form_data->>'zip_code'
            ORDER BY revenue DESC""",
        params,
    )

    for r in rows:
        total = r["total_leads"]
        booked = r["bookings"]
        r["conversion_rate_pct"] = round(booked / total * 100, 1) if total > 0 else 0.0
        r["revenue"] = round(r["revenue"], 2)
        r["avg_deal"] = round(r["avg_deal"], 2)

    return json.dumps({"period": period, "zip_codes": rows}, indent=2)


@mcp.tool()
def get_tier_analysis(period: str = "30d") -> str:
    """Package tier analysis: Essential vs Signature vs Legacy selection rates,
    revenue contribution, and trends.
    Period: 7d, 30d, 90d, 180d, 365d, or 'all'."""

    clause, params = _period_clause(period, "p.booked_at")

    tiers = _query(
        f"""SELECT
                p.selected_tier AS tier,
                COUNT(*) AS bookings,
                COALESCE(SUM(p.booked_tier_price), 0) AS revenue,
                COALESCE(AVG(p.booked_tier_price), 0) AS avg_price,
                COALESCE(MIN(p.booked_tier_price), 0) AS min_price,
                COALESCE(MAX(p.booked_tier_price), 0) AS max_price
            FROM proposals p
            WHERE p.status = 'booked' AND p.selected_tier IS NOT NULL {clause}
            GROUP BY p.selected_tier ORDER BY bookings DESC""",
        params,
    )

    total_bookings = sum(t["bookings"] for t in tiers)
    for t in tiers:
        t["pct_of_bookings"] = round(t["bookings"] / total_bookings * 100, 1) if total_bookings > 0 else 0.0
        t["revenue"] = round(t["revenue"], 2)
        t["avg_price"] = round(t["avg_price"], 2)

    # Weekly tier trend
    trend = _query(
        f"""SELECT
                date_trunc('week', p.booked_at)::date AS week,
                p.selected_tier AS tier,
                COUNT(*) AS bookings
            FROM proposals p
            WHERE p.status = 'booked' AND p.selected_tier IS NOT NULL {clause}
            GROUP BY week, p.selected_tier ORDER BY week""",
        params,
    )

    return json.dumps({
        "period": period,
        "total_bookings": total_bookings,
        "tiers": tiers,
        "weekly_trend": trend,
    }, indent=2)


@mcp.tool()
def get_sms_effectiveness(period: str = "30d") -> str:
    """SMS automation effectiveness: messages sent/failed by stage, response rates,
    best-performing sequences. Period: 7d, 30d, 90d, 180d, 365d, or 'all'."""

    clause, params = _period_clause(period, "sq.created_at")

    # By stage
    by_stage = _query(
        f"""SELECT
                sq.stage,
                COUNT(*) AS total_messages,
                COUNT(*) FILTER (WHERE sq.status = 'sent') AS sent,
                COUNT(*) FILTER (WHERE sq.status = 'failed') AS failed,
                COUNT(*) FILTER (WHERE sq.status = 'cancelled') AS cancelled,
                COUNT(DISTINCT sq.lead_id) AS unique_leads
            FROM sms_queue sq WHERE 1=1 {clause}
            GROUP BY sq.stage ORDER BY total_messages DESC""",
        params,
    )
    for row in by_stage:
        row["label"] = STAGE_LABELS.get(row["stage"], row["stage"])
        row["delivery_rate_pct"] = (
            round(row["sent"] / (row["sent"] + row["failed"]) * 100, 1)
            if (row["sent"] + row["failed"]) > 0 else 0.0
        )

    # Response rates by stage
    response = _query(
        f"""SELECT
                sq.stage,
                COUNT(DISTINCT sq.lead_id) AS messaged,
                COUNT(DISTINCT sq.lead_id) FILTER (WHERE EXISTS (
                    SELECT 1 FROM messages m
                    WHERE m.lead_id = sq.lead_id AND m.direction = 'inbound'
                      AND m.created_at >= sq.sent_at
                      AND m.created_at <= sq.sent_at + INTERVAL '24 hours'
                )) AS responded
            FROM sms_queue sq
            WHERE sq.status = 'sent' {clause}
            GROUP BY sq.stage ORDER BY messaged DESC""",
        params,
    )
    for row in response:
        row["label"] = STAGE_LABELS.get(row["stage"], row["stage"])
        row["response_rate_pct"] = (
            round(row["responded"] / row["messaged"] * 100, 1)
            if row["messaged"] > 0 else 0.0
        )

    return json.dumps({
        "period": period,
        "messages_by_stage": by_stage,
        "response_rates_by_stage": response,
    }, indent=2)


@mcp.tool()
def get_proposal_engagement(period: str = "30d") -> str:
    """How customers interact with proposals: view rates, time on page,
    funnel stage progression, abandonment points.
    Period: 7d, 30d, 90d, 180d, 365d, or 'all'."""

    clause, params = _period_clause(period, "p.created_at")

    # Overall proposal stats
    stats = _query_one(
        f"""SELECT
                COUNT(*) AS total_proposals,
                COUNT(*) FILTER (WHERE funnel_stage IS NOT NULL AND funnel_stage != 'sent') AS viewed,
                COUNT(*) FILTER (WHERE funnel_stage IN ('package_selected','color_selected','date_selected','checkout_started','booked')) AS engaged,
                COUNT(*) FILTER (WHERE status = 'booked') AS booked,
                COUNT(*) FILTER (WHERE left_page_at IS NOT NULL AND status != 'booked') AS abandoned
            FROM proposals p
            WHERE p.status != 'preview' {clause}""",
        params,
    )

    total = stats.get("total_proposals", 0)
    viewed = stats.get("viewed", 0)
    engaged = stats.get("engaged", 0)
    booked = stats.get("booked", 0)

    # Funnel stage distribution
    funnel = _query(
        f"""SELECT
                p.funnel_stage AS stage,
                COUNT(*) AS count
            FROM proposals p
            WHERE p.status != 'preview' AND p.funnel_stage IS NOT NULL {clause}
            GROUP BY p.funnel_stage ORDER BY count DESC""",
        params,
    )

    # Avg time to booking (from proposal creation)
    booking_speed = _query_one(
        f"""SELECT
                COALESCE(AVG(EXTRACT(EPOCH FROM (booked_at - created_at)) / 3600), 0) AS avg_hours
            FROM proposals p
            WHERE status = 'booked' {clause}""",
        params,
    )

    return json.dumps({
        "period": period,
        "total_proposals": total,
        "view_rate_pct": round(viewed / total * 100, 1) if total > 0 else 0.0,
        "engagement_rate_pct": round(engaged / total * 100, 1) if total > 0 else 0.0,
        "booking_rate_pct": round(booked / total * 100, 1) if total > 0 else 0.0,
        "abandoned": stats.get("abandoned", 0),
        "avg_hours_to_booking": round(booking_speed.get("avg_hours", 0), 1),
        "funnel_stage_distribution": funnel,
    }, indent=2)


@mcp.tool()
def get_cohort_analysis(cohort_by: str = "week") -> str:
    """Cohort analysis: group leads by the week/month they arrived and track
    their conversion rates over time. cohort_by: 'week' or 'month'."""

    trunc = "week" if cohort_by == "week" else "month"

    rows = _query(f"""
        SELECT
            date_trunc('{trunc}', l.created_at)::date AS cohort,
            COUNT(*) AS leads,
            COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM estimates e WHERE e.lead_id = l.id
            )) AS estimated,
            COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM proposals p WHERE p.lead_id = l.id AND p.status != 'preview'
            )) AS proposal_sent,
            COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM proposals p WHERE p.lead_id = l.id AND p.status = 'booked'
            )) AS booked,
            COALESCE(SUM(
                (SELECT p.booked_tier_price FROM proposals p
                 WHERE p.lead_id = l.id AND p.status = 'booked' LIMIT 1)
            ), 0) AS revenue
        FROM leads l
        WHERE l.archived = false
        GROUP BY cohort ORDER BY cohort DESC
        LIMIT 20
    """)

    for r in rows:
        leads = r["leads"]
        r["estimate_rate_pct"] = round(r["estimated"] / leads * 100, 1) if leads > 0 else 0.0
        r["proposal_rate_pct"] = round(r["proposal_sent"] / leads * 100, 1) if leads > 0 else 0.0
        r["booking_rate_pct"] = round(r["booked"] / leads * 100, 1) if leads > 0 else 0.0
        r["revenue"] = round(r["revenue"], 2)
        r["revenue_per_lead"] = round(r["revenue"] / leads, 2) if leads > 0 else 0.0

    return json.dumps({"cohort_by": cohort_by, "cohorts": rows}, indent=2)


@mcp.tool()
def query_leads(
    status: str = "",
    workflow_stage: str = "",
    zip_code: str = "",
    has_estimate: str = "",
    has_proposal: str = "",
    customer_responded: str = "",
    limit: int = 25,
) -> str:
    """Search and filter leads. All filters are optional.
    status: new, estimated, approved, rejected, sent
    workflow_stage: new_lead, proposal_sent, package_selected, booked, job_complete, cold_nurture, etc.
    has_estimate: 'true' or 'false'
    has_proposal: 'true' or 'false'
    customer_responded: 'true' or 'false'
    limit: max results (default 25)"""

    wheres = ["l.archived = false"]
    params: list = []

    if status:
        wheres.append("l.status = %s")
        params.append(status)
    if workflow_stage:
        wheres.append("l.workflow_stage = %s")
        params.append(workflow_stage)
    if zip_code:
        wheres.append("l.form_data->>'zip_code' = %s")
        params.append(zip_code)
    if customer_responded.lower() == "true":
        wheres.append("l.customer_responded = true")
    elif customer_responded.lower() == "false":
        wheres.append("(l.customer_responded = false OR l.customer_responded IS NULL)")
    if has_estimate == "true":
        wheres.append("EXISTS (SELECT 1 FROM estimates e WHERE e.lead_id = l.id)")
    elif has_estimate == "false":
        wheres.append("NOT EXISTS (SELECT 1 FROM estimates e WHERE e.lead_id = l.id)")
    if has_proposal == "true":
        wheres.append("EXISTS (SELECT 1 FROM proposals p WHERE p.lead_id = l.id AND p.status != 'preview')")
    elif has_proposal == "false":
        wheres.append("NOT EXISTS (SELECT 1 FROM proposals p WHERE p.lead_id = l.id AND p.status != 'preview')")

    where_sql = " AND ".join(wheres)
    limit = min(limit, 100)

    rows = _query(
        f"""SELECT
                l.id, l.contact_name, l.contact_phone, l.contact_email,
                l.address, l.service_type, l.status, l.workflow_stage,
                l.kanban_column, l.customer_responded, l.priority,
                l.form_data->>'zip_code' AS zip_code,
                l.form_data->>'sqft' AS sqft,
                l.created_at, l.tags, l.va_notes
            FROM leads l
            WHERE {where_sql}
            ORDER BY l.created_at DESC
            LIMIT %s""",
        params + [limit],
    )

    return json.dumps({"count": len(rows), "leads": rows}, indent=2)


@mcp.tool()
def get_lead_detail(lead_id: str) -> str:
    """Get full details for a specific lead including estimate, proposal, messages,
    and workflow history. Provide the lead UUID."""

    lead = _query_one(
        "SELECT * FROM leads WHERE id = %s", [lead_id]
    )
    if not lead:
        return json.dumps({"error": "Lead not found"})

    estimate = _query(
        "SELECT * FROM estimates WHERE lead_id = %s ORDER BY created_at DESC", [lead_id]
    )

    proposal = _query(
        "SELECT * FROM proposals WHERE lead_id = %s ORDER BY created_at DESC", [lead_id]
    )

    messages = _query(
        """SELECT direction, body, message_type, date_added
           FROM messages WHERE lead_id = %s ORDER BY date_added DESC LIMIT 20""",
        [lead_id],
    )

    workflow_log = _query(
        """SELECT event_type, detail, created_at
           FROM automation_log WHERE lead_id = %s ORDER BY created_at DESC LIMIT 30""",
        [lead_id],
    )

    return json.dumps({
        "lead": lead,
        "estimates": estimate,
        "proposals": proposal,
        "recent_messages": messages,
        "workflow_history": workflow_log,
    }, indent=2)


@mcp.tool()
def get_automation_activity(period: str = "7d", limit: int = 50) -> str:
    """Recent automation activity log: stage transitions, SMS sends, errors.
    Period: 7d, 30d, 90d, or 'all'. Limit: max rows (default 50)."""

    clause, params = _period_clause(period, "a.created_at")
    limit = min(limit, 200)

    rows = _query(
        f"""SELECT
                a.event_type, a.detail, a.created_at,
                l.contact_name, l.workflow_stage
            FROM automation_log a
            JOIN leads l ON l.id = a.lead_id
            WHERE 1=1 {clause}
            ORDER BY a.created_at DESC LIMIT %s""",
        params + [limit],
    )

    # Summary counts
    summary = _query(
        f"""SELECT event_type, COUNT(*) AS count
            FROM automation_log a WHERE 1=1 {clause}
            GROUP BY event_type ORDER BY count DESC""",
        params,
    )

    return json.dumps({
        "period": period,
        "event_summary": summary,
        "recent_events": rows,
    }, indent=2)


@mcp.tool()
def get_day_of_week_patterns() -> str:
    """Analyze patterns by day of week: when do leads arrive, when do bookings happen,
    when do customers respond. Helps optimize scheduling and outreach timing."""

    # Lead arrival by day
    lead_days = _query("""
        SELECT
            EXTRACT(DOW FROM created_at) AS dow,
            TO_CHAR(created_at, 'Day') AS day_name,
            COUNT(*) AS leads
        FROM leads WHERE archived = false
        GROUP BY dow, day_name ORDER BY dow
    """)

    # Bookings by day
    booking_days = _query("""
        SELECT
            EXTRACT(DOW FROM booked_at) AS dow,
            TO_CHAR(booked_at, 'Day') AS day_name,
            COUNT(*) AS bookings
        FROM proposals WHERE status = 'booked'
        GROUP BY dow, day_name ORDER BY dow
    """)

    # Customer responses by day
    response_days = _query("""
        SELECT
            EXTRACT(DOW FROM m.date_added) AS dow,
            TO_CHAR(m.date_added, 'Day') AS day_name,
            COUNT(*) AS responses
        FROM messages m WHERE m.direction = 'inbound'
        GROUP BY dow, day_name ORDER BY dow
    """)

    # Bookings by hour
    booking_hours = _query("""
        SELECT
            EXTRACT(HOUR FROM booked_at) AS hour,
            COUNT(*) AS bookings
        FROM proposals WHERE status = 'booked'
        GROUP BY hour ORDER BY hour
    """)

    return json.dumps({
        "leads_by_day": lead_days,
        "bookings_by_day": booking_days,
        "responses_by_day": response_days,
        "bookings_by_hour": booking_hours,
    }, indent=2)


@mcp.tool()
def run_readonly_query(sql: str) -> str:
    """Run a custom read-only SQL query against the AT System database.
    Only SELECT statements are allowed. Use this for ad-hoc analysis
    when the other tools don't cover your specific question.

    Available tables: leads, estimates, proposals, messages, sms_queue,
    automation_log, workflow_templates, workflow_config, schedule_slots,
    pricing_config, referrals, notification_log, users.

    Key columns:
    - leads: id, contact_name, contact_phone, address, service_type, status,
      workflow_stage, form_data (JSONB with zip_code, sqft, height, age, condition),
      kanban_column, customer_responded, tags, created_at, archived
    - estimates: id, lead_id, status, inputs (JSONB), breakdown (JSONB),
      estimate_low, estimate_high, approved_at, created_at
    - proposals: id, token, estimate_id, lead_id, status, funnel_stage,
      selected_tier, booked_at, booked_tier_price, last_active_at, created_at
    - sms_queue: id, lead_id, stage, message_body, send_at, sent_at, status
    - messages: id, lead_id, direction, body, date_added"""

    stripped = sql.strip().rstrip(";").upper()
    if not stripped.startswith("SELECT"):
        return json.dumps({"error": "Only SELECT queries are allowed (read-only)"})

    forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "GRANT", "REVOKE"]
    for word in forbidden:
        if f" {word} " in f" {stripped} " or stripped.startswith(word):
            return json.dumps({"error": f"'{word}' statements are not allowed (read-only)"})

    try:
        rows = _query(sql)
        return json.dumps({"row_count": len(rows), "rows": rows}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run()
