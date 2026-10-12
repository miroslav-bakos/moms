CREATE TABLE IF NOT EXISTS backups (
  id serial PRIMARY KEY,
  filename text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
