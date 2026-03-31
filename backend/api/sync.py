"""
GHL Contact Sync — imports existing GHL contacts as leads.
POST /api/sync/ghl
"""
from __future__ import annotations

import uuid
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks

from db import get_db
from config import get_settings
from services.ghl import (
    get_contacts, get_contact, get_custom_fields, parse_webhook_payload,
    get_pipelines, get_opportunities, update_opportunity_stage,
)
from api.webhooks import get_pricing_config, process_lead, get_field_map, recalculate_estimate_for_lead

router = APIRouter()
logger = logging.getLogger(__name__)

FORM_FIELD_KEYS = {
    "fence_height", "fence_age", "previously_stained",
    "service_timeline", "additional_services", "additional_notes",
    "surface_type", "square_footage",
}

# Fields entered by the VA in the dashboard — must NEVER be overwritten by a GHL sync.
# GHL doesn't know about these; they're measured/set by the VA.
VA_OWNED_FIELDS = {"linear_feet", "zip_code", "confident_pct", "fence_sides", "contact_edited", "address_confirmed"}

# Expected field names we try to auto-map
EXPECTED_FIELDS = {
    "fence_height", "fence_age", "previously_stained",
    "service_timeline", "additional_services", "additional_notes",
    "surface_type", "square_footage", "service_type",
}


@router.post("/api/sync/ghl")
async def sync_ghl_contacts(background_tasks: BackgroundTasks):
    settings = get_settings()
    db = get_db()

    existing_res = db.table("leads").select("ghl_contact_id").execute()
    existing_ids = {r["ghl_contact_id"] for r in (existing_res.data or [])}

    field_map = get_field_map()
    contacts = get_contacts(settings.ghl_location_id)
    logger.info(f"GHL sync: fetched {len(contacts)} contacts")

    imported = 0
    skipped_duplicate = 0
    skipped_no_fields = 0
    errors = 0

    for contact in contacts:
        contact_id = contact.get("id", "")
        if not contact_id:
            continue
        if contact_id in existing_ids:
            skipped_duplicate += 1
            continue

        lead_data = parse_webhook_payload(contact, field_map=field_map)

        if not lead_data["form_data"]:
            skipped_no_fields += 1
            continue

        lead_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        lead_row = {
            "id":             lead_id,
            "ghl_contact_id": contact_id,
            "service_type":   lead_data["service_type"],
            "status":         "new",
            "address":        lead_data["address"],
            "form_data":      lead_data["form_data"],
            "contact_name":   lead_data.get("contact_name", ""),
            "contact_phone":  lead_data.get("contact_phone", ""),
            "contact_email":  lead_data.get("contact_email", ""),
            "priority":       lead_data.get("priority", "MEDIUM"),
            "tags":           [],
            "created_at":     now,
        }

        try:
            db.table("leads").insert(lead_row).execute()
            background_tasks.add_task(process_lead, lead_id, lead_data)
            existing_ids.add(contact_id)
            imported += 1
            logger.info(f"Synced contact {contact_id} → lead {lead_id}")
        except Exception as e:
            logger.error(f"Failed to import contact {contact_id}: {e}")
            errors += 1

    return {
        "status":             "done",
        "total_fetched":      len(contacts),
        "imported":           imported,
        "skipped_duplicate":  skipped_duplicate,
        "skipped_no_fields":  skipped_no_fields,
        "errors":             errors,
    }


FENCE_PIPELINE_NAME = "Interactive Proposal"
TARGET_STAGES = {
    "New lead (waiting for automation response)": "MEDIUM",
    "Asking for Address/ZIP (Automation)": "MEDIUM",
    "Address Correct but Not Measurable": "MEDIUM",
    "Needs Review": "HOT",
    "Hot lead (send proposal)": "HOT",
    "Re-quote Past Leads": "MEDIUM",
    "Proposal sent(follow ups to open)": "MEDIUM",
    "no package selection": "MEDIUM",
    "package selection-no color chosen": "MEDIUM",
    "no date selected": "MEDIUM",
    "date selected, no deposit": "MEDIUM",
    "Deposit paid (CLOSED)": "LOW",
    "Declined Estimate": "LOW",
    "Planning for future": "LOW",
    "job complete(review & referral)": "LOW",
    "Cold Lead Nurture": "LOW",
}

