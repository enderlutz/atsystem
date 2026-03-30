-- Multi-estimate proposals: allow multiple estimate sections per proposal
-- Each estimate can have a label (e.g. "Outside Fence - Facing The Streets")
-- Proposals can link to multiple estimates and store per-section selections

-- estimates: add label for multi-estimate sections
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS label TEXT;

-- proposals: support multiple estimates and selections
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS estimate_ids JSONB;       -- ["uuid1", "uuid2"]
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS selections JSONB;         -- [{"estimate_id":"uuid1","selected_tier":"signature"}, ...]
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS booked_total_price NUMERIC;
