-- Performance indexes based on full query audit
-- Addresses missing indexes on frequently queried columns

-- Proposals: analytics queries filter by status + booked_at constantly
CREATE INDEX IF NOT EXISTS idx_proposals_status_booked_at
  ON proposals(status, booked_at DESC)
  WHERE status = 'booked';

-- Proposals: lead_id + status composite (workflow checks, proposal lookups)
CREATE INDEX IF NOT EXISTS idx_proposals_lead_id_status
  ON proposals(lead_id, status);

-- Proposals: funnel stage filtering in analytics
CREATE INDEX IF NOT EXISTS idx_proposals_funnel_stage
  ON proposals(funnel_stage);

-- Leads: archived + created_at composite (main list query — every page load)
CREATE INDEX IF NOT EXISTS idx_leads_archived_created_at
  ON leads(archived, created_at DESC)
  WHERE archived = false;

-- Leads: archived + workflow_stage composite (analytics + workflow queries)
CREATE INDEX IF NOT EXISTS idx_leads_archived_workflow_stage
  ON leads(archived, workflow_stage)
  WHERE archived = false AND workflow_stage IS NOT NULL;

-- Leads: kanban column filtering (Kanban board drag-and-drop)
CREATE INDEX IF NOT EXISTS idx_leads_kanban_column
  ON leads(kanban_column)
  WHERE archived = false;

-- Leads: workflow paused filter (workflow status checks)
CREATE INDEX IF NOT EXISTS idx_leads_workflow_paused
  ON leads(workflow_paused)
  WHERE workflow_paused = true;

-- Estimates: lead_id + status composite (approval flow, sibling queries)
CREATE INDEX IF NOT EXISTS idx_estimates_lead_id_status
  ON estimates(lead_id, status);

-- SMS queue: status + send_at for background worker polling
CREATE INDEX IF NOT EXISTS idx_sms_queue_status_send_at
  ON sms_queue(status, send_at)
  WHERE status = 'pending';

-- SMS queue: ghl_contact_id for dedup checks
CREATE INDEX IF NOT EXISTS idx_sms_queue_ghl_contact_id
  ON sms_queue(ghl_contact_id);
