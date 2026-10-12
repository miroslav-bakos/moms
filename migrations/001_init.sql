CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_state (
  channel text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  cursor timestamptz,
  last_poll_started_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO channel_state (channel, enabled, cursor)
VALUES
  ('etsy', false, now() - interval '30 days'),
  ('shopify', false, now() - interval '30 days'),
  ('amazon', false, now() - interval '30 days')
ON CONFLICT (channel) DO NOTHING;

CREATE TABLE IF NOT EXISTS oauth_tokens (
  channel text PRIMARY KEY,
  token_ciphertext text NOT NULL,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state text PRIMARY KEY,
  channel text NOT NULL,
  code_verifier text,
  redirect_after text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  sku text PRIMARY KEY,
  display_name text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id bigserial PRIMARY KEY,
  channel text NOT NULL,
  vendor text NOT NULL,
  external_order_id text NOT NULL,
  order_name text,
  status text,
  skus text NOT NULL DEFAULT '',
  raw_skus jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz,
  updated_at_source timestamptz,
  ship_by_date timestamptz,
  address text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  is_gift boolean NOT NULL DEFAULT false,
  gift_message text NOT NULL DEFAULT '',
  processed boolean NOT NULL DEFAULT false,
  packed boolean NOT NULL DEFAULT false,
  shipped boolean NOT NULL DEFAULT false,
  label_created boolean NOT NULL DEFAULT false,
  tracking_code text NOT NULL DEFAULT '',
  tracking_url text NOT NULL DEFAULT '',
  label_url text NOT NULL DEFAULT '',
  order_url text NOT NULL DEFAULT '',
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_order_id)
);

CREATE INDEX IF NOT EXISTS orders_channel_created_idx ON orders (channel, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_active_idx ON orders (shipped, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_updated_source_idx ON orders (updated_at_source DESC);

CREATE TABLE IF NOT EXISTS app_events (
  id bigserial PRIMARY KEY,
  level text NOT NULL DEFAULT 'info',
  source text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
