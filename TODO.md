# ATSystem — Deferred Features & Future Roadmap

Items tracked here were intentionally deferred during implementation. Pick these up in future sessions.

---

## 🔴 BLOCKING LAUNCH — Fix Before Deploy

- [x] **Add missing Python dependencies** — Added `google-auth` and `google-api-python-client` to `requirements.txt`. DONE.
- [x] **Fix CORS wildcard pattern** — Replaced `"https://*.vercel.app"` with `allow_origin_regex=r"https://.*\.vercel\.app"` in `main.py`. DONE.
- [x] **Add missing `confirmAddress` API method** — Added `api.confirmAddress()` to `api.ts`. DONE.
- [x] **Fix `NameError` in webhook parsing** — Changed `fields.get("zip_code")` to `form_data.get("zip_code")` in `ghl.py`. DONE.
- [x] **Update `.env.example`** — Added all missing vars including `AUTH_SECRET`, `OWNER_GHL_CONTACT_ID`, Google Calendar, Maps, and Stripe keys. DONE.
- [ ] **Stripe webhook handler** — Payment confirmation relies on redirect only. If redirect fails, booking is lost. Add `POST /webhook/stripe` endpoint that listens for `checkout.session.completed` events as a safety net.
- [ ] **Remove Stripe bypass mode** — When `STRIPE_SECRET_KEY` is not set, `create-checkout` skips payment and redirects directly with `session_id=bypass`. This lets the full booking flow run in dev/testing. **Before launch:** set `STRIPE_SECRET_KEY` in production env — the bypass is automatically disabled the moment the key is present.

---

## ⚠️ SHOULD FIX BEFORE LAUNCH

- [x] **Schedule booking count bug** — Added `.eq("status", "booked")` filter to both public and admin schedule endpoints. DONE.
- [ ] **Stripe session not tied to proposal** — `book_proposal` verifies payment but doesn't check the session belongs to this specific token. An attacker with one paid session could book any proposal. Store `proposal_id` in Stripe metadata and verify it.
- [ ] **Settings page loading state** — No loading spinner. User might save default values before API returns, overwriting production pricing. Add loading state.
- [ ] **Update setup.sh** — Only mentions migration 001 in output. There are 10 migrations (001–010). Update the "Next steps" message.
- [ ] **Email validation on proposal page** — Only checks `contactEmail.trim()` is truthy. User can enter "abc" and proceed to payment. Add regex validation.

---

## 🐛 Logic & UX Issues — Critical

- [x] **Dashboard stats always show `0`** — Changed `getStats` to hit `/api/settings/stats` in `api.ts`. DONE.
- [ ] **Fence staining pricing settings are a dead UI** — Settings page lets you edit base rate, age factors, etc. Values get saved to DB but `estimator.py` never reads them — uses hardcoded `TIER_RATES`. All settings changes have zero effect.
- [x] **$0 RED estimates can be approved from Estimate Detail page** — Added RED status block + $0 price guard on the approve button in estimate detail page. DONE.
- [ ] **Step 3 confirmation shows $0 after Stripe redirect** — When customer returns from Stripe, `pkg` local state is null. Confirmation shows: Package "—", Price "$0.00", Remaining Balance "$-50.00". The response has `selected_tier`/`booked_at` but local display variables aren't populated from it.

---

## 🐛 Logic & UX Issues — High Priority

- [ ] **Adjusted estimates don't create proposal pages** — "Approve & Send" gives full branded proposal with booking. "Adjust & Send" only sends plain SMS with dollar range — no proposal page, no booking link. Adjusted estimates = broken funnel.
- [ ] **Dragging lead to "Estimate Sent" creates a lie** — Only sets display column. No estimate approved, no proposal created, no message sent. Other team members believe customer received estimate.
- [ ] **"Sent" badge shown even when GHL delivery fails** — Frontend optimistically shows "Sent to customer" after API success. Backend only sets "sent" if GHL message delivers. If delivery fails, backend stays at "approved" but UI says "sent" until refresh.
- [ ] **Re-saving estimate inputs re-enables "Approve & Send" button** — If VA re-calculates after estimate was sent, `estimateSent` resets to false. Button reappears, clicking creates duplicate proposal + sends second message.
- [x] **"Archive All Leads" has no confirmation dialog** — Added `confirm()` dialog before archiving in `settings/page.tsx`. DONE.

---

## 🐛 Logic & UX Issues — Medium Priority

