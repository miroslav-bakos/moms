CREATE TABLE scan_list (
  order_id bigint PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION remove_archived_scan_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM scan_list WHERE order_id=NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER remove_archived_scan_order
AFTER UPDATE OF shipped ON orders
FOR EACH ROW WHEN (NEW.shipped=true)
EXECUTE FUNCTION remove_archived_scan_order();
