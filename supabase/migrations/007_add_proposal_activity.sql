-- Track customer activity on proposal page
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_active_at timestamptz;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS left_page_at timestamptz;
