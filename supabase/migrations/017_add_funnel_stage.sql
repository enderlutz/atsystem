ALTER TABLE proposals ADD COLUMN IF NOT EXISTS funnel_stage TEXT DEFAULT 'opened';
