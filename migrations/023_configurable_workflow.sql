CREATE TABLE order_workflow_statuses (
  id text PRIMARY KEY,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  position integer NOT NULL
);
CREATE UNIQUE INDEX order_workflow_statuses_label_idx ON order_workflow_statuses (lower(label));
INSERT INTO order_workflow_statuses (id, label, position) VALUES
  ('new', 'NEW', 0), ('in_progress', 'IN PROGRESS', 1), ('crafted', 'CRAFTED', 2),
  ('ready_for_pickup', 'READY FOR PICKUP', 3), ('shipped', 'SHIPPED', 4);
ALTER TABLE orders DROP CONSTRAINT orders_workflow_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_workflow_status_fkey
  FOREIGN KEY (workflow_status) REFERENCES order_workflow_statuses(id);
