-- Store what the addon was and how much was charged when VA marks it as sent
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS addon_description text,
  ADD COLUMN IF NOT EXISTS addon_price numeric(10,2);
