# ATSystem — A&T's Fence Restoration Operations Dashboard

## Project Overview

Operations dashboard for A&T's Pressure Washing Fence Restoration Division. Automates lead capture from GoHighLevel (GHL), generates intelligent fence staining estimates, and provides a VA-operated dashboard for estimate review, categorization, and delivery to clients.

**Business Goal:** Deliver estimates to clients faster. The system should minimize manual work by auto-categorizing leads, auto-calculating estimates, and guiding the VA through a streamlined approval flow.

---

## Core Business Flow

```
1. Lead submits form in GHL (most info needed for estimate is already captured)
      ↓
2. Lead appears in Dashboard (Estimate Queue + Kanban Board)
      ↓
3. Auto-categorized by color/urgency:
      - GRAY:  No estimate activity yet (new lead, untouched)
      - GREEN: Estimate ready to send (confident, in-zone, 500+ sqft, <15yr, no add-ons)
      - YELLOW: Estimate ready BUT customer requested additional services.
               Main fence staining estimate sends first. Owner manually prices
               add-ons via GHL, then checkmarks that add-ons were also sent.
               (Only applies if "additional services" was filled on the form)
      - RED:   Manual review required. Triggered by:
               • Lead is outside service zone
               • Fence is under 500 sqft
               • VA is not confident in the estimate
               • Fence is 15+ years old
               → Also supports a TAGS system to flag "needs more info from customer"
      ↓
4. Smart Adapt — Response Detection & Guardrail:
      - System watches for customer response to initial outreach text
      - Tag: "estimate needed" applied when customer responds
      - VA may ONLY send estimate AFTER customer has responded
      - Customer's reply is captured and shown in dashboard notes
      ↓
5. VA Inputs Estimate Data:
      - Customer name
      - Sides of fence needing work
      - Package/tier pricing selection
      ↓
6. Data Sync Back to GHL:
      - All info inputted in the dashboard gets written to the
        customer's GHL contact notes automatically
```

---

## Urgency Categorization

Based on the form question: **"How soon would you like the service to be completed?"**

| Response         | Priority   | Behavior                              |
|------------------|------------|---------------------------------------|
| ASAP / This week | Urgent     | Top of queue, immediate attention     |
| Within 2 weeks   | High       | Near top of queue                     |
| Within a month   | Normal     | Standard queue position               |
| Just exploring   | Low        | Bottom of queue, no rush              |

---

## Tech Stack

- **Frontend:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Radix UI / Shadcn
- **Backend:** FastAPI (Python 3.9), Pydantic v2, uvicorn
- **Database:** Supabase (PostgreSQL) — tables: leads, estimates, pricing_config, notification_log
- **Integrations:** GoHighLevel API v2, Twilio (SMS), Resend (Email)
- **Package Manager:** npm (frontend), pip (backend)

---

## Project Structure

```
ATSystem/
├── backend/
│   ├── main.py                  # FastAPI app entry, CORS, route registration
│   ├── config.py                # Pydantic Settings (env vars)
│   ├── api/
│   │   ├── webhooks.py          # POST /webhook/ghl — receives GHL form submissions
│   │   ├── leads.py             # GET /api/leads, GET /api/leads/{id}
│   │   ├── estimates.py         # CRUD + approve/reject/adjust estimates
│   │   ├── settings.py          # GET/PUT /api/settings/pricing, GET /api/stats
│   │   └── sync.py              # POST /api/sync/ghl — bulk import GHL contacts
│   ├── models/
│   │   ├── lead.py              # Lead, LeadDetail, ServiceType, LeadStatus
│   │   └── estimate.py          # Estimate, EstimateDetail, BreakdownItem
│   └── services/
│       ├── ghl.py               # GHL API client (contacts, messages, webhook parsing)
│       ├── estimator.py         # Pricing engine (zone, tier, age, size logic)
│       └── notify.py            # SMS + Email notifications to owner
├── frontend/
│   ├── app/
│   │   ├── layout.tsx           # Root layout (fonts, metadata)
│   │   ├── globals.css          # Tailwind + theme variables
│   │   └── (dashboard)/
│   │       ├── layout.tsx       # Sidebar layout wrapper
│   │       ├── page.tsx         # Dashboard home (KPIs + pending queue)
│   │       ├── leads/           # Lead list + detail pages
│   │       ├── estimates/       # Estimate list + detail (approve/reject/adjust)
│   │       └── settings/        # Pricing config + GHL sync
│   ├── components/
│   │   ├── ui/                  # Shadcn primitives (card, badge, button, input, textarea)
│   │   └── dashboard/
│   │       └── sidebar.tsx      # Navigation sidebar
│   └── lib/
│       ├── api.ts               # HTTP client + TypeScript types
│       └── utils.ts             # Formatting helpers
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # leads, estimates, pricing_config, notification_log
├── setup.sh                     # One-shot environment setup script
└── CLAUDE.md                    # ← You are here
```

