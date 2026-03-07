"""
Estimate calculation engine — A&T's Pressure Washing, Fence Restoration Division.

Pricing tiers, zone surcharges, and Green/Yellow/Red approval logic
match the Fence_Quote_System.xlsx exactly.
"""
from __future__ import annotations

from typing import Any
from models.estimate import BreakdownItem

# ---------------------------------------------------------------------------
# Zone zip code sets
# ---------------------------------------------------------------------------

BASE_ZONE_ZIPS = {
    "77433", "77429", "77410", "77095", "77065", "77064", "77070", "77069",
    "77068", "77066", "77067", "77040", "77041", "77084", "77377", "77375",
    "77379", "77388", "77449", "77493", "77447", "77362", "77355",
}

BLUE_ZONE_ZIPS = {
    "77380", "77381", "77382", "77384", "77385", "77386", "77389", "77354",
    "77494", "77450", "77094", "77077", "77079", "77024", "77441",
}

PURPLE_ZONE_ZIPS = {
    "77479", "77478", "77406", "77407", "77469", "77471", "77043", "77042",
    "77057", "77008", "77007", "77302", "77303", "77304", "77316", "77459",
    "77477", "77489", "77498", "77301", "77305", "77306", "77318", "77356",
    "77009", "77003", "77004", "77006", "77019", "77027", "77056", "77025",
    "77030", "77074", "77036", "77063", "77096", "77044", "77396", "77345",
    "77346", "77338", "77339", "77373",
}

ZONE_SURCHARGES: dict[str, float | None] = {
    "Base":    0.00,
    "Blue":    0.02,
    "Purple":  0.05,
    "Outside": None,   # Requires Alan's approval
}

# ---------------------------------------------------------------------------
# Pricing tiers — per sq ft by age bracket
# None = 15+ year fence → requires manual review (RED)
# ---------------------------------------------------------------------------

TIER_RATES: dict[str, dict[str, float] | None] = {
    "brand_new": {"essential": 0.72, "signature": 0.84, "legacy": 1.09},
    "1_6yr":     {"essential": 0.74, "signature": 0.86, "legacy": 1.11},
    "6_15yr":    {"essential": 0.76, "signature": 0.88, "legacy": 1.13},
    "15plus":    None,
}

# Size surcharge: +$0.12/sqft for jobs between 500–1,000 sqft
SIZE_SURCHARGE_RATE = 0.12
SIZE_SURCHARGE_MIN  = 500
SIZE_SURCHARGE_MAX  = 1000

# Minimum job size for auto-approval
MIN_SQFT_AUTO = 500

# ---------------------------------------------------------------------------
# Pressure washing defaults (configurable via settings page)
# ---------------------------------------------------------------------------

