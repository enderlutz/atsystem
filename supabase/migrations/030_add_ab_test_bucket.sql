-- A/B test: track which time-window bucket each estimate SMS was assigned to
-- Buckets: morning, midday, afternoon, evening, override (VA chose to send immediately)
ALTER TABLE sms_queue ADD COLUMN IF NOT EXISTS ab_test_bucket TEXT;
