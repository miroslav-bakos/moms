ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_status text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