- [ ] **Address warning banner persists after edit** — Saving new address clears `address_autocompleted` in backend but frontend doesn't update local `form_data` state. Warning shows until page refresh.
- [ ] **Estimate Detail has no "Check for Response" button** — Approve button gated on `customer_responded` but no way to refresh this status. User must navigate to lead detail, click there, then come back.
- [ ] **Sidebar doesn't highlight on detail pages** — Uses exact path match. Viewing `/leads/abc123` doesn't highlight "Leads". No nav item active on any detail page. Fix: check `pathname.startsWith(href + "/")`.
- [ ] **Dragging "sent" leads snaps back visually** — Card moves, API succeeds (kanban_column saved), but `getKanbanStatus` checks `lead.status` first — "sent" overrides column. Card snaps back on render.
- [ ] **Past dates can be added to Schedule** — No frontend or backend validation. Admins can configure availability for dates that already passed.
- [ ] **Confidence percentage silently degrades** — Stored 85% → displayed as "80%" → saved back as 80%. Values change: 85→80, 95→100, 75→80.
- [ ] **Monthly payment `/21` is hardcoded magic number** — In 4+ places. No explanation. If financing terms change, every file needs manual update.
- [ ] **Estimates page shows archived leads** — After "Archive All", leads page is empty but estimates page still shows all estimates with their lead data.
- [ ] **ProposalData.status type doesn't include "preview"** — Backend returns `"preview"` for preview tokens but TypeScript type is `"sent" | "viewed" | "booked"`.

---

## 🐛 Logic & UX Issues — Low Priority

- [ ] **Last sync shows date only** — "Last synced Mar 11, 2026" provides no recency info. Should show time or "X minutes ago".
- [ ] **Quick approve has no error feedback** — Button just stops spinning on failure. No toast/error message.
- [ ] **Schedule delete has no server-side booking check** — Frontend disables delete if `booked_count > 0` but API deletes unconditionally.
- [ ] **Preview modal has no Escape key handler or focus trap** — Accessibility gap.
- [ ] **Revenue stat labeled "Low estimate"** — Actually shows Signature tier exact price, not a conservative number. Misleading label.

---

## Deployment

- [ ] **Deploy backend** — Choose a host (Railway, Render, or Fly.io). Backend needs PostgreSQL (DATABASE_URL), Python 3.9+, and all env vars set.
- [ ] **Deploy frontend** — Push to Vercel (easiest for Next.js). Set `NEXT_PUBLIC_API_URL` to the deployed backend URL.
- [ ] **Add subdomain** — Point `proposal.atpressurewash.com` DNS A record (or CNAME) to the deployed frontend. No code change needed — same app handles it.
- [ ] **Create Dockerfile / docker-compose.yml** — No deployment config exists yet. Add one for reproducible builds and easy local dev without virtualenv setup.
- [ ] **Create Procfile or nixpacks.toml** — Needed if deploying backend to Railway/Render. Backend start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`.
- [ ] **Update CORS for production** — `backend/main.py` has hardcoded CORS origins. Should move to an env var `ALLOWED_ORIGINS` once domain is confirmed.
- [ ] **Set all production env vars** — See list below.

### Production Env Vars Checklist

**Backend (`backend/.env` → production secrets)**
- [ ] `DATABASE_URL` — Production PostgreSQL connection string
- [ ] `GHL_API_KEY` — GoHighLevel API key
- [ ] `GHL_LOCATION_ID` — GHL location ID
- [ ] `OWNER_GHL_CONTACT_ID` — Alan's GHL contact ID (for booking notifications)
- [ ] `RESEND_API_KEY` — Email provider
- [ ] `OWNER_EMAIL` — Alan's email
- [ ] `PROPOSAL_BASE_URL` — Set to `https://proposal.atpressurewash.com` (or Vercel URL)
- [ ] `GOOGLE_CALENDAR_CREDENTIALS_JSON` — Full service account JSON string
- [ ] `GOOGLE_CALENDAR_ID` — Calendar ID (or "primary")
- [ ] `GOOGLE_MAPS_API_KEY` — Google Maps Embed API key
- [ ] `STRIPE_SECRET_KEY` — Stripe secret key for $50 deposit checkout

**Frontend (`frontend/.env.local` → Vercel env vars)**
- [ ] `NEXT_PUBLIC_API_URL` — Set to deployed backend URL
- [ ] `NEXT_PUBLIC_GOOGLE_MAPS_KEY` — Google Maps key for satellite view

### Google Calendar Setup
- [ ] Create a Google Cloud project, enable Calendar API, create a Service Account
- [ ] Download service account JSON key → paste entire contents as `GOOGLE_CALENDAR_CREDENTIALS_JSON` env var
- [ ] Share Alan's Google Calendar with the service account email (give "Make changes to events" permission)
- [ ] Set `GOOGLE_CALENDAR_ID` to the calendar's ID (found in Calendar Settings)

---

## Proposal Website — Deferred

- [ ] **GHL pipeline stage update on booking** — When customer books, move their GHL opportunity to a "Booked" pipeline stage via `POST /opportunities/{id}` (update stage_id)
- [ ] **Real fence color photos** — Replace CSS hex swatches with actual fence photos (uploaded to CDN). One photo per color + before/after photos in Trust Card 1 expanded section.
- [ ] **Cleaning process video** — Add YouTube embed or hosted video in Trust Card 1 expanded section.
- [ ] **Real scarcity badge count** — Pull actual available slot count for current month from schedule_slots API instead of hardcoded text.
- [ ] **"Homeowner booked recently" badge** — Pull actual last booking timestamp from proposals table instead of hardcoded text.
- [ ] **Stage-based follow-up triggers:**
  - Customer viewed proposal but didn't select tier → 2hr follow-up GHL SMS
  - Customer selected tier but didn't book → 4hr follow-up GHL SMS
  - Implement via a cron job checking `proposals` rows by `status` + `updated_at`
