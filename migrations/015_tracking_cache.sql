CREATE TABLE IF NOT EXISTS tracking_cache (
  tracking_code text PRIMARY KEY,
  status        text        NOT NULL,
  delivered_at  timestamptz,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);
