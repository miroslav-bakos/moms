CREATE TABLE inventory_config_lock (id boolean PRIMARY KEY DEFAULT true CHECK (id));
INSERT INTO inventory_config_lock VALUES (true);
CREATE TABLE inventory_materials (
 id uuid PRIMARY KEY, name text NOT NULL, unit text NOT NULL,
 stock numeric(18,6) NOT NULL DEFAULT 0
);
CREATE TABLE manufacturing_products (id uuid PRIMARY KEY, name text NOT NULL, recipe jsonb NOT NULL DEFAULT '[]');
CREATE TABLE manufacturing_skus (id uuid PRIMARY KEY, sku text NOT NULL, components jsonb NOT NULL);
CREATE UNIQUE INDEX manufacturing_skus_sku_idx ON manufacturing_skus (upper(btrim(sku)));
CREATE TABLE order_inventory (
 order_id bigint PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
 consumed boolean NOT NULL DEFAULT false, snapshot jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE inventory_movements (
 id bigserial PRIMARY KEY, material_id uuid NOT NULL REFERENCES inventory_materials(id),
 order_id bigint REFERENCES orders(id) ON DELETE SET NULL,
 quantity numeric(18,6) NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_material_idx ON inventory_movements(material_id, id DESC);
-- Existing completed orders are the baseline, not new production.
INSERT INTO order_inventory(order_id, consumed)
 SELECT id, true FROM orders WHERE shipped OR workflow_status IN ('crafted','ready_for_pickup','shipped');
