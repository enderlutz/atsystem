-- 019: SMS Workflow Automation Engine
-- Adds sms_queue for scheduled messages, workflow_config for editable settings,
-- referrals table, and workflow tracking columns on leads.

-- Scheduled outbound SMS messages. Background worker polls every 60s.
CREATE TABLE IF NOT EXISTS sms_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    stage           TEXT NOT NULL,
    sequence_index  INT NOT NULL DEFAULT 0,
    message_body    TEXT NOT NULL,
    send_at         TIMESTAMPTZ NOT NULL,
    sent_at         TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    cancel_reason   TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
    ghl_contact_id  TEXT NOT NULL,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_queue_pending ON sms_queue(send_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_sms_queue_lead_stage ON sms_queue(lead_id, stage) WHERE status = 'pending';

-- Editable key-value config for workflow (incentive text, review link, etc.)
CREATE TABLE IF NOT EXISTS workflow_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO workflow_config (key, value) VALUES
    ('cold_lead_incentive', '[INCENTIVE PLACEHOLDER - update this field when promo is decided]'),
    ('google_review_link', ''),
    ('referral_bonus', 'a discount on their service and so do you')
ON CONFLICT (key) DO NOTHING;

-- Referral tracking
CREATE TABLE IF NOT EXISTS referrals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    referred_lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    status           TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'lost')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_lead_id);

-- Workflow tracking on leads
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS workflow_stage TEXT,
    ADD COLUMN IF NOT EXISTS workflow_stage_entered_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS workflow_paused BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES leads(id),
    ADD COLUMN IF NOT EXISTS job_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_workflow_stage ON leads(workflow_stage);