WOODLANDS_TARGET_STAGES = {
    "New Lead": "MEDIUM",
    "PARTIAL REPLY": "MEDIUM",
    "HOT LEAD-SEND ESTIMATE": "HOT",
    "DAY 1": "MEDIUM",
    "DAY 2": "MEDIUM",
    "DAY 3": "MEDIUM",
    "DAY 4": "MEDIUM",
    "DAY 5": "MEDIUM",
    "DAY 6": "MEDIUM",
    "LEAD_FOLLOW UP LATER": "LOW",
    "ESTIMATE SENT": "MEDIUM",
    "ESTIMATE_FOLLOW UP LATER": "MEDIUM",
    "RESPONDED TO ESTIMATE": "HOT",
    "TOP PRIORITY-Responded to estimate": "HOT",
    "DECLINED ESTIMATE": "LOW",
    "DEAL CLOSED & NOT SCHEDULED": "LOW",
    "CLOSED & SCHEDULED": "LOW",
    "COMPLETED JOB-HAPPY CUSTOMER- SEND REVIEW": "LOW",
    "COMPLETED JOB- UNHAPPY CUSTOMER": "LOW",
    "LONG TERM NURTURE": "LOW",
    "Cold Leads (Never answered)": "LOW",
}

INTERACTIVE_PIPELINE_NAME = "Interactive Proposal"
IP_STAGE_NEW_LEAD   = "New lead (waiting for automation response)"
IP_STAGE_HOT_LEAD   = "Hot lead (send proposal)"
IP_STAGE_NO_ADDRESS = "Asking for Address/ZIP (Automation)"


def _resolve_ip_stage(
    stage_name: str,
    address: str,
    zip_code: str,
    ip_stage_map: dict[str, str],
) -> str | None:
    """Return the Interactive Proposal stage ID to move this opp to, or None."""
    if not ip_stage_map:
        return None
    if not address.strip() or not zip_code.strip():
        return ip_stage_map.get(IP_STAGE_NO_ADDRESS)
    if stage_name == "Hot lead (send proposal)":
        return ip_stage_map.get(IP_STAGE_HOT_LEAD)
    return ip_stage_map.get(IP_STAGE_NEW_LEAD)


