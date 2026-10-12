ALTER TABLE inventory_materials ADD COLUMN image text CHECK (image IS NULL OR octet_length(image) <= 1400000);
ALTER TABLE manufacturing_products ADD COLUMN image text CHECK (image IS NULL OR octet_length(image) <= 1400000);
