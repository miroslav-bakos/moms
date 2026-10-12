ALTER TABLE orders ADD COLUMN business_outcome text NOT NULL DEFAULT 'active'
  CHECK (business_outcome IN ('active','canceled','refunded','returned'));
ALTER TABLE orders ADD COLUMN business_outcome_locked boolean NOT NULL DEFAULT false;
UPDATE orders SET business_outcome = CASE
  WHEN status ~* '^cancell?ed$' THEN 'canceled'
  WHEN source_payload->>'financial_status' = 'refunded' THEN 'refunded'
  ELSE 'active' END;
CREATE TABLE order_lines (
  id bigserial PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  source_key text NOT NULL,
  sku text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  material_snapshot jsonb,
  UNIQUE(order_id,source_key)
);
CREATE TABLE order_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  request_key uuid NOT NULL UNIQUE,
  tracking_code text NOT NULL DEFAULT '',
  tracking_url text NOT NULL DEFAULT '',
  label_url text NOT NULL DEFAULT '',
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE order_shipment_lines (
  shipment_id uuid NOT NULL REFERENCES order_shipments(id) ON DELETE RESTRICT,
  line_id bigint NOT NULL REFERENCES order_lines(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY(shipment_id,line_id)
);
CREATE TABLE order_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id bigint NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  line_id bigint NOT NULL REFERENCES order_lines(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  kind text NOT NULL CHECK (kind IN ('refund','return')),
  reason text NOT NULL DEFAULT '',
  request_key uuid NOT NULL UNIQUE,
  received_at timestamptz,
  restocked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_shipments_order_idx ON order_shipments(order_id);
CREATE INDEX order_returns_order_idx ON order_returns(order_id);
