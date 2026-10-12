ALTER TABLE orders ADD COLUMN dispatched_at timestamptz;
-- Prefer recorded shipment/transition history; historical imports have no exact
-- local send timestamp, so retain a stable source date rather than polling time.
UPDATE orders o SET dispatched_at=COALESCE(
 (SELECT max(created_at) FROM order_shipments WHERE order_id=o.id AND canceled_at IS NULL),
 (SELECT max(created_at) FROM audit_log WHERE entity_type='order' AND entity_id=o.id::text AND (changes->'after'->>'workflow_status'='shipped' OR changes->'after'->>'shipped'='true')),
 o.updated_at_source,o.created_at,o.imported_at
) WHERE o.workflow_status='shipped' OR o.shipped=true;
CREATE FUNCTION record_order_dispatch_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.shipped OR NEW.workflow_status='shipped' THEN NEW.dispatched_at=COALESCE(NEW.dispatched_at,NEW.updated_at_source,NEW.created_at,now()); END IF;
 ELSIF NEW.workflow_status='shipped' AND OLD.workflow_status IS DISTINCT FROM NEW.workflow_status THEN
  NEW.dispatched_at=now();
 ELSIF NEW.shipped AND NOT OLD.shipped THEN
  NEW.dispatched_at=COALESCE(NEW.dispatched_at,CASE WHEN NEW.status ~* '^(shipped|fulfilled)$' AND OLD.status IS DISTINCT FROM NEW.status THEN NEW.updated_at_source END,now());
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER order_dispatch_time BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION record_order_dispatch_time();
CREATE INDEX orders_dispatch_time_idx ON orders(dispatched_at DESC,id DESC) WHERE shipped=true OR workflow_status='shipped';
