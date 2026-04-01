-- Add timestamps for analytics: measure time from SMS sent → proposal opened → booked
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS booking_completed_at TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS deposit_paid_at TIMESTAMPTZ;