DEFAULT_PRESSURE_CONFIG = {
    "base_rate_per_sqft": 0.25,
    "surface_factors": {"concrete": 1.0, "deck": 1.2, "siding": 1.3, "other": 1.0},
    "condition_factors": {"good": 1.0, "fair": 1.15, "poor": 1.35},
    "estimate_margin": 0.10,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_zone(zip_code: str) -> str:
    """Returns 'Base', 'Blue', 'Purple', or 'Outside'."""
    z = str(zip_code).strip()[:5]
    if z in BASE_ZONE_ZIPS:
        return "Base"
    if z in BLUE_ZONE_ZIPS:
        return "Blue"
    if z in PURPLE_ZONE_ZIPS:
        return "Purple"
    return "Outside"


def parse_fence_height(height_str: str) -> float:
    """
    Parse Facebook form answer to float feet.
    Options: "6ft standard" | "6.5ft standard with rot board" | "7ft" | "8ft" | "Not sure"
    """
    s = str(height_str).lower().strip()
    if "6.5" in s or "rot board" in s:
        return 6.5
    for num in ("8", "7", "6"):
        if s.startswith(num):
            return float(num)
    return 6.0  # default for "Not sure"


def parse_age_bracket(age_str: str) -> str:
    """
    Map Facebook form age answer to internal bracket key.
    Options: "Brand new (less than 6 months)" | "1-6 years" | "6-15 years"
             | "Older than 15 years / Not sure"
    """
    s = str(age_str).lower().strip()
    if "brand new" in s or "less than 6" in s:
        return "brand_new"
    if "1-6" in s or "1–6" in s:
        return "1_6yr"
    if "6-15" in s or "6–15" in s:
        return "6_15yr"
    # "Older than 15 years / Not sure" or anything unrecognized → safe default = RED
    return "15plus"


def parse_priority(timeline_str: str) -> str:
    """
    Map Facebook timeline answer to priority label.
    Options: "As soon as possible" | "Within 2 weeks" | "Sometime this month" | "Just planning ahead"
    """
    s = str(timeline_str).lower().strip()
    if "as soon" in s or "possible" in s:
        return "HOT"
    if "2 weeks" in s or "two weeks" in s:
        return "HIGH"
    if "this month" in s or "sometime" in s:
        return "MEDIUM"
    return "LOW"


def get_approval_status(
    age_bracket: str,
    zone: str,
    sqft: float,
    has_addons: bool,
    confident: bool = True,
) -> tuple[str, str]:
    """
    Returns (status, reason).
    status: 'green' | 'yellow' | 'red'

    RED criteria:
      - VA not confident in measurement
      - Outside service zone
      - Under 500 sqft
      - Fence 15+ years old

    YELLOW criteria (all green conditions met, but):
      - Customer requested add-on services → send fence quote now, price add-ons separately

    GREEN: confident + in-zone + 500+ sqft + under 15 yrs + no add-ons
    """
    red_reasons = []
    if not confident:
        red_reasons.append("VA not confident in measurement")
    if zone == "Outside":
        red_reasons.append("Outside service zone — requires Alan approval")
    if sqft < MIN_SQFT_AUTO:
        red_reasons.append(f"Job too small ({sqft:.0f} sqft — minimum {MIN_SQFT_AUTO} sqft for auto-approval)")
    if age_bracket == "15plus":
        red_reasons.append("Fence 15+ years old — requires Alan review")

    if red_reasons:
        return "red", "; ".join(red_reasons)

    if has_addons:
        return "yellow", "Add-on services requested — send fence quote now, price add-ons separately"

    return "green", "All criteria met — auto-send approved"


# ---------------------------------------------------------------------------
# Fence staining calculator
# ---------------------------------------------------------------------------

def calculate_fence_staining(
    form_data: dict[str, Any],
    config: dict[str, Any] | None = None,
    zip_code: str = "",
) -> tuple[float, float, list[BreakdownItem], dict[str, Any]]:
    """
    Returns (estimate_low, estimate_high, breakdown, meta).

    estimate_low/high are based on the Signature tier (middle tier).
    meta contains all 3 tier prices, zone, approval status, etc.

    form_data keys (as received from GHL/Facebook form):
      - fence_height:          "6ft standard" | "6.5ft standard with rot board" | "7ft" | "8ft" | "Not sure"
      - fence_age:             "Brand new (less than 6 months)" | "1-6 years" | "6-15 years" | "Older than 15 years / Not sure"
      - previously_stained:    "No" | "Yes" | "Not sure"
      - service_timeline:      "As soon as possible" | "Within 2 weeks" | "Sometime this month" | "Just planning ahead"
      - additional_services:   comma-separated string or empty
      - linear_feet:           float — entered by VA after measuring on Google Maps
      - confident:             bool — set by VA (defaults True)
      - zip_code:              5-digit zip from GHL contact address
    """
    # Parse inputs
    linear_feet = float(form_data.get("linear_feet") or 0)
    height = parse_fence_height(str(form_data.get("fence_height", "6ft standard")))
    age_bracket = parse_age_bracket(str(form_data.get("fence_age", "1-6 years")))
    additional_services = str(form_data.get("additional_services", "") or "").strip()
    has_addons = bool(additional_services) and additional_services.lower() not in ("none", "no")
    confident_pct = form_data.get("confident_pct")
    if confident_pct is not None:
        confident = float(confident_pct) >= 80
    else:
        confident = bool(form_data.get("confident", True))
    priority = parse_priority(str(form_data.get("service_timeline", "")))

    # Zone lookup
    zip_str = str(zip_code or form_data.get("zip_code", "") or "").strip()
    zone = get_zone(zip_str)
    zone_surcharge = ZONE_SURCHARGES.get(zone) or 0.0

    # Sqft
    sqft = round(linear_feet * height, 2)

    # Approval status
    approval_status, approval_reason = get_approval_status(
        age_bracket, zone, sqft, has_addons, confident
    )

    # Tier rates — None means 15+ year fence
    rates = TIER_RATES.get(age_bracket)
    if rates is None:
        meta: dict[str, Any] = {
            "zone": zone,
            "zone_surcharge": zone_surcharge,
            "sqft": sqft,
            "height": height,
            "age_bracket": age_bracket,
            "has_addons": has_addons,
            "priority": priority,
            "approval_status": "red",
            "approval_reason": "Fence 15+ years old — requires Alan review",
            "tiers": {"essential": 0.0, "signature": 0.0, "legacy": 0.0},
            "size_surcharge_applied": False,
        }
        return 0.0, 0.0, [], meta

    # Size surcharge
    size_surcharge_applied = SIZE_SURCHARGE_MIN <= sqft <= SIZE_SURCHARGE_MAX
    size_surcharge = SIZE_SURCHARGE_RATE if size_surcharge_applied else 0.0

    # Calculate all 3 tiers
    def calc_tier(base_rate: float) -> float:
        return round(sqft * (base_rate + zone_surcharge + size_surcharge), 2)

    tiers = {
        "essential": calc_tier(rates["essential"]),
        "signature":  calc_tier(rates["signature"]),
        "legacy":     calc_tier(rates["legacy"]),
    }

    # Signature is the primary estimate (most popular tier per Alan's notes)
    mid = tiers["signature"]
    low  = round(mid * 0.95, 2)
    high = round(mid * 1.05, 2)

    # Breakdown based on Signature tier
    base_cost = round(sqft * rates["signature"], 2)
    breakdown: list[BreakdownItem] = [
        BreakdownItem(
            label="Base cost (Signature tier)",
            value=base_cost,
            note=f"{sqft:.0f} sqft × ${rates['signature']}/sqft",
        ),
    ]
    if zone_surcharge > 0:
        breakdown.append(BreakdownItem(
            label=f"{zone} zone surcharge",
            value=round(sqft * zone_surcharge, 2),
            note=f"+${zone_surcharge}/sqft",
        ))
    if size_surcharge_applied:
        breakdown.append(BreakdownItem(
            label="Size surcharge (500–1,000 sqft range)",
            value=round(sqft * SIZE_SURCHARGE_RATE, 2),
            note=f"+${SIZE_SURCHARGE_RATE}/sqft",
        ))

    meta = {
        "zone": zone,
        "zone_surcharge": zone_surcharge,
        "sqft": sqft,
        "height": height,
        "age_bracket": age_bracket,
        "has_addons": has_addons,
        "priority": priority,
        "approval_status": approval_status,
        "approval_reason": approval_reason,
        "tiers": tiers,
        "size_surcharge_applied": size_surcharge_applied,
    }

    return low, high, breakdown, meta


# ---------------------------------------------------------------------------
# Pressure washing calculator
# ---------------------------------------------------------------------------

def calculate_pressure_washing(
    form_data: dict[str, Any],
    config: dict[str, Any] | None = None,
    zip_code: str = "",
) -> tuple[float, float, list[BreakdownItem], dict[str, Any]]:
    cfg = {**DEFAULT_PRESSURE_CONFIG, **(config or {})}

    sqft = float(form_data.get("square_footage") or 0)
    surface = str(form_data.get("surface_type", "concrete")).lower()
    condition = str(form_data.get("condition", "good")).lower()

    base_cost = sqft * cfg["base_rate_per_sqft"]

    surface_factors: dict = cfg["surface_factors"]
    surface_factor = surface_factors.get(surface, surface_factors.get("other", 1.0))

    condition_factors: dict = cfg["condition_factors"]
    condition_factor = condition_factors.get(condition, 1.0)

    mid = base_cost * surface_factor * condition_factor
    margin = cfg["estimate_margin"]
    low = round(mid * (1 - margin), 2)
    high = round(mid * (1 + margin), 2)

    breakdown = [
        BreakdownItem(label="Base cost", value=round(base_cost, 2),
                      note=f"{sqft:.0f} sqft × ${cfg['base_rate_per_sqft']}/sqft"),
        BreakdownItem(label="Surface adjustment",
                      value=round(base_cost * (surface_factor - 1), 2),
                      note=f"{surface} surface ({surface_factor}x)"),
        BreakdownItem(label="Condition adjustment",
                      value=round(base_cost * surface_factor * (condition_factor - 1), 2),
                      note=f"{condition} condition ({condition_factor}x)"),
    ]

    meta: dict[str, Any] = {
        "zone": get_zone(str(zip_code or form_data.get("zip_code", "") or "")),
        "sqft": sqft,
        "approval_status": "green" if sqft > 0 else "red",
        "approval_reason": "" if sqft > 0 else "Missing square footage",
        "tiers": {"essential": low, "signature": mid, "legacy": high},
    }

    return low, high, breakdown, meta


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def calculate_estimate(
    service_type: str,
    form_data: dict[str, Any],
    config: dict[str, Any] | None = None,
    zip_code: str = "",
) -> tuple[float, float, list[BreakdownItem], dict[str, Any]]:
    if service_type == "fence_staining":
        return calculate_fence_staining(form_data, config, zip_code)
    elif service_type == "pressure_washing":
        return calculate_pressure_washing(form_data, config, zip_code)
    else:
        raise ValueError(f"Unknown service type: {service_type}")
