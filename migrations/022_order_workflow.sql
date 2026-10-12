ALTER TABLE orders ADD COLUMN workflow_status text NOT NULL DEFAULT 'new'
  CHECK (workflow_status IN ('new', 'in_progress', 'crafted', 'ready_for_pickup', 'shipped'));

-- Seed existing orders; board status is independent of the archive/shipped flag.
UPDATE orders SET workflow_status = CASE
  WHEN shipped THEN 'shipped'
  WHEN packed THEN 'ready_for_pickup'
  WHEN processed THEN 'crafted'
  ELSE 'new' END;
