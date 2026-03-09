# ATSystem — A&T's Fence Restoration Operations Dashboard

## Project Overview

Operations dashboard for A&T's Pressure Washing Fence Restoration Division. Automates lead capture from GoHighLevel (GHL), generates intelligent fence staining estimates, and provides a VA-operated dashboard for estimate review, categorization, and delivery to clients.

**Business Goal:** Deliver estimates to clients faster. Minimize VA manual work by auto-categorizing leads, auto-calculating estimates, and guiding the VA through a streamlined approval flow.

---

## Core Business Flow

```
1. Lead submits form in GHL (Facebook ad → GHL form captures fence info)
      ↓
2. Lead synced to Dashboard (webhook OR background poller every 5 min)
      ↓
3. Auto-categorized by color on Kanban board:
      - GRAY:   No estimate activity yet (new lead, untouched)
      - PURPLE: No address/zip — can't calculate zone, VA must enter zip manually
      - ORANGE: Needs more info — tagged "Needs height", "Age of the Fence", etc.
      - GREEN:  Estimate ready to send (confident, in-zone, 500+ sqft, <15yr, no add-ons)
      - YELLOW: Estimate ready BUT customer requested additional services.
               Main fence staining estimate sends first. Owner manually prices
               add-ons via GHL, then marks "Add-ons Sent" in dashboard.
      - RED:    Manual review required. Triggered by:
               • Lead is outside service zone
               • Fence is under 500 sqft
               • VA confidence score < 80%
               • Fence is 15+ years old
      - SKY BLUE: Follow Up Quote — quote was sent, awaiting follow-up
      ↓
4. VA Opens Lead Detail Page:
      - Reviews customer info from GHL form
      - Inputs: Linear Feet, Fence Sides (8 checkboxes), Confidence %, Zip Code
      - Clicks "Save & Recalculate Estimate" → backend reruns pricing engine
      - Estimate result (tier prices + approval status) shown immediately
      ↓
5. VA Reviews Estimate in Estimates Page:
      - Approve → sends SMS to customer via GHL
      - Adjust → modify price range, then send
      - Reject → with notes
      - Mark Add-ons Sent → for YELLOW estimates
      ↓
6. Data Sync Back to GHL:
      - VA notes and form data synced to GHL contact notes automatically
```

---

## Urgency Categorization

Based on the GHL form question: **"How soon would you like the service to be completed?"**

| Response         | Priority | Kanban Behavior                   |
|------------------|----------|-----------------------------------|
| ASAP / This week | HOT      | Top of queue, immediate attention |
| Within 2 weeks   | HIGH     | Near top of queue                 |
| Within a month   | MEDIUM   | Standard queue position           |
| Just exploring   | LOW      | Bottom of queue                   |

---

## Tech Stack

- **Frontend:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Shadcn UI
- **Backend:** FastAPI (Python 3.9+), Pydantic v2, uvicorn
- **Database:** PostgreSQL via custom db.py query builder (`backend/db.py`) — NOT Supabase client
- **Integrations:** GoHighLevel API v2 (contacts, SMS, pipeline), Twilio (SMS fallback), Resend (Email)
- **Package Manager:** npm (frontend), pip + venv (backend)

---

## Project Structure

```
ATSystem/
├── backend/
│   ├── main.py                  # FastAPI entry, CORS, route registration
│   ├── config.py                # Pydantic Settings (env vars)
│   ├── db.py                    # Custom PostgreSQL query builder (mimics Supabase API)
│   ├── api/
│   │   ├── webhooks.py          # POST /webhook/ghl — receives GHL form submissions
│   │   │                        # recalculate_estimate_for_lead() lives here
│   │   ├── leads.py             # GET /api/leads, GET /api/leads/{id}
│   │   │                        # PUT /api/leads/{id}/form-data ← VA saves measurements
│   │   ├── estimates.py         # CRUD + approve/reject/adjust estimates
│   │   ├── settings.py          # GET/PUT /api/settings/pricing, GET /api/stats
│   │   └── sync.py              # POST /api/sync/ghl — bulk import + pipeline sync
│   ├── models/
│   │   ├── lead.py              # Lead, LeadDetail, ServiceType, LeadStatus
│   │   └── estimate.py          # Estimate, EstimateDetail, BreakdownItem
│   └── services/
│       ├── ghl.py               # GHL API client (contacts, messages, webhook parsing)
│       │                        # parse_webhook_payload() extracts zip from postalCode
│       ├── estimator.py         # Pricing engine — zone/tier/age/size logic
│       │                        # calculate_fence_staining() is the main function
│       ├── poller.py            # Background poller (runs every 5 min)
│       └── notify.py            # SMS + Email notifications to owner
├── frontend/
│   ├── app/
│   │   └── (dashboard)/
│   │       ├── page.tsx         # Dashboard home — 4 KPI cards + pending estimate queue
│   │       ├── leads/
│   │       │   ├── page.tsx     # Kanban board (7 columns, horizontally scrollable)
│   │       │   └── [id]/page.tsx # Lead detail + VA input form + estimate result
│   │       ├── estimates/
│   │       │   ├── page.tsx     # Estimate list with status tabs + "Mark Add-ons Sent"
│   │       │   └── [id]/page.tsx # Estimate detail — approve/reject/adjust
│   │       └── settings/        # Pricing config + GHL sync + field mapping
│   ├── components/
│   │   ├── ui/                  # Shadcn primitives
│   │   └── dashboard/sidebar.tsx
│   └── lib/
│       ├── api.ts               # HTTP client + all TypeScript types
│       └── utils.ts             # Formatting helpers
├── supabase/
│   └── migrations/              # SQL migration files (run manually against PostgreSQL)
└── CLAUDE.md                    # ← You are here (CLAUDE1.md = original version)
```

