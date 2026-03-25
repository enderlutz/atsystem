"""
SMS templates for the 13-stage GHL pipeline workflow.
All customer-facing messages use "Amy" (VA's sales name). Never "Olga".

Each stage returns a list of (delay_seconds, template_string) tuples.
Templates use {first_name}, {proposal_link}, {review_link}, {date},
{address}, {incentive}, {referral_bonus}, {stripe_link}, {month},
{entry_color_name}, {entry_color_link}, {signature_color_chart},
{legacy_color_chart}, {color_1}, {color_2} placeholders.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def render_message(template: str, context: dict) -> str:
    """Substitute placeholders in a template string."""
    result = template
    for key, val in context.items():
        result = result.replace(f"{{{key}}}", str(val))
    return result


def _load_template_overrides(stage: str, branch: str | None = None) -> list[tuple[int, str]] | None:
    """Load user-edited templates from workflow_templates table.
    Returns None if no overrides exist (fall back to hardcoded)."""
    try:
        from db import get_db
        db = get_db()
        query = db.table("workflow_templates").select("delay_seconds, message_body").eq("stage", stage)
        if branch:
            query = query.eq("branch", branch)
        else:
            query = query.is_("branch", "null")
        res = query.order("sequence_index").execute()
        if not res.data:
            return None
        return [(r["delay_seconds"], r["message_body"]) for r in res.data]
    except Exception as e:
        logger.warning(f"Failed to load template overrides for {stage}: {e}")
        return None


def get_stage_messages(stage: str, metadata: dict | None = None) -> list[tuple[int, str]]:
    """Returns [(delay_seconds, template_string), ...] for a stage.

    Checks workflow_templates DB table for user overrides first.
    Falls back to hardcoded templates if no overrides exist.
    """
    metadata = metadata or {}

    # Determine branch for branching stages
    branch = None
    if stage == "package_selected":
        branch = metadata.get("selected_tier", "signature")

    # Check DB overrides first
    overrides = _load_template_overrides(stage, branch)
    if overrides is not None:
        return overrides

    # Fall back to hardcoded templates
    if stage == "package_selected":
        return _get_package_selected_messages(metadata.get("selected_tier", "signature"))

    if stage == "deposit_paid":
        return _get_deposit_paid_messages(metadata)

    return STAGE_TEMPLATES.get(stage, [])


def get_default_stage_messages(stage: str, branch: str | None = None) -> list[tuple[int, str]]:
    """Return hardcoded defaults for a stage (ignoring DB overrides).
    Used by the API to show what the defaults are."""
    if stage == "package_selected":
        return _get_package_selected_messages(branch or "signature")
    if stage == "deposit_paid":
        return _get_deposit_paid_messages({})
    return STAGE_TEMPLATES.get(stage, [])


# -- Stage 1: New Lead --------------------------------------------------------

_NEW_LEAD = [
    (0,
     "Hey {first_name}, this is Amy with A&T's Pressure Washing & Fence "
     "Restoration. We just received your inquiry, thanks for reaching out "
     "to us! You likely saw us on an ad or in one of the home-improvement "
     "magazines. While we're working on your quote are there any questions "
     "you have for us or any more information you would like to add for us "
     "to create your quote?\n\n"
     "Btw, this is a fence we just finished up nearby!"),
    (3600,  # 1 hour
     "Hey {first_name}, just checking back in! We really do want to make "
     "sure we give y'all the best estimate we can. Anything specific about "
     "your fence we should know about?"),
    (86400,  # 24 hours
     "Hey {first_name}, just wanted to reach out one more time! We specialize "
     "in fence restoration and we would just love to help y'all out. Reply "
     "anytime and we'll get your personalized quote put together for you! "
     "- Amy"),
]

# -- Stage 1b: New Build — Can't Measure on Google Earth ----------------------

_NEW_BUILD = [
    (0,
     "Hi {first_name}! We were checking out your address to measure your fence "
     "line through Google Earth and it looks like your home might be a newer "
     "build — it hasn't been fully updated on the map yet! No worries though. "
     "We have two easy options: you can send us a few photos of your fence so "
     "we can estimate from those, or we can do a quick free in-person "
     "measurement. Which one works better for you?"),
    (86400,  # 24 hours
     "Hey {first_name}! Just circling back on this! We just need either some "
     "fence photos or to schedule a quick free visit so we can get your "
     "estimate put together. Which works best for you?"),
]

# -- Stage 2: Asking for Address / ZIP ----------------------------------------

_ASKING_ADDRESS = [
    (0,
     "Hey {first_name}! So to get your free estimate put together, we "
     "actually measure your fence line through Google Earth. It's the only "
     "way we can get y'all an honest price since everything goes by square "
     "footage. We just need your home address and ZIP code to get that done. "
     "And I promise we won't just show up at your door, this is strictly for "
     "measuring! What's the best address for you?"),
    (86400,  # 24 hours
     "Hey {first_name}, just circling back on this! We measure the fence "
     "through Google Earth so there's no site visit or anything like that. "
     "Just drop your address and ZIP and we'll have your estimate ready for "
     "you same day!"),
]

# -- Stage 3: Hot Lead - Send Proposal ----------------------------------------

_HOT_LEAD = [
    (0,
     "Hey {first_name}! Your personalized fence staining estimate is all "
     "ready for you! Check it out here: {proposal_link}. You can pick your "
     "package, color, and date all in one spot. Only takes a couple minutes!"),
]

# -- Stage 4: Proposal Sent - Follow-ups until opened -------------------------

_PROPOSAL_SENT = [
    (14400,  # 4 hours
     "Hey {first_name}! Just wanted to make sure your estimate came through "
     "alright. Here's the link again if you need it: {proposal_link}. And "
     "don't hesitate to reach out if you have any questions, we're happy to "
     "help y'all out!"),
    (172800,  # Day 2
     "Hey {first_name}, your fence estimate is still sitting here waiting on "
     "you! Honestly, most of our customers are surprised at how affordable a "
     "full restoration ends up being. Take a look when you get a chance: "
     "{proposal_link}"),
    (345600,  # Day 4
     "Hey {first_name}, good news, we've still got availability on the "
     "schedule for your area! Your estimate is ready whenever you are: "
     "{proposal_link}"),
    (432000,  # Day 5
     "Hey {first_name}! Still thinking it over? Totally get it! If you have "
     "any questions about the packages or what's included, just reply and I'm "
     "happy to walk you through it. We would love to take care of y'all!"),
    (518400,  # Day 6
     "Hey {first_name}, last little check-in from me! Your estimate is still "
     "right here whenever you're ready: {proposal_link} — Amy"),
]

# -- Stage 5: No Package Selection --------------------------------------------

_NO_PACKAGE = [
    (0,  # Immediate — 15-min wait already happened in PROPOSAL_SENT stage
     "Hey {first_name}! I noticed you took a look at your estimate, that's "
     "great! Our most popular option is the Signature package. It gives you "
     "beautiful results and honestly the best value. Need a hand choosing? "
     "Just holler and I'll walk y'all through it!"),
    (86400,  # Day 1
     "Just a heads up, our schedule tends to fill up pretty quick around "
     "your area! If you want to grab your spot, you can pick your package "
     "right here: {proposal_link}"),
    (259200,  # Day 3
     "We just wrapped up a fence near you and oh my goodness, it turned out "
     "so beautiful. Here's what some of your neighbors have been saying: "
     "{review_link}. Ready to get yours looking that good? {proposal_link}"),
    (432000,  # Day 5
     "Hey {first_name}, your estimate is still here for you but I'd hate "
     "for you to lose your spot. Is there anything I can answer to help you "
     "decide? I'm happy to help!"),
    (518400,  # Day 6
     "Hey {first_name}, is there anything at all I can help you with? I'm "
     "right here if you need me!"),
]

# -- Stage 6: Package Selected / No Color -------------------------------------
# Has 3 branches based on selected_tier. Shared follow-ups after.

_PACKAGE_SELECTED_SHARED = [
    (7200,  # 2 hours
     "Hey {first_name}! Having trouble picking a color? I totally get it, "
     "there are some beautiful options! Just reply with your fence material "
     "like wood, cedar, or pine and we'll tell you what looks best on it!"),
    (172800,  # Day 2
     "Hey {first_name}! Once you pick your color we can get you right on "
     "the schedule. Which one are you leaning toward? I'm happy to help if "
     "you're stuck!"),
]

_PACKAGE_ENTRY_FIRST = (
    0,
    "Great choice on the Entry package, {first_name}! Now let's get your "
    "stain color picked out. The Entry package comes in {entry_color_name}. "
    "Here's what it looks like on a real fence: {entry_color_link}. If you "
    "love it, just go ahead and select it in your proposal and we'll get you "
    "moving right along to scheduling!"
)

_PACKAGE_SIGNATURE_FIRST = (
    0,
    "Oh I love that you went with the Signature package, {first_name}! Now "
    "let's pick your stain color. You've got 6 gorgeous options to choose "
    "from. Here's a quick look at all of them: {signature_color_chart}. Our "
    "most popular ones are {color_1} and {color_2}. Just pick your favorite "
    "in the proposal and we'll get you on the schedule!"
)

_PACKAGE_LEGACY_FIRST = (
    0,
    "Excellent choice going with the Legacy package, {first_name}! You get "
    "access to our full premium color lineup with 6 beautiful options. "
    "Here's the whole collection: {legacy_color_chart}. Our Legacy customers "
    "just love {color_1} and {color_2}. Pick your color in the proposal and "
    "we'll get your date all set!"
)


def _get_package_selected_messages(tier: str) -> list[tuple[int, str]]:
    if tier == "entry":
        first = _PACKAGE_ENTRY_FIRST
    elif tier == "legacy":
        first = _PACKAGE_LEGACY_FIRST
    else:
        first = _PACKAGE_SIGNATURE_FIRST
    return [first] + _PACKAGE_SELECTED_SHARED


# -- Stage 7: No Date Selected ------------------------------------------------

_NO_DATE = [
    (0,
     "Hey {first_name}! I see you picked your color, love it! You just "
     "haven't grabbed a date yet. We've got openings in your area next week "
     "if you want to snag one before they're gone! {proposal_link}"),
    (14400,  # 4 hours
     "Quick reminder, scheduling only takes about 30 seconds! Pick a day "
     "that works for you right here: {proposal_link}"),
    (172800,  # Day 2
     "Heads up {first_name}, our {month} slots are filling up fast around "
     "your area. You might want to get your date locked in so you're not "
     "stuck waiting weeks! {proposal_link}"),
    (345600,  # Day 4
     "Hey {first_name}, this is Amy with A&T's Fence Staining. I just "
     "wanted to personally reach out and make sure we get you taken care of. "
     "Is there a certain timeframe that works best for y'all? And is there "
     "anything else I can help with? I'm here for you!"),
]

# -- Stage 8: Date Selected / No Deposit --------------------------------------

_DATE_SELECTED = [
    (60,  # 1 minute — fires immediately if customer left; deferred to 15 min if still active
     "Awesome, {first_name}! Your date is set for {date}! To get it locked "
     "in, we just need a $50 deposit that goes right toward your total. Only "
     "takes a minute: {stripe_link}. Just so you know, your spot isn't "
     "officially confirmed until the deposit comes through!"),
    (7200,  # 2 hours
     "Hey there! Just a quick reminder, your {date} appointment isn't "
     "locked in yet until that $50 deposit is completed. I'd hate for you "
     "to lose your spot: {stripe_link}"),
    (86400,  # Day 1 evening
     "We're holding your {date} slot for you but we can't hang onto it for "
     "too much longer. You can take care of your deposit right here: "
     "{stripe_link}"),
    (172800,  # Day 2
     "Hey {first_name}, just giving you one last heads up. We're going to "
     "need to release unconfirmed slots tomorrow morning. Get your $50 "
     "deposit taken care of real quick to keep your date: {stripe_link}"),
]

# -- Stage 9: Deposit Paid (CLOSED) -------------------------------------------
# Special: day-before and job-day messages are scheduled relative to booked_at,
# not stage entry. Handled dynamically.

_DEPOSIT_PAID_CONFIRMATION = (
    0,
    "You're all set, {first_name}! Your fence staining is officially "
    "confirmed for {date}! Our crew will be out there between 8 and 9 AM. "
    "We'll shoot you a text that morning to let you know we're on the way. "
    "If you need anything at all before then, don't be a stranger!"
)

_DEPOSIT_PAID_DAY_BEFORE = (
    "Hey {first_name}! Just a friendly reminder, our crew will be at "
    "{address} tomorrow for your fence staining! Just make sure that gate "
    "is accessible and we'll handle everything from there. We can't wait to "
    "get y'all taken care of!"
)

_DEPOSIT_PAID_JOB_DAY = (
    "Good morning {first_name}! Our crew is headed your way and should be "
    "there by 9 AM. Get ready, your fence is about to look brand new!"
)


def _get_deposit_paid_messages(metadata: dict) -> list[tuple[int, str]]:
    """Confirmation message immediately. Day-before and job-day are
    scheduled by the timeout checker based on booked_at."""
    return [_DEPOSIT_PAID_CONFIRMATION]


# Exposed for the timeout checker to schedule day-before / job-day
DEPOSIT_PAID_DAY_BEFORE_TEMPLATE = _DEPOSIT_PAID_DAY_BEFORE
DEPOSIT_PAID_JOB_DAY_TEMPLATE = _DEPOSIT_PAID_JOB_DAY


# -- Stage 10: Additional Service Price ---------------------------------------

_ADDITIONAL_SERVICE = [
    # No auto-message - VA sends manual price.
    # Only the follow-up is automated:
    (86400,  # 24 hours
     "Hey {first_name}! Just checking back in on that additional service "
     "quote we sent over. Got any questions or are you ready to go ahead and "
     "add it on? Happy to help either way!"),
]

# -- Stage 11: Job Complete ---------------------------------------------------

_JOB_COMPLETE = [
    (0,
     "Hey {first_name}! I sure hope you are loving that new fence! If our "
     "crew did a good job for y'all, it would mean the absolute world to us "
     "if you could leave a quick Google review. Only takes about 30 seconds: "
     "{review_link}"),
    (259200,  # Day 3
     "Hey {first_name}! If any of your neighbors or friends ask about your "
     "fence, we would be so grateful for the referral! Anyone who books "
     "through you gets {referral_bonus}. Just reply REFER and I'll get you "
     "your personal link! - Amy"),
]

# -- Stage 12: Cold Lead Nurture ----------------------------------------------

_COLD_NURTURE = [
    (1209600,  # Week 2 (14 days)
     "Hey {first_name}! This is Amy with A&T's Fence Staining. Just wanted "
     "to check in on you and see if there's anything I can help with or any "
     "questions about your estimate? We're still here for y'all!"),
    (2592000,  # Month 1 (30 days)
     "Hey {first_name}! Quick heads up, {season} is actually one of the "
     "best times to get a fence stained here in Houston. The wood soaks up "
     "the stain so much better and it lasts longer too. Your estimate is "
     "still on file whenever you're ready: {proposal_link}"),
    (5184000,  # Month 2 (60 days)
     "Hey {first_name}! We just finished up a fence in your area and oh my "
     "goodness, the transformation was just beautiful. Here's what one of "
     "your neighbors had to say: {review_link}. Your estimate is still here "
     "whenever you're ready: {proposal_link}"),
    (7776000,  # Month 3 (90 days)
     "Hey {first_name}! This is Amy with A&T's. We've got a little "
     "something special going on this month, {incentive}. Your estimate is "
     "still on file if you'd like to take advantage: {proposal_link}"),
    (10368000,  # Month 4 (120 days)
     "Hey {first_name}! Just thinking about you and wanted to check in. "
     "How's that fence holding up? Whenever you're ready to get it taken "
     "care of, I'm right here for you! - Amy"),
    (15552000,  # Month 6 (180 days)
     "Hey {first_name}, this is Amy with A&T's. I don't want to keep "
     "bothering you so this'll be my last little message. If you ever decide "
     "you're ready to get that fence looking beautiful again, we would just "
     "love to help. Your estimate will always be on file for you. Wishing "
     "y'all all the best! - Amy"),
]

# -- Stage 13: Past Customer Nurture ------------------------------------------

_PAST_CUSTOMER = [
    (2592000,  # Month 1
     "Hey {first_name}! Hope you're still just loving that fence! Quick "
     "little reminder, if you refer a friend or neighbor and they book with "
     "us, y'all both get {referral_bonus}! Just reply REFER and I'll send "
     "you your personal link. - Amy"),
    (7776000,  # Month 3
     "Hey {first_name}! This is Amy with A&T's, just checking in on you! "
     "How's that fence looking? Houston weather can really do a number on "
     "stain so just holler if you ever need a touch up!"),
    (28512000,  # Month 11 (~330 days)
     "Hey {first_name}! Can you believe it's been almost a year since we "
     "stained your fence? Most fences here in Houston need a fresh coat "
     "every 2 to 3 years to stay nice and protected. Want us to take a look "
     "and get you a renewal estimate? - Amy"),
    (31104000,  # Month 12 (~360 days)
     "Hey {first_name}! Just following up on that renewal estimate. We're "
     "booking out fast this season and I'd hate for you to miss out on a "
     "good spot. Want me to pull up your file? - Amy"),
    (59616000,  # Month 23 (~690 days)
     "Hey {first_name}! It's been about 2 years since we did your fence, "
     "and that's right around when most Houston fences start showing a "
     "little wear. Want us to get you a fresh estimate put together? We've "
     "still got all your info on file! - Amy"),
    (62208000,  # Month 24 (~720 days)
     "Hey {first_name}! Just making sure you saw my last message about your "
     "fence renewal. Let me know if you'd like us to put together an updated "
     "estimate for you, we'd love to take care of y'all again! - Amy"),
]


# -- Attachments map ----------------------------------------------------------
# Maps (stage, sequence_index) → list of public image URLs to attach as MMS.
# Only messages listed here will include attachments.

STAGE_ATTACHMENTS: dict[tuple[str, int], list[str]] = {
    ("new_lead", 0): ["{proposal_base_url}/images/fence-before-after.png"],
}


def get_message_attachments(stage: str, sequence_index: int, context: dict | None = None) -> list[str]:
    """Return attachment URLs for a specific message, with placeholders rendered."""
    urls = STAGE_ATTACHMENTS.get((stage, sequence_index), [])
    if not urls:
        return []
    context = context or {}
    return [render_message(url, context) for url in urls]


# -- Master template map ------------------------------------------------------

STAGE_TEMPLATES: dict[str, list[tuple[int, str]]] = {
    "new_lead": _NEW_LEAD,
    "new_build": _NEW_BUILD,
    "asking_address": _ASKING_ADDRESS,
    "hot_lead": _HOT_LEAD,
    "proposal_sent": _PROPOSAL_SENT,
    "no_package_selection": _NO_PACKAGE,
    # "package_selected" handled by get_stage_messages() with branching
    "no_date_selected": _NO_DATE,
    "date_selected": _DATE_SELECTED,
    # "deposit_paid" handled dynamically
    "additional_service": _ADDITIONAL_SERVICE,
    "job_complete": _JOB_COMPLETE,
    "cold_nurture": _COLD_NURTURE,
    "past_customer": _PAST_CUSTOMER,
}


def get_current_season() -> str:
    """Return the current season name for Houston, TX."""
    from datetime import datetime, timezone
    month = datetime.now(timezone.utc).month
    if month in (3, 4, 5):
        return "spring"
    elif month in (6, 7, 8):
        return "summer"
    elif month in (9, 10, 11):
        return "fall"
    return "winter"


def get_current_month_name() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%B")
