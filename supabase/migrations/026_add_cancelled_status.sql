-- Allow 'cancelled' status for proposals that have been revoked
ALTER TABLE proposals
  DROP CONSTRAINT IF EXISTS proposals_status_check;

ALTER TABLE proposals
  ADD CONSTRAINT proposals_status_check
    CHECK (status IN ('sent', 'viewed', 'booked', 'preview', 'cancelled'));
