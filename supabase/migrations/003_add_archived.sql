-- Add archived flag to leads so old/test leads can be hidden without deleting them
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_leads_archived ON leads (archived);
