ALTER TABLE manufacturing_products ADD COLUMN stock numeric(18,6) NOT NULL DEFAULT 0 CHECK (stock >= 0);
CREATE TABLE finished_product_operations (
 request_key uuid PRIMARY KEY,
 product_id uuid NOT NULL REFERENCES manufacturing_products(id),
 payload jsonb NOT NULL,
 material_snapshot jsonb NOT NULL DEFAULT '[]',
 stock_before numeric(18,6) NOT NULL,
 stock_after numeric(18,6) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE finished_product_movements (
 id bigserial PRIMARY KEY,
 product_id uuid NOT NULL REFERENCES manufacturing_products(id),
 order_id bigint REFERENCES orders(id) ON DELETE SET NULL,
 operation_id uuid REFERENCES finished_product_operations(request_key),
 quantity numeric(18,6) NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX finished_product_movements_product_idx ON finished_product_movements(product_id,id DESC);
ALTER TABLE order_lines ADD COLUMN inventory_snapshot jsonb;
