-- Temporary: approval token for VA estimate approval gate
-- Alan clicks a link with this token to approve estimates without logging in
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS approval_token TEXT;