---

## Key Architecture Decisions

1. **Zone-based pricing** — TX zip codes mapped to Base / Blue / Purple / Outside zones with per-sqft surcharges. Zone lookup is in `estimator.py` constants.
2. **3-tier pricing** — Essential ($0.72–$0.76/sqft), Signature ($0.84–$0.88, default), Legacy ($1.09–$1.13)
3. **VA measurement flow** — `PUT /api/leads/{id}/form-data` merges VA input with existing form_data, then calls `recalculate_estimate_for_lead()` synchronously and returns the updated lead+estimate in one call
4. **Green/Yellow/Red logic** — Fully automated in `estimator.py`. Green = auto-approvable, Yellow = add-ons flagged, Red = manual review required
5. **GHL is bidirectional** — Receives webhooks IN, sends SMS + updates contact notes OUT
6. **Background poller** — `services/poller.py` syncs GHL pipeline every 5 min
7. **No auth currently** — Dashboard assumed behind proxy auth or internal-only access

---

## Pricing Engine Details (`estimator.py`)

```
linear_feet (VA input)
    × fence_height (parsed from form dropdown) = sqft
    × zone_rate (Base/Blue/Purple surcharge)
    + size_surcharge ($0.12/sqft if 500–1,000 sqft)
    = price per sqft, applied across 3 tiers
```

**Approval Logic:**
- GREEN: in-zone + 500≤sqft≤∞ + <15yr + confident_pct≥80 + no add-ons
- YELLOW: GREEN but has additional_services in form
- RED: outside zone OR sqft<500 OR 15+yr OR confident_pct<80 OR sqft=0

**Critical:** `linear_feet` is the ONLY VA-entered value that drives price. Without it, sqft=0 → $0 estimate.

---

## Known Issues / Bugs

1. **Zip code missing for ~13 existing leads** — `parse_webhook_payload()` in `ghl.py` only reads `postalCode` field. If GHL doesn't send it, zip="", zone="Outside", lead goes to "No Address" column. Fix: add regex fallback to extract 5-digit zip from address string.

2. **$0 estimates possible** — No frontend validation prevents saving with linear_feet=0. The estimator returns $0–$0 and approval_status=RED when sqft=0, but it should be caught earlier.

---

## Roadmap

### P0 — Must Have
- [ ] **Customer Proposal Website** — Where customer picks tier (Essential/Signature/Legacy), books appointment date, confirms, selects fence color. Each step tracked for follow-up triggers.

### P1 — Should Have (Within 2 Weeks)
- [ ] **Stage-Based Follow-Up Triggers** — Opened proposal but didn't pick tier → 2hr follow-up; picked tier but didn't book → 4hr follow-up; etc.
- [ ] **Location Support (Cypress vs Woodlands)** — Add `location` field to leads, auto-detect from zip code, filter Kanban by location, KPI breakdown per location
- [ ] **CrewClock Integration** — On job close, POST to Thomas's API endpoint; pull back labor/material costs for true profit tracking

### P2 — Nice to Have
- [ ] **KPI Dashboard Enhancement** — Close rate, ROAS, cost per lead, revenue by location/zone, avg days to close
- [ ] **Google Reviews Automation** — Auto-send review request after job completion
- [ ] **Referral System** — Auto-send referral link, track referrals, apply referral discount

---

## Environment Variables

### Backend (`backend/.env`)
```
DATABASE_URL=postgresql://...
GHL_API_KEY=...
GHL_LOCATION_ID=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=...
RESEND_API_KEY=...
OWNER_PHONE=...
OWNER_EMAIL=...
FRONTEND_URL=http://localhost:3000
```

### Frontend (`frontend/.env.local`)
```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_GOOGLE_MAPS_KEY=...
```

---

## Running Locally

```bash
# Backend (port 8000)
cd backend && source .venv/bin/activate && uvicorn main:app --reload

# Frontend (port 3000)
cd frontend && npm run dev
```

---

## GHL Integration Details

- **API Base:** `https://services.leadconnectorhq.com`
- **API Version:** `2021-07-28`
- **Webhook endpoint:** `POST /webhook/ghl` — configure in GHL workflow
- **Pipeline sync:** Pulls from "FENCE STAINING NEW AUTOMATION FLOW" pipeline
- **Outbound:** `send_message_to_contact()` for SMS, contact notes update via PATCH
- **Bulk import:** `POST /api/sync/ghl` pulls up to 500 existing contacts

---

## Coding Conventions

- **Backend:** Python 3.9+, FastAPI with Pydantic models, async where possible, db.py for all DB queries
- **Frontend:** TypeScript strict, functional React components, Tailwind for styling, Shadcn UI primitives
- **API pattern:** Backend returns JSON, frontend fetches via `lib/api.ts` client
- **File naming:** snake_case (Python), kebab-case (TS/TSX files), PascalCase (React components)
- **No over-engineering:** Keep solutions minimal. Don't add abstractions until they're needed twice.
