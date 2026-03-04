-- 002: Add enrichment columns for GHL data flow

-- Enrich leads with contact info, priority, response tracking, tags
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS contact_name         TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_phone        TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_email        TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS priority             TEXT DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS urgency_level        TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_responded   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_response_text TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS tags                 JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS va_notes             TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_synced_at       TIMESTAMPTZ;

-- Track whether add-on services have been sent
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS additional_services_sent BOOLEAN DEFAULT false;

-- Cache GHL custom field IDs → our field names
CREATE TABLE IF NOT EXISTS ghl_field_mapping (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_field_id   TEXT NOT NULL UNIQUE,
  ghl_field_key  TEXT NOT NULL DEFAULT '',
  ghl_field_name TEXT NOT NULL DEFAULT '',
  our_field_name TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Track polling cursor
CREATE TABLE IF NOT EXISTS sync_state (
  id             TEXT PRIMARY KEY DEFAULT 'ghl_poll',
  last_sync_at   TIMESTAMPTZ NOT NULL DEFAULT '2020-01-01T00:00:00Z',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sync_state (id, last_sync_at) VALUES ('ghl_poll', '2020-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(priority);
CREATE INDEX IF NOT EXISTS idx_leads_customer_responded ON leads(customer_responded);
