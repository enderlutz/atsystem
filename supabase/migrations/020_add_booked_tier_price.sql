-- Store the locked-in tier price at booking time so it's historically accurate
-- and doesn't require joining estimates on every schedule load.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS booked_tier_price NUMERIC;
