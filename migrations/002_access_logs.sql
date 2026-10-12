CREATE TABLE IF NOT EXISTS access_logs (
  id bigserial PRIMARY KEY,
  method text NOT NULL,
  path text NOT NULL,
  status_code integer NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  ip text NOT NULL DEFAULT '',
  source_network text NOT NULL DEFAULT 'unknown',
  tailscale_user_login text NOT NULL DEFAULT '',
  tailscale_user_name text NOT NULL DEFAULT '',
  basic_auth_user text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  referer text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_logs_created_idx ON access_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS access_logs_source_network_idx ON access_logs (source_network, created_at DESC);