async def run_pipeline_sync(
    background_tasks: BackgroundTasks | None = None,
    location_id: str | None = None,
    pipeline_name: str | None = None,
    location_label: str | None = None,
    target_stages: dict[str, str] | None = None,
    skip_automations: bool = False,
    default_kanban_column: str | None = None,
) -> dict:
    """
    Core pipeline sync — can be called from the API endpoint or the background poller.
    Imports new leads AND refreshes contact data for existing ones.
    Re-runs the estimator if form_data changed.

    location_id: GHL location to sync. Defaults to settings.ghl_location_id.
    pipeline_name: Pipeline to sync from. Defaults to "Interactive Proposal".
    location_label: Label to tag leads with (e.g. "Cypress", "Woodlands").
    target_stages: Stage name → priority mapping. Defaults to TARGET_STAGES.
    skip_automations: If True, don't run estimator or workflow on import.
    default_kanban_column: Override kanban column for imported leads.
    """
    import asyncio

    settings = get_settings()
    db = get_db()
    loc_id = location_id or settings.ghl_location_id
    pipe_name = pipeline_name or FENCE_PIPELINE_NAME
    stages_map = target_stages or TARGET_STAGES

    # 1. Find the target pipeline
    pipelines = get_pipelines(loc_id)
    pipeline = next(
        (p for p in pipelines if p.get("name", "").strip().upper() == pipe_name.upper()),
        None,
    )
    if not pipeline:
        names = [p.get("name") for p in pipelines]
        return {
            "status": "error",
            "message": f"Pipeline '{pipe_name}' not found in location {loc_id}. Available: {names}",
        }

    pipeline_id = pipeline["id"]
    stage_map = {s["name"]: s["id"] for s in pipeline.get("stages", [])}

    # Discover Interactive Proposal stage IDs from the same pipelines fetch
    ip_stage_map: dict[str, str] = {}
    for pl in pipelines:
        if pl.get("name", "").strip().lower() == INTERACTIVE_PIPELINE_NAME.lower():
            for stage in pl.get("stages", []):
                ip_stage_map[stage["name"].strip()] = stage["id"]
            break
    if not ip_stage_map:
        logger.warning("'Interactive Proposal' pipeline not found — GHL stage moves will be skipped")
    matched_stages = {name: stage_map[name] for name in stages_map if name in stage_map}

    if not matched_stages:
        return {
            "status": "error",
            "message": f"None of the target stages found. Pipeline stages: {list(stage_map.keys())}",
        }

    # 2. Load existing leads (id, contact_id, tags, form_data)
    # Include archived leads so we don't re-import them as new
    existing_res = db.table("leads").select("id, ghl_contact_id, tags, form_data, archived").execute()
    existing_map = {
        r["ghl_contact_id"]: {
            "id": r["id"],
            "tags": r.get("tags") or [],
            "form_data": r.get("form_data") or {},
            "archived": r.get("archived", False),
        }
        for r in (existing_res.data or [])
    }
    existing_ids = set(existing_map.keys())

    field_map = get_field_map()
    imported = 0
    updated = 0
    errors = 0
    now = datetime.now(timezone.utc).isoformat()

    # 3. Pull opportunities per stage
    for stage_name, stage_id in matched_stages.items():
        priority = stages_map[stage_name]
        opps = get_opportunities(loc_id, pipeline_id, stage_id)
        logger.info(f"Pipeline sync: {len(opps)} opportunities in stage '{stage_name}'")

        for opp in opps:
            contact_info = opp.get("contact", {})
            contact_id = contact_info.get("id", "")
            if not contact_id:
                continue

            # Always fetch the full contact to get latest data
            full_contact = get_contact(contact_id)
            if full_contact:
                lead_data = parse_webhook_payload(full_contact, field_map=field_map)
            else:
                lead_data = {
                    "ghl_contact_id": contact_id,
                    "service_type": "fence_staining",
                    "address": "",
                    "zip_code": "",
                    "contact_name": contact_info.get("name", ""),
                    "contact_phone": contact_info.get("phone", ""),
                    "contact_email": contact_info.get("email", ""),
                    "form_data": {},
                }

            lead_data["form_data"]["pipeline_stage"] = stage_name

            if contact_id in existing_ids:
                existing = existing_map[contact_id]
                # Skip archived leads entirely — don't update or re-import them
                if existing.get("archived"):
                    continue
                # Refresh contact data + tags + priority for existing leads
                lead_id = existing["id"]
                current_tags = existing["tags"]
                old_form_data = existing["form_data"]
                new_form_data = lead_data["form_data"]

                if stage_name not in current_tags:
                    current_tags = current_tags + [stage_name]

                # Preserve VA-entered fields — GHL sync must never wipe them out.
                # VA fields (linear_feet, zip_code, etc.) are not present in GHL form data.
                merged_form_data = {**new_form_data}
                for field in VA_OWNED_FIELDS:
                    if field in old_form_data:
                        merged_form_data[field] = old_form_data[field]

                # Only overwrite contact fields if VA hasn't manually edited them
                update_fields = {
                    "priority":           priority,
                    "last_synced_at":     now,
                    "tags":               current_tags,
                    "contact_email":      lead_data.get("contact_email", ""),
                    "form_data":          merged_form_data,
                    "ghl_opportunity_id": opp.get("id"),
                }
                if not old_form_data.get("contact_edited"):
                    update_fields["contact_name"]  = lead_data.get("contact_name", "")
                    update_fields["contact_phone"] = lead_data.get("contact_phone", "")
                if not old_form_data.get("address_confirmed"):
                    update_fields["address"] = lead_data.get("address", "")

                db.table("leads").update(update_fields).eq("id", lead_id).execute()

                # Re-run estimator only if GHL-sourced fields changed (not VA fields)
                ghl_fields_changed = any(
                    old_form_data.get(k) != new_form_data.get(k)
                    for k in new_form_data
                    if k not in VA_OWNED_FIELDS
                )
                if ghl_fields_changed:
                    merged_lead_data = {**lead_data, "form_data": merged_form_data, "zip_code": merged_form_data.get("zip_code", lead_data.get("zip_code", ""))}
                    if background_tasks:
                        background_tasks.add_task(recalculate_estimate_for_lead, lead_id, merged_lead_data)
                    else:
                        asyncio.create_task(recalculate_estimate_for_lead(lead_id, merged_lead_data))

                # Move GHL opportunity to Interactive Proposal
                opp_id = opp.get("id")
                if opp_id:
                    target_stage_id = _resolve_ip_stage(
                        stage_name, lead_data.get("address", ""), lead_data.get("zip_code", ""), ip_stage_map,
                    )
                    if target_stage_id:
                        if not update_opportunity_stage(opp_id, target_stage_id):
                            logger.warning(f"Failed to move opp {opp_id} to Interactive Proposal")

                updated += 1
                continue

            # New lead — insert and run estimator
            lead_id = str(uuid.uuid4())
            tags = [stage_name]
            if location_label:
                tags.append(location_label)
            lead_row = {
                "id":                 lead_id,
                "ghl_contact_id":     contact_id,
                "ghl_opportunity_id": opp.get("id"),
                "ghl_location_id":    loc_id,
                "service_type":       lead_data.get("service_type", "fence_staining"),
                "status":             "new",
                "address":            lead_data.get("address", ""),
                "form_data":          lead_data["form_data"],
                "contact_name":       lead_data.get("contact_name", ""),
                "contact_phone":      lead_data.get("contact_phone", ""),
                "contact_email":      lead_data.get("contact_email", ""),
                "priority":           priority,
                "tags":               tags,
                "created_at":         now,
            }
            if default_kanban_column:
                lead_row["kanban_column"] = default_kanban_column

            try:
                db.table("leads").insert(lead_row).execute()
                if not skip_automations:
                    if background_tasks:
                        background_tasks.add_task(process_lead, lead_id, lead_data)
                    else:
                        asyncio.create_task(process_lead(lead_id, lead_data))
                existing_ids.add(contact_id)
                imported += 1
                logger.info(f"Pipeline sync: imported contact {contact_id} from '{stage_name}'" + (f" ({location_label})" if location_label else ""))
                # Move GHL opportunity to Interactive Proposal (skip for non-primary locations)
                if not skip_automations:
                    opp_id = opp.get("id")
                    if opp_id:
                        target_stage_id = _resolve_ip_stage(
                            stage_name, lead_data.get("address", ""), lead_data.get("zip_code", ""), ip_stage_map,
                        )
                        if target_stage_id:
                            if not update_opportunity_stage(opp_id, target_stage_id):
                                logger.warning(f"Failed to move opp {opp_id} to Interactive Proposal")
            except Exception as e:
                logger.error(f"Pipeline sync: failed to import contact {contact_id}: {e}")
                errors += 1

    # Update sync cursor
    db.table("sync_state").update({
        "last_sync_at": now,
        "updated_at": now,
    }).eq("id", "ghl_poll").execute()

    return {
        "status":        "done",
        "pipeline":      pipe_name,
        "location":      location_label or "primary",
        "stages_synced": list(matched_stages.keys()),
        "imported":      imported,
        "updated":       updated,
        "errors":        errors,
    }


