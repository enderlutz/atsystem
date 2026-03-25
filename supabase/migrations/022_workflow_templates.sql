-- Stores user overrides for workflow SMS templates.
-- If no rows exist for a stage, hardcoded defaults in templates.py are used.
CREATE TABLE IF NOT EXISTS workflow_templates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stage          TEXT NOT NULL,
    sequence_index INT NOT NULL DEFAULT 0,
    branch         TEXT DEFAULT NULL,
    delay_seconds  INT NOT NULL,
    message_body   TEXT NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (stage, sequence_index, branch)
);

CREATE INDEX IF NOT EXISTS idx_wt_stage ON workflow_templates(stage);
