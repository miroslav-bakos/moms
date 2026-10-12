CREATE TABLE app_branding (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  name text NOT NULL DEFAULT 'MOMS — Multichannel Order Management System',
  logo text
);
INSERT INTO app_branding (id) VALUES (true);
