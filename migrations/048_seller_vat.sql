CREATE TABLE seller_vat_preferences (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 mode text NOT NULL DEFAULT 'unreviewed' CHECK (mode IN ('unreviewed','nonpayer','payer')),
 rate numeric(5,2) CHECK (rate >= 0 AND rate <= 100),
 costs_include_vat boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 0
);
INSERT INTO seller_vat_preferences(id) VALUES(true);
-- Explicit per-order treatment preserves history when seller preferences change.
ALTER TABLE order_costs ADD COLUMN vat jsonb;