@router.post("/api/sync/ghl/pipeline")
async def sync_pipeline_leads(background_tasks: BackgroundTasks):
    """Manually trigger a pipeline sync."""
    return await run_pipeline_sync(background_tasks)


@router.get("/api/sync/status")
async def get_sync_status():
    """Return the last time a pipeline sync completed."""
    db = get_db()
    res = db.table("sync_state").select("last_sync_at").eq("id", "ghl_poll").single().execute()
    last_sync_at = res.data["last_sync_at"] if res.data else None
    return {"last_sync_at": last_sync_at, "status": "ok"}


@router.get("/api/sync/ghl/preview")
async def preview_ghl_contacts():
    settings = get_settings()
    field_map = get_field_map()
    contacts = get_contacts(settings.ghl_location_id, max_contacts=100)

    with_fields = sum(
        1 for c in contacts
        if parse_webhook_payload(c, field_map=field_map)["form_data"]
    )

    return {
        "status":            "ok",
        "total_contacts":    len(contacts),
        "with_form_fields":  with_fields,
        "sample_names": [
            f"{c.get('firstName', '')} {c.get('lastName', '')}".strip()
            for c in contacts[:5]
        ],
    }


@router.get("/api/sync/ghl/fields")
async def discover_ghl_fields():
    """
    Discover custom fields from GHL.
    First tries the /customFields API. If that returns 401 (scope issue),
    falls back to scanning actual contacts to find field IDs and guess names
    from their values.
    """
    settings = get_settings()
    db = get_db()

    # Try the custom fields API first
    fields = get_custom_fields(settings.ghl_location_id)

    if fields:
        # API worked — use field names directly
        results = []
        for f in fields:
            ghl_id = f.get("id", "")
            ghl_key = f.get("fieldKey", f.get("key", ""))
            ghl_name = f.get("name", "")

            auto_map = None
            name_lower = ghl_name.lower().replace(" ", "_").replace("-", "_")
            key_lower = ghl_key.lower()
            for expected_name in EXPECTED_FIELDS:
                if expected_name in name_lower or expected_name in key_lower:
                    auto_map = expected_name
                    break

            row = {
                "ghl_field_id": ghl_id,
                "ghl_field_key": ghl_key,
                "ghl_field_name": ghl_name,
                "our_field_name": auto_map,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            db.table("ghl_field_mapping").upsert(row, on_conflict="ghl_field_id").execute()
            results.append(row)
    else:
        # Fallback: scan contacts to discover field IDs from their values
        contacts = get_contacts(settings.ghl_location_id, max_contacts=50)
        seen_ids: dict[str, list[str]] = {}  # field_id -> sample values

        for contact in contacts:
            for cf in (contact.get("customFields") or []):
                fid = cf.get("id", "")
                val = str(cf.get("value", ""))
                if fid and val:
                    seen_ids.setdefault(fid, [])
                    if val not in seen_ids[fid] and len(seen_ids[fid]) < 5:
                        seen_ids[fid].append(val)

        # Auto-map based on sample values
        VALUE_HINTS = {
            "fence_age": ["1-6 years", "brand new", "6-15 years", "older than"],
            "service_timeline": ["this month", "planning ahead", "as soon", "within 2 weeks", "getting a quote"],
            "fence_height": ["6ft", "6.5ft", "7ft", "8ft", "standard"],
            "previously_stained": ["yes", "no"],
            "additional_services": ["fence repair", "pressure wash", "gate"],
        }

        results = []
        for fid, samples in seen_ids.items():
            auto_map = None
            samples_lower = " ".join(s.lower() for s in samples)

            for our_name, hints in VALUE_HINTS.items():
                if any(hint in samples_lower for hint in hints):
                    auto_map = our_name
                    break

            row = {
                "ghl_field_id": fid,
                "ghl_field_key": fid,
                "ghl_field_name": f"Samples: {', '.join(samples[:3])}",
                "our_field_name": auto_map,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            db.table("ghl_field_mapping").upsert(row, on_conflict="ghl_field_id").execute()
            results.append(row)

    return {
        "status": "ok",
        "total_fields": len(results),
        "fields": results,
        "auto_mapped": sum(1 for r in results if r["our_field_name"]),
    }


@router.put("/api/sync/ghl/fields/{ghl_field_id}")
async def update_field_mapping(ghl_field_id: str, body: dict):
    """Manually set which of our fields a GHL field maps to."""
    db = get_db()
    db.table("ghl_field_mapping").update({
        "our_field_name": body.get("our_field_name"),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("ghl_field_id", ghl_field_id).execute()
    return {"status": "updated"}
