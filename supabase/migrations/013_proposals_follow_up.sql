-- Track when a follow-up SMS was sent for proposals that were viewed but not booked
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS follow_up_sent_at TIMESTAMPTZ;
