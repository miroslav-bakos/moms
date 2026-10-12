-- A locally completed shipment is no longer an active order. Marketplace
-- confirmation remains separately recorded and visible when still pending.
UPDATE orders SET shipped=true, updated_at=now()
WHERE workflow_status='shipped' AND shipped=false;
