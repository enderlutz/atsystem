-- Add GHL location tracking to leads for multi-location support
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ghl_location_id TEXT;
