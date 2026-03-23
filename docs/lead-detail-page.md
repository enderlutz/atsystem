N# Lead Detail Page — Logic Reference

**File:** `frontend/app/(dashboard)/leads/[id]/page.tsx`

---

## Overview

The Lead Detail page is the core VA workspace. It is where the team:
1. Reviews customer contact info
2. Reads the GHL SMS conversation thread
3. Enters fence measurements to generate a price estimate
4. Approves and sends the estimate to the customer

---

## Data Loading

On mount, `api.getLead(id)` is called. The backend returns a `LeadDetail` object that includes:
- All lead fields (`contact_name`, `contact_phone`, `address`, `status`, `priority`, `tags`, etc.)
- `form_data` — the raw GHL form fields plus any VA-entered fields
- `estimate` — the most recent estimate record for this lead (with `inputs`, `breakdown`, `status`)

All editable state (linear feet, fence height, age, zip code, etc.) is initialized from `form_data` on load, so the VA's previous entries are always persisted correctly across page visits and server restarts.

---

## Sections (top to bottom)

### 1. Page Header
- Displays `contact_name` or `address` as the page title (falls back to the short lead ID if both empty)
- Shows the short lead ID and creation date

---

### 2. Contact Info Card
**Fields shown:** Name · Phone (clickable `tel:` link) · Email (clickable `mailto:` link) · Address

**Edit mode:**
- Click **Edit** → all three fields (name, phone, address) switch to `<Input>` components
- **Save** → calls `PUT /api/leads/{id}/contact` on the backend, then updates local state
- **Cancel** → reverts all fields to the last saved values with no API call
- Email is display-only (read from GHL, not editable here)

---

### 3. Lead Information + Property View (2-column grid)

**Lead Information card:**
- Service type, lead status badge, priority, GHL contact ID, pipeline tags

**Property View card:**
- Embeds a Google Maps satellite iframe if `NEXT_PUBLIC_GOOGLE_MAPS_KEY` is set
- Always shows an "Open Maps" button linking to the property address
- The satellite view is the primary tool the VA uses to measure linear feet

---

### 4. Messages Card (GHL SMS Thread)

**Default state:** Not loaded. Shows a prompt describing what to do.

**"Load Messages" button:**
- Calls `GET /api/leads/{id}/messages`
- Backend checks the local `messages` DB table first (webhook-synced). If empty, fetches from GHL API and persists to DB
- Messages render as a chat bubble UI (outbound = right/blue, inbound = left/grey)

**"Check for Response" button:**
- Calls `POST /api/leads/{id}/check-response`
- Backend checks GHL conversations for any inbound messages
- If found: sets `customer_responded = true` on the lead and updates `customer_response_text`
- Also refreshes the full message list after checking

**Customer replied badge:** Appears in the card header if `lead.customer_responded` is true OR if any fetched message has `direction === "inbound"`.

**Error handling:** If the GHL API key is missing the Conversations/Messages scope, a red error banner appears with the 403 message from the backend instead of a silent empty state.

---

### 5. Estimate Inputs Card

This is the VA's data entry form. All fields feed into the pricing estimator on save.

| Field | Type | Notes |
|---|---|---|
| Linear Feet | Number input | Most important field — directly drives price |
| Zip Code | Text input (5 digits) | Determines pricing zone (Base / Blue / Purple / Outside) |
| Measurement Confidence | Dropdown | "Not confident" (< 80%) triggers RED status — requires owner review |
| Fence Height | Dropdown | 6ft / 6.5ft (rot board) / 7ft / 8ft / Not sure |
| Fence Age | Dropdown | Brand new / 1–6yr / 6–15yr / 15+ (15+ forces RED) |
| Previously Stained | Dropdown | Yes / No / Not sure |
| Service Timeline | Dropdown | Maps to HOT / HIGH / MEDIUM / LOW priority |
| Sides of Fence | Checkboxes | Inside/Outside × Front/Left/Back/Right (8 total) |
| Additional Services | Read-only display | Auto-populated from GHL form. Check "Edit" to override manually |

**"Save & Recalculate Estimate" button:**
- Calls `PUT /api/leads/{id}/form-data` with all current field values
- Backend merges the new fields into existing `form_data` (VA-entered fields are never overwritten by the background GHL sync — see `VA_OWNED_FIELDS` in `sync.py`)
- Backend re-runs the estimator and saves a new/updated estimate record
- Returns the full updated `LeadDetail` — the UI refreshes with new tier prices
- Button turns green for 3 seconds after a successful save

---

### 6. Estimate Result Card

Shows the output of the estimator. Only renders if the lead has an estimate record.