- [ ] **Admin-configurable color list** — Currently hardcoded in the frontend. Build a color management API + dashboard UI so Alan can add/remove/rename colors.
- [ ] **Spec files to incorporate** — Client has additional spec documents:
  - `AT_Proposal_Website_Spec.md` — Complete written spec with all rules, pipelines, DB schemas
  - `AT_Complete_Pricing_Guide.md` — Pricing formulas, tier rates, zone surcharges
  - `AT_Zone_Map_Developer_Guide.md` — 85 zip codes for zone detection
  - `AT_HOA_Handling_Strategy.md` — HOA flow, pre-written letter, follow-up automation
  - `AT_Marketing_Psychology_Playbook.md` — 9 design principles behind every decision
  - `AT_AI_Sales_Agent_Knowledge_Base.md` — Customer communication guide

---

## Dashboard — Deferred

- [ ] **Location support (Cypress vs Woodlands)** — Add `location` field to leads, auto-detect from zip code, filter Kanban by location, KPI breakdown per location
- [ ] **KPI Dashboard Enhancement** — Close rate, ROAS, cost per lead, revenue by location/zone, avg days to close
- [ ] **CrewClock Integration** — On job close, POST to Thomas's API; pull back labor/material costs for profit tracking
- [ ] **Google Reviews automation** — Auto-send review request after job completion
- [ ] **Referral system** — Auto-send referral link, track referrals, apply referral discount
- [x] **Add authentication** — JWT-based auth with 3 users (Alan/Thomas admin, VA). Login page, role-based access, sidebar user info + logout. DONE.
- [ ] **GHL webhook signature validation** — Validate `x-ghl-signature` header on `POST /webhook/ghl` to prevent spoofed payloads.

---

## Integrations Setup

- [ ] **Verify `atpressurewash.com` in Resend for customer confirmation emails** — Customer booking confirmation emails won't deliver until this domain is verified. The code fails gracefully (booking still succeeds, error logged) but no email is sent to the customer.
  1. Go to [resend.com](https://resend.com) → Sign in → **Domains** → **Add Domain**
  2. Enter `atpressurewash.com` and click Add
  3. Resend will give you DNS records to add (SPF TXT record, DKIM TXT record, DMARC TXT record)
  4. Add those DNS records via your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.)
  5. Click **Verify DNS Records** in Resend — can take up to 48hrs to propagate
  6. Once verified, `noreply@atpressurewash.com` will work as a from address
  - Until verified: customer confirmation emails silently fail → bookings still succeed

---

## Known Issues

- [ ] **$0 estimates** — No frontend validation prevents saving with `linear_feet=0`. Add a check before calling Save & Recalculate.
- [ ] **Zip code extraction** — ~13 existing leads have no zip. The regex fallback in `parse_webhook_payload()` helps for new leads but old ones still show "Outside" zone. Could batch-fix by re-parsing their stored `raw_payload`.
- [ ] **Backup date feature is UI-only** — Proposal page lets user select a backup date, but it's never sent to API or stored. Either remove UI or wire it through.
- [ ] **Pressure washing estimator is a stub** — `calculate_pressure_washing()` has no zone surcharges, no real tier logic, no confidence scoring. If a pressure washing lead comes in, estimate will be meaningless.
- [ ] **Silent error handling on dashboard** — Most actions (save notes, drag-drop, sync, schedule save/delete) use `console.error` with no user-facing toast. Only estimate approve/reject and settings show proper feedback.
- [ ] **Sidebar doesn't collapse on mobile** — Fixed 256px width, no hamburger menu. On phones it takes ~40% of screen width.
- [ ] **GHL poller has no backoff** — If GHL rate-limits, poller hammers API every 5 minutes with same failing request. Add exponential backoff.
- [ ] **Missing DB indexes** — `proposals.status` and `proposals.booked_at` have no index. Schedule API does full table scan. Fine now, will matter at scale.
- [ ] **Unused npm dependencies** — `@supabase/ssr`, `@supabase/supabase-js`, and multiple `@radix-ui/*` packages are installed but never imported. Remove from package.json.
- [ ] **Unused Python models** — `Lead`, `LeadDetail`, `Estimate`, `EstimateDetail` in `models/` are defined but never used. All endpoints return raw DB dicts.
- [ ] **Dead `notification_log` table** — Created in migration 001, never written to by any code. Either implement audit logging or drop the table.
- [ ] **`psycopg2-binary` in production** — Authors warn against production use. Replace with `psycopg2` (requires libpq-dev) or migrate to `psycopg[binary]` v3.
- [ ] **No version pinning on Python deps** — All use `>=` with no upper bound. Add lockfile or use `>=X.Y,<(X+1)` syntax to prevent breaking changes.
- [ ] **FastAPI startup event deprecated** — `@app.on_event("startup")` is deprecated. Migrate to lifespan context manager.
