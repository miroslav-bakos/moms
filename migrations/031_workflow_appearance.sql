ALTER TABLE order_workflow_statuses
  ADD COLUMN background_color text,
  ADD COLUMN background_alpha numeric(3,2) NOT NULL DEFAULT 0.15,
  ADD CONSTRAINT workflow_background_color_valid CHECK (background_color IS NULL OR background_color ~ '^#[0-9a-fA-F]{6}$'),
  ADD CONSTRAINT workflow_background_alpha_valid CHECK (background_alpha >= 0 AND background_alpha <= 1);
