"""
GoHighLevel API v2 client.
Handles fetching contact info, custom fields, conversations,
and sending messages/notes back to leads.
"""
from __future__ import annotations

import httpx
import logging
import re
from config import get_settings

logger = logging.getLogger(__name__)
GHL_BASE = "https://services.leadconnectorhq.com"


def _headers() -> dict:
    settings = get_settings()
    return {
        "Authorization": f"Bearer {settings.ghl_api_key}",
        "Version": "2021-07-28",
        "Content-Type": "application/json",
    }


# ── Contact fetching ──────────────────────────────────────────────────

def get_contacts(location_id: str, max_contacts: int = 500) -> list[dict]:
    """Fetch existing contacts from a GHL location (paginated)."""
    all_contacts: list[dict] = []
    limit = 20
    params: dict = {"locationId": location_id, "limit": limit}

    while len(all_contacts) < max_contacts:
        try:
            r = httpx.get(
                f"{GHL_BASE}/contacts/",
                headers=_headers(),
                params=params,
                timeout=30,
            )
            r.raise_for_status()
            data = r.json()
            contacts = data.get("contacts", [])
            all_contacts.extend(contacts)

            meta = data.get("meta", {})
            start_after = meta.get("startAfter")
            start_after_id = meta.get("startAfterId")

            if not start_after or not start_after_id or len(contacts) < limit:
                break

            params = {
                "locationId": location_id,
                "limit": limit,
                "startAfter": start_after,
                "startAfterId": start_after_id,
            }
        except Exception as e:
            logger.error(f"GHL get_contacts failed: {e}")
            break

    return all_contacts


def get_contact(contact_id: str) -> dict | None:
    try:
        r = httpx.get(f"{GHL_BASE}/contacts/{contact_id}", headers=_headers(), timeout=10)
        r.raise_for_status()
        return r.json().get("contact")
    except Exception as e:
        logger.error(f"GHL get_contact failed: {e}")
        return None


# ── Pipelines & Opportunities ─────────────────────────────────────────

