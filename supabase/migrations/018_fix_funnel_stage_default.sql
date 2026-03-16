-- Change default so new proposals start at 'sent', not 'opened'
ALTER TABLE proposals ALTER COLUMN funnel_stage SET DEFAULT 'sent';

-- Reset any existing 'opened' proposals back to 'sent'
-- (safe to do since funnel tracking just launched and no real visits recorded yet)
UPDATE proposals SET funnel_stage = 'sent' WHERE funnel_stage = 'opened';
