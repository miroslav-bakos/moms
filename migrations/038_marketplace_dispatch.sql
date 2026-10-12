CREATE TABLE marketplace_dispatches (
 order_id bigint PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
 shipment_id uuid NOT NULL UNIQUE REFERENCES order_shipments(id) ON DELETE RESTRICT,
 channel text NOT NULL CHECK(channel='etsy'),
 shop_id text NOT NULL,
 receipt_id text NOT NULL,
 tracking_code text NOT NULL,
 state text NOT NULL CHECK(state IN ('uncertain','confirmed','rejected')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
