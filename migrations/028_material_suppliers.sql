CREATE TABLE inventory_manufacturers (id uuid PRIMARY KEY, name text NOT NULL);
CREATE UNIQUE INDEX inventory_manufacturers_name_idx ON inventory_manufacturers(lower(btrim(name)));
ALTER TABLE inventory_materials ADD COLUMN manufacturer_id uuid REFERENCES inventory_manufacturers(id);
ALTER TABLE inventory_materials ADD COLUMN purchase_url text NOT NULL DEFAULT '';
CREATE TABLE inventory_shopping_list (
 material_id uuid PRIMARY KEY REFERENCES inventory_materials(id) ON DELETE CASCADE,
 quantity numeric(18,6) NOT NULL CHECK(quantity > 0), created_at timestamptz NOT NULL DEFAULT now()
);
