-- Persistent automation activity log.
-- Tracks stage transitions, SMS sent/cancelled/failed, customer actions, etc.
CREATE TABLE IF NOT EXISTS automation_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id     UUID REFERENCES leads(id) ON DELETE CASCADE,
    event_type  TEXT NOT NULL,
    detail      TEXT,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_autolog_lead ON automation_log(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_autolog_created ON automation_log(created_at DESC);
