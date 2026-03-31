-- Temporary: approval token for VA estimate approval gate
-- Alan clicks a link with this token to approve estimates without logging in
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS approval_token TEXT;

-- Allow 'pending_approval' status for estimates awaiting admin review
ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_status_check;
ALTER TABLE estimates ADD CONSTRAINT estimates_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'adjusted', 'pending_approval'));
