ALTER TABLE marketplace_dispatches ADD COLUMN carrier_name text NOT NULL DEFAULT 'other' CHECK (carrier_name IN ('gls','slovenska-posta','other'));
