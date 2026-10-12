CREATE TABLE label_operations (
  order_id bigint PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  carrier text NOT NULL,
  state text NOT NULL CHECK (state IN ('started','uncertain','prepared','completed')),
  provider_refs jsonb NOT NULL DEFAULT '{}',
  outcome jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
