-- Store the GHL opportunity ID per lead so we can update pipeline stage on booking
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ghl_opportunity_id TEXT;
