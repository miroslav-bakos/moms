ALTER TABLE orders ADD COLUMN IF NOT EXISTS feedback_requested boolean NOT NULL DEFAULT false;