def get_pipelines(location_id: str) -> list[dict]:
    """Fetch all opportunity pipelines (with stages) for a location."""
    try:
        r = httpx.get(
            f"{GHL_BASE}/opportunities/pipelines",
            headers=_headers(),
            params={"locationId": location_id},
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("pipelines", [])
    except Exception as e:
        logger.error(f"GHL get_pipelines failed: {e}")
        return []


def get_opportunities(location_id: str, pipeline_id: str, stage_id: str | None = None) -> list[dict]:
    """Fetch all opportunities from a pipeline, optionally filtered by stage."""
    all_opps: list[dict] = []
    page = 1

    while True:
        params: dict = {
            "location_id": location_id,
            "pipeline_id": pipeline_id,
            "limit": 100,
            "page": page,
        }
        if stage_id:
            params["pipeline_stage_id"] = stage_id

        try:
            r = httpx.get(
                f"{GHL_BASE}/opportunities/search",
                headers=_headers(),
                params=params,
                timeout=30,
            )
            r.raise_for_status()
            data = r.json()
            opps = data.get("opportunities", [])
            all_opps.extend(opps)

            meta = data.get("meta", {})
            total = meta.get("total", 0)
            if len(all_opps) >= total or len(opps) == 0:
                break
            page += 1
        except Exception as e:
            logger.error(f"GHL get_opportunities failed (page {page}): {e}")
            break

    return all_opps


# ── Custom field discovery ────────────────────────────────────────────

def get_custom_fields(location_id: str) -> list[dict]:
    """Fetch all custom fields defined in the GHL location."""
    try:
        r = httpx.get(
            f"{GHL_BASE}/locations/{location_id}/customFields",
            headers=_headers(),
            timeout=15,
        )
        r.raise_for_status()
        return r.json().get("customFields", [])
    except Exception as e:
        logger.error(f"GHL get_custom_fields failed: {e}")
        return []


# ── Messaging ─────────────────────────────────────────────────────────

def send_message_to_contact(contact_id: str, message: str) -> bool:
    """Send an SMS message to a contact via GHL."""
    settings = get_settings()
    try:
        payload = {
            "type": "SMS",
            "contactId": contact_id,
            "message": message,
            "locationId": settings.ghl_location_id,
        }
        r = httpx.post(f"{GHL_BASE}/conversations/messages", headers=_headers(),
                       json=payload, timeout=10)
        r.raise_for_status()
        logger.info(f"GHL message sent to contact {contact_id}")
        return True
    except Exception as e:
        logger.error(f"GHL send_message failed: {e}")
        return False


def format_estimate_for_client(estimate: dict, service_type: str) -> str:
    """Format the approved estimate as an SMS to send to the lead via GHL."""
    low = estimate.get("estimate_low", 0)
    high = estimate.get("estimate_high", 0)
    service = "Fence Restoration" if service_type == "fence_staining" else "Pressure Washing"
    return (
        f"Hi! Thanks for reaching out about your {service} project. "
        f"Based on the details you shared, our estimate is "
        f"${low:,.0f}–${high:,.0f}. "
        f"This is a preliminary range — our team will be in touch shortly to confirm the details "
        f"and send your full proposal. Any questions? Reply here anytime!"
    )


# ── Conversations (response detection) ───────────────────────────────

def get_conversations(contact_id: str) -> list[dict]:
    """Fetch conversation messages for a contact to detect inbound replies."""
    try:
        r = httpx.get(
            f"{GHL_BASE}/conversations/search",
            headers=_headers(),
            params={"contactId": contact_id},
            timeout=15,
        )
        r.raise_for_status()
        conversations = r.json().get("conversations", [])
        if not conversations:
            return []

        conv_id = conversations[0]["id"]

        r2 = httpx.get(
            f"{GHL_BASE}/conversations/{conv_id}/messages",
            headers=_headers(),
            timeout=15,
        )
        r2.raise_for_status()
        messages_data = r2.json().get("messages", {})
        if isinstance(messages_data, dict):
            return messages_data.get("messages", [])
        return messages_data if isinstance(messages_data, list) else []
    except Exception as e:
        logger.error(f"GHL get_conversations failed for {contact_id}: {e}")
        return []


# ── Write-back to GHL ────────────────────────────────────────────────

def add_contact_note(contact_id: str, body: str) -> bool:
    """POST a note to a GHL contact."""
    try:
        r = httpx.post(
            f"{GHL_BASE}/contacts/{contact_id}/notes",
            headers=_headers(),
            json={"body": body},
            timeout=10,
        )
        r.raise_for_status()
        logger.info(f"Note added to GHL contact {contact_id}")
        return True
    except Exception as e:
        logger.error(f"GHL add_note failed: {e}")
        return False


# ── Webhook payload parsing ──────────────────────────────────────────

def resolve_custom_fields(raw_custom: list[dict], field_map: dict[str, str]) -> dict[str, str]:
    """Translate GHL custom field IDs to our internal field names using the mapping."""
    result = {}
    for f in raw_custom:
        ghl_id = f.get("id", "")
        ghl_key = f.get("key", "")
        value = f.get("value", f.get("fieldValue", ""))

        # Try mapping by ID first, then by key, then fall back to key as-is
        our_name = field_map.get(ghl_id) or field_map.get(ghl_key) or ghl_key
        if our_name and value and str(value).strip():
            result[our_name] = str(value).strip()
    return result


def parse_webhook_payload(payload: dict, field_map: dict[str, str] | None = None) -> dict:
    """
    Normalize a GHL webhook/contact payload into our standard lead format.
    If field_map is provided, translates GHL custom field IDs to our names.
    """
    raw_custom = payload.get("customFields", []) or payload.get("customData", {})

    if field_map and isinstance(raw_custom, list):
        form_data = resolve_custom_fields(raw_custom, field_map)
    elif isinstance(raw_custom, list):
        fields = {
            f.get("key", f.get("id", "")): f.get("value", f.get("fieldValue", ""))
            for f in raw_custom
            if f.get("key") or f.get("id")
        }
        form_data = {
            "service_timeline":    fields.get("service_timeline", ""),
            "fence_height":        fields.get("fence_height", ""),
            "fence_age":           fields.get("fence_age", ""),
            "previously_stained":  fields.get("previously_stained", ""),
            "additional_services": fields.get("additional_services", ""),
            "additional_notes":    fields.get("additional_notes", ""),
        }
    elif isinstance(raw_custom, dict):
        form_data = dict(raw_custom)
    else:
        form_data = {}

    # Remove empty values
    form_data = {k: v for k, v in form_data.items() if v and str(v).strip()}

    # Service type detection
    tags = payload.get("tags", []) or []
    service_raw = (
        payload.get("serviceType", "")
        or payload.get("service_type", "")
        or form_data.get("service_type", "")
        or " ".join(tags)
    ).lower()

    service_type = (
        "pressure_washing"
        if ("pressure" in service_raw or "wash" in service_raw)
        else "fence_staining"
    )

    # Build address + extract zip code
    address_parts = [
        payload.get("address1", ""),
        payload.get("city", ""),
        payload.get("state", ""),
        payload.get("postalCode", ""),
    ]
    address = " ".join(p for p in address_parts if p).strip()
    zip_code = str(payload.get("postalCode", "") or "").strip()[:5]

    # Fallback 1: extract 5-digit zip from full address string
    if not zip_code and address:
        m = re.search(r'\b(\d{5})\b', address)
        if m:
            zip_code = m.group(1)

    # Fallback 2: check form_data (VA may have entered zip manually via dashboard)
    if not zip_code:
        zip_code = str(fields.get("zip_code", "") or "").strip()[:5]

    first = payload.get("firstName", "") or payload.get("first_name", "")
    last  = payload.get("lastName", "")  or payload.get("last_name", "")

    return {
        "ghl_contact_id": payload.get("contactId", payload.get("id", "")),
        "service_type":   service_type,
        "address":        address,
        "zip_code":       zip_code,
        "contact_name":   f"{first} {last}".strip(),
        "contact_phone":  payload.get("phone", ""),
        "contact_email":  payload.get("email", ""),
        "form_data":      form_data,
        "raw_payload":    payload,
    }
