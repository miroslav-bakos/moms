CREATE TABLE web_push_subscriptions (
  endpoint_hash TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  subscription JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_notified_at TIMESTAMPTZ
);
