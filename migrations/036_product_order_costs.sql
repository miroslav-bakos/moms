ALTER TABLE inventory_materials ADD COLUMN unit_cost numeric(18,6) CHECK (unit_cost >= 0);
ALTER TABLE inventory_materials ADD COLUMN cost_currency varchar(3) NOT NULL DEFAULT 'EUR' CHECK (cost_currency ~ '^[A-Z]{3}$');
ALTER TABLE manufacturing_products ADD COLUMN labour_cost numeric(18,6) CHECK (labour_cost >= 0);
ALTER TABLE manufacturing_products ADD COLUMN packaging_cost numeric(18,6) CHECK (packaging_cost >= 0);
ALTER TABLE manufacturing_products ADD COLUMN reference_price numeric(18,6) CHECK (reference_price >= 0);
ALTER TABLE manufacturing_products ADD COLUMN cost_currency varchar(3) NOT NULL DEFAULT 'EUR' CHECK (cost_currency ~ '^[A-Z]{3}$');
ALTER TABLE order_inventory ADD COLUMN cost_snapshot jsonb;
CREATE TABLE order_costs (
 order_id bigint PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
 production_cost numeric(18,6) CHECK (production_cost >= 0),
 shipping_cost numeric(18,6) CHECK (shipping_cost >= 0),
 marketplace_fee numeric(18,6) CHECK (marketplace_fee >= 0),
 payment_fee numeric(18,6) CHECK (payment_fee >= 0),
 other_cost numeric(18,6) CHECK (other_cost >= 0),
 currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now()
);
