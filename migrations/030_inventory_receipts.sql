-- Keep receipt retry identity in the existing durable stock ledger.
ALTER TABLE inventory_movements ADD COLUMN receipt_key uuid;
CREATE UNIQUE INDEX inventory_movements_receipt_key_idx ON inventory_movements(receipt_key) WHERE receipt_key IS NOT NULL;
