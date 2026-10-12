CREATE TABLE mobile_pairing_codes (
  token_hash TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE mobile_devices (
  token_hash TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
