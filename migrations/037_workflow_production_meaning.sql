ALTER TABLE order_workflow_statuses ADD COLUMN production_complete boolean NOT NULL DEFAULT false;
UPDATE order_workflow_statuses SET production_complete=true WHERE id IN ('crafted','ready_for_pickup','shipped');
ALTER TABLE order_workflow_statuses ADD CONSTRAINT default_stage_not_complete CHECK (id <> 'new' OR production_complete=false);
