ALTER TABLE orders ADD COLUMN IF NOT EXISTS address_locked boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS skus_locked boolean NOT NULL DEFAULT false;