**Approval status banner (Green / Yellow / Red):**
- **Green** — "Ready to Send" — all auto-approval criteria met
- **Yellow** — "Add-ons Pending" — criteria met but customer requested additional services; send fence quote now, price add-ons separately
- **Red** — "Owner Review Required" — one or more criteria failed (see below)

**Red criteria (any one triggers RED):**
- VA confidence < 80%
- Zip code is outside the service zone
- Calculated sqft < 500 (job too small for auto-approval)
- Fence age is 15+ years

**Tier price cards (3 columns):**
Shows Essential / Signature / Legacy prices to the cent, plus a monthly price below each (`price ÷ 21`).

**Action area — logic tree:**

```
Is estimate already sent / approved?
  → Yes → Show "Sent to customer" green badge (no further action)
  
Is approval status RED?
  → Yes → Show "View Estimate →" button (links to full estimate detail page for owner review)

Is approval GREEN or YELLOW AND estimate is still pending?
  → Yes (canApproveInline = true):
      Has the customer responded (DB flag OR inbound message detected)?
        → No: Show "Send packages even though there has been no text back" checkbox
              Approve button is DISABLED until checkbox is checked
        → Yes: Approve button is enabled immediately
      Clicking Approve → calls POST /api/estimates/{id}/approve with force_send flag
      On success: lead status updates to "sent", button replaced with green badge

Estimate exists but none of the above?
  → Show "View Estimate" link button
```

**Yellow add-ons tracking:**
When approval is yellow, a secondary control appears below the tier cards:
- **"Mark Add-ons Sent"** — records that the team manually priced and sent add-on services separately
- Once marked, shows "Sent Additional Proposal" badge with an "Undo" option

**Error display:** If the approve API call fails (e.g. backend 403 because no customer reply and `force_send = false`), a red inline error banner appears with the error message.

---

### 7. VA Notes Card

Free-text textarea that syncs to both the local DB and GHL contact notes on save.

- Save button is disabled until the text differs from the last saved value
- Calls `PUT /api/leads/{id}/notes` → backend updates DB, then calls `add_contact_note` on GHL

---

### 8. Estimate History Card

Lazy-loaded — click "Load History" to fetch.

- Calls `GET /api/leads/{id}/estimates` → returns all estimates for the lead, newest first
- The current active estimate is excluded from the history list
- Each row shows: colored approval dot · creation date · owner notes · E/S/L tier prices · status badge · "View" link

---

## State Summary

| State variable | Purpose |
|---|---|
| `lead` | Full lead record from API (source of truth) |
| `contactName / contactPhone / contactAddress` | Editable local copy of contact fields |
| `editingContact / savingContact` | Edit mode toggle + save spinner for Contact Info card |
| `linearFeet, fenceHeight, fenceAge, previouslyStained, timeline, zipCode, confidencePct, fenceSides, additionalServices` | VA estimate input fields |
| `editingAdditionalServices` | Toggles additional services field between read-only and editable |
| `savingEstimate / estimateSaved` | Save button state + 3-second green confirmation |
| `messages / messagesLoaded / loadingMessages / messagesError` | GHL message thread load state |
| `checkingResponse` | "Check for Response" button spinner |
| `customerRespondedFromMessages` | Derived: true if any fetched message has `direction === "inbound"` |
| `forceSend` | Checkbox — bypasses the no-customer-reply guard on the approve button |
| `approvingEstimate / estimateSent / approveError` | Approve button state |
| `additionalServicesSent / markingAddons` | Yellow add-ons tracking state |
| `vaNotes / savingNotes` | VA notes field state |
| `estimateHistory / historyLoaded / loadingHistory` | Estimate history lazy-load state |

---

## Key API Calls

| Action | Method | Endpoint |
|---|---|---|
| Load lead | GET | `/api/leads/{id}` |
| Update contact info | PUT | `/api/leads/{id}/contact` |
| Update estimate inputs | PUT | `/api/leads/{id}/form-data` |
| Load messages | GET | `/api/leads/{id}/messages` |
| Check for customer reply | POST | `/api/leads/{id}/check-response` |
| Approve & send estimate | POST | `/api/estimates/{id}/approve` |
| Save VA notes | PUT | `/api/leads/{id}/notes` |
| Load estimate history | GET | `/api/leads/{id}/estimates` |
| Mark add-ons sent | POST | `/api/estimates/{id}/additional-services-sent` |
| Unmark add-ons sent | DELETE | `/api/estimates/{id}/additional-services-sent` |

---

## Background Sync Safety

A background poller runs every 5 minutes refreshing contact data from GHL. The fields in `VA_OWNED_FIELDS` (`linear_feet`, `zip_code`, `confident_pct`, `fence_sides`) are **never overwritten** by this sync — only GHL-sourced fields (fence height, age, timeline, etc.) can be updated automatically. This ensures VA measurements are permanent until the VA explicitly changes them.