---

## Key Architecture Decisions

1. **Zone-based pricing** — TX zip codes mapped to Base / Blue / Purple / Outside zones with per-sqft surcharges
2. **3-tier pricing** — Essential (budget), Signature (recommended, default), Legacy (premium)
3. **Green/Yellow/Red approval logic** — Automates what can be sent vs. what needs review
4. **GHL is bidirectional** — Receives webhooks IN, sends messages + updates notes OUT
5. **Background estimate calculation** — Runs async after webhook to prevent timeout
6. **No auth currently** — Dashboard assumed behind proxy auth or internal-only access
7. **VA guardrail** — Estimates should only be sent after customer responds to initial text

---

## Environment Variables

### Backend (`backend/.env`)
```
SUPABASE_URL, SUPABASE_SERVICE_KEY
GHL_API_KEY, GHL_LOCATION_ID
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
RESEND_API_KEY
OWNER_PHONE, OWNER_EMAIL
FRONTEND_URL
```

### Frontend (`frontend/.env.local`)
```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_GOOGLE_MAPS_KEY
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
- **Outbound:** `send_message_to_contact()` for SMS, contact notes update for syncing dashboard data back
- **Sync:** `POST /api/sync/ghl` pulls up to 500 existing contacts for initial import

---

## What Needs To Be Built / Fixed

### High Priority — GHL Data Flow
- [ ] **GHL webhook is not receiving data** — Verify webhook URL is configured in GHL, check API key auth, test with curl
- [ ] **Write dashboard data back to GHL contact notes** — When VA inputs estimate info, POST to GHL contact notes API
- [ ] **Detect customer text responses** — Listen for inbound message events from GHL, update lead status + dashboard notes
- [ ] **"Estimate needed" tag system** — Auto-apply tag when customer responds to initial text; VA blocked from sending estimate until tag is present

### Dashboard Enhancements
- [ ] **Kanban board view** — Drag-and-drop columns: Gray → Green → Yellow → Red (or by urgency)
- [ ] **Estimate queue list** — Sortable by urgency, filterable by category color
- [ ] **VA input form** — Fields: customer name, fence sides needing work, package/tier pricing
- [ ] **Additional services checkbox** — Owner marks when add-on services have been sent via GHL
- [ ] **Urgency categorization** — Parse "how soon" form field → assign priority level → sort queue
- [ ] **Customer response notes** — Display inbound customer messages in lead detail view
- [ ] **"Needs more info" tag** — Flag leads where form data is incomplete, prompt VA to follow up

### Data Model Updates
- [ ] Add `priority` / `urgency_level` column to leads table
- [ ] Add `customer_responded` boolean to leads table
- [ ] Add `additional_services_sent` boolean to estimates table
- [ ] Add `tags` JSONB column to leads table (for "estimate needed", "needs more info", etc.)
- [ ] Add `va_notes` / `customer_response_text` to leads table

---

## Coding Conventions

- **Backend:** Python 3.9+, FastAPI with Pydantic models, async where possible, Supabase client for DB
- **Frontend:** TypeScript strict, functional React components, Tailwind for styling, Shadcn UI primitives
- **API pattern:** Backend returns JSON, frontend fetches via `lib/api.ts` client
- **File naming:** snake_case (Python), kebab-case (TS/TSX files), PascalCase (React components)
- **No over-engineering:** Keep solutions minimal. Don't add abstractions until they're needed twice.
