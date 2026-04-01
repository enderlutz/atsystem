-- Store synced GHL contacts for the "All Contacts" tab.
-- Persists across page loads; auto-refreshed every 3 days by the poller.
CREATE TABLE IF NOT EXISTS ghl_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_contact_id  TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  location_id     TEXT NOT NULL DEFAULT '',
  location_label  TEXT NOT NULL DEFAULT '',
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_ghl_contacts_imported ON ghl_contacts(imported);
