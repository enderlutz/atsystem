# ATSystem — Deployment Phases

Master prompt for deployment. Work through phases in order.
When a task is done, check the box `[x]` in this file and in TODO.md.

---

## Phase 0 — Code Fixes (No API Keys Required) — DO THIS NOW

These are all pure code changes. No credentials needed. Run locally to verify before deploying.

### Blocking Bugs (must fix before launch)

- [x] **Auth system** — JWT login, 3 users (Alan/Thomas/VA), role-based access — DONE
- [x] **Fix `NameError` in webhook** — Changed `fields.get("zip_code")` to `form_data.get("zip_code")` in `ghl.py` — DONE
- [x] **Fix `confirmAddress` API method** — Added `api.confirmAddress()` to `api.ts` — DONE
- [x] **Fix CORS wildcard** — Replaced with `allow_origin_regex` in `main.py`; also migrated to lifespan context manager — DONE
- [x] **Add Google Calendar Python deps** — Added `google-auth` and `google-api-python-client` to `requirements.txt` — DONE
- [x] **Fix dashboard stats URL** — Changed `getStats` to `/api/settings/stats` in `api.ts` — DONE

### Critical UX Fixes

- [x] **$0 RED estimates approvable on detail page** — Added RED block + $0 guard on approve button in `estimates/[id]/page.tsx` — DONE
- [x] **Archive All confirmation dialog** — Added `confirm()` before archiving in `settings/page.tsx` — DONE
- [ ] **Step 3 shows $0 after Stripe redirect** — Code appears to already handle this via `setProposal` functional update; monitor in production to confirm

### Deployment Config Files (no credentials needed)

- [x] **Create `backend/Procfile`** — Created with `web: uvicorn main:app --host 0.0.0.0 --port $PORT` — DONE
- [ ] **Create `backend/nixpacks.toml`** (for Railway/Render) — sets Python version and start command
- [x] **Update `backend/.env.example`** — Added all missing vars including `AUTH_SECRET` — DONE
- [ ] **Fix CORS to use env var** — Currently hardcoded; acceptable for now, update once domain confirmed
- [ ] **Update `setup.sh`** — reference all migrations 001–012 in output message

---

## Phase 1 — Deployment Meeting (Bring API Keys) — TOMORROW

Work through this checklist during/after the client meeting.

### Credentials to Collect from Client

- [ ] `DATABASE_URL` — Production PostgreSQL connection string (or create on Railway/Render)
- [ ] `GHL_API_KEY` — GoHighLevel API key
- [ ] `GHL_LOCATION_ID` — GHL location ID
- [ ] `OWNER_GHL_CONTACT_ID` — Alan's GHL contact ID
- [ ] `RESEND_API_KEY` — Resend.com API key
- [ ] `OWNER_EMAIL` — Alan's email address
- [ ] `STRIPE_SECRET_KEY` — Stripe secret key (from Stripe dashboard)
- [ ] `GOOGLE_CALENDAR_CREDENTIALS_JSON` — Google service account JSON (see setup below)
- [ ] `AUTH_SECRET` — Generate a random 32+ char string (use `openssl rand -hex 32`)

### Choose Hosting Providers

- [ ] **Backend host** — Recommended: Railway (supports Python, auto PostgreSQL, easy deploys)
  - Alternative: Render (free tier, slower cold starts) or Fly.io
- [ ] **Frontend host** — Vercel (push to GitHub → auto deploy)
- [ ] **Database** — Railway PostgreSQL add-on (easiest) or Supabase (already in stack)

### Deploy Steps

1. [ ] **Push code to GitHub** (if not already)
2. [ ] **Deploy frontend to Vercel**
   - Connect GitHub repo → Vercel imports automatically
   - Set env vars: `NEXT_PUBLIC_API_URL=<backend-url>`, `NEXT_PUBLIC_GOOGLE_MAPS_KEY=<key>`
3. [ ] **Deploy backend to Railway**
   - Create new project → "Deploy from GitHub" → select backend folder
   - Add PostgreSQL plugin to Railway project
   - Set all backend env vars (see checklist above)
4. [ ] **Run migrations**
   - From Railway shell or locally with production `DATABASE_URL`:
   ```bash
   psql $DATABASE_URL -f supabase/migrations/001_initial_schema.sql
   psql $DATABASE_URL -f supabase/migrations/002_ghl_enrichment.sql
   psql $DATABASE_URL -f supabase/migrations/003_add_archived.sql
   psql $DATABASE_URL -f supabase/migrations/004_add_kanban_column.sql
   psql $DATABASE_URL -f supabase/migrations/005_add_messages_table.sql
   psql $DATABASE_URL -f supabase/migrations/006_add_proposals_table.sql
   psql $DATABASE_URL -f supabase/migrations/012_add_users_table.sql
   ```
