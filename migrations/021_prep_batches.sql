CREATE TABLE IF NOT EXISTS prep_batches (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS prep_batch_orders (
  batch_id bigint NOT NULL REFERENCES prep_batches(id) ON DELETE CASCADE,
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, order_id)
);

CREATE INDEX IF NOT EXISTS prep_batch_orders_batch_position_idx
  ON prep_batch_orders(batch_id, position);