5. [ ] **Seed users**
   ```bash
   cd backend
   python scripts/create_user.py --username alan --password "CHOOSE" --role admin --name "Alan"
   python scripts/create_user.py --username thomas --password "CHOOSE" --role admin --name "Thomas"
   python scripts/create_user.py --username va --password "CHOOSE" --role va --name "VA"
   ```
6. [ ] **Set production domain**
   - Update `PROPOSAL_BASE_URL` to Vercel URL (e.g. `https://at-system.vercel.app`)
   - Or point `proposal.atpressurewash.com` CNAME → Vercel URL

### Google Calendar Setup (do this with client)

- [ ] Go to [console.cloud.google.com](https://console.cloud.google.com) → Create project → Enable Google Calendar API
- [ ] Create Service Account → Download JSON key
- [ ] Paste entire JSON as `GOOGLE_CALENDAR_CREDENTIALS_JSON` env var (single line, escaped)
- [ ] In Alan's Google Calendar → Settings → Share with service account email → "Make changes to events"
- [ ] Set `GOOGLE_CALENDAR_ID` = calendar ID from Calendar Settings → "Integrate calendar"

### GHL Webhook Setup

- [ ] In GHL → Settings → Webhooks → Add new webhook
  - URL: `https://<backend-url>/webhook/ghl`
  - Events: Contact Created, Contact Updated, Inbound Message
- [ ] For messages webhook: URL `https://<backend-url>/webhook/ghl/message`

---

## Phase 2 — Post-Deployment Verification

Test each flow end-to-end in production.

- [ ] Login as `alan` → full access confirmed
- [ ] Login as `va` → Schedule visible (read-only), Archive All hidden
- [ ] Create a test lead via GHL → appears in dashboard within 5 minutes (poller)
- [ ] Fill estimate inputs → Save & Recalculate → green column
- [ ] Approve & Send → proposal link sent via SMS
- [ ] Open proposal link as customer → select tier → pick date → confirm → booking confirmed
- [ ] Check Google Calendar → event appears
- [ ] Check Alan gets GHL notification SMS

---

## Phase 3 — Priority Fixes (First Week Post-Launch)

These are the most impactful improvements after the system is live.

- [ ] **Adjust & Send creates proposal page** — Currently broken funnel. VA uses Adjust & Send but no proposal is created.
- [ ] **Settings pricing actually affects estimator** — Currently settings values are saved but `estimator.py` uses hardcoded rates. Wire DB pricing into estimator.
- [ ] **Stripe session tied to proposal** — Security fix: verify `proposal_id` in Stripe metadata before confirming booking.
- [ ] **Stage-based follow-up SMS** — Cron job: 2hr follow-up if customer viewed but didn't pick tier; 4hr if picked tier but didn't book.
- [ ] **GHL pipeline stage update on booking** — Move opportunity to "Booked" stage when customer books.
- [ ] **Resend domain verification** — Verify `atpressurewash.com` in Resend for customer confirmation emails.

---

## Phase 4 — Growth Features (Future)

Only tackle after Phase 3 is stable.

- [ ] Real fence color photos on proposal page
- [ ] Location support (Cypress vs Woodlands)
- [ ] KPI Dashboard Enhancement (close rate, ROAS, cost per lead)
- [ ] Admin-configurable color list
- [ ] CrewClock Integration
- [ ] Google Reviews automation
- [ ] Referral system
- [ ] Real scarcity badge count (live from schedule API)
- [ ] GHL webhook signature validation

---

## Quick Reference — Env Vars Needed at Launch

| Var | Where | Have it? |
|-----|-------|---------|
| `DATABASE_URL` | Backend | ☐ |
| `AUTH_SECRET` | Backend | ☐ Generate: `openssl rand -hex 32` |
| `GHL_API_KEY` | Backend | ☐ |
| `GHL_LOCATION_ID` | Backend | ☐ |
| `OWNER_GHL_CONTACT_ID` | Backend | ☐ |
| `RESEND_API_KEY` | Backend | ☐ |
| `OWNER_EMAIL` | Backend | ☐ |
| `PROPOSAL_BASE_URL` | Backend | ☐ Set after deploy |
| `GOOGLE_CALENDAR_CREDENTIALS_JSON` | Backend | ☐ |
| `GOOGLE_CALENDAR_ID` | Backend | ☐ |
| `GOOGLE_MAPS_API_KEY` | Backend | ☐ |
| `STRIPE_SECRET_KEY` | Backend | ☐ |
| `NEXT_PUBLIC_API_URL` | Frontend | ☐ Set after deploy |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Frontend | ☐ |
