# Local fulfillment and returns

Orders retain one revenue record and their existing independent archive/workflow state.
Shipment records allocate positive integer quantities to stable order-line IDs. Creating a
shipment requires recorded completed production; shipping does not consume stock again
or implicitly archive the order. Canceling a shipment releases its allocation and retains
its tracking/label history. Another shipment can then fulfill the remaining quantity.

Line quantities come from marketplace raw SKUs, or explicitly entered local SKU quantities.
Lines freeze when production/fulfillment is recorded. Existing completed orders without
line-level stock snapshots can ship, but cannot automatically restore materials on return.
They require an explicit audited stock correction through inventory.

Cancellation, refund and return are separate business outcomes. Refund/return records
contain line, quantity and reason. Receiving a return is an explicit action: material
restoration is optional, limited to the immutable production allocation, and recorded once
under the order and inventory locks. Refund alone never changes stock. A received return
prevents reopening production, because that would otherwise restore the same consumption
again. Shipment cancellation and archive changes do not restore stock.

All data, labels and preferences remain in the customer's local application/database.

New adapters may supply `source_id` on raw SKU entries; older integrations receive a
stable ordinal source key inside their existing order. Before production or fulfillment,
line metadata can refresh from sync. Recorded consumption or shipments freeze the local
SKU/quantity snapshot. Address edits retain the existing independent address lock.
Refund and return quantities are tracked separately, so the same item can be refunded
and physically returned without restoring material twice. Receipt rounding uses cumulative
quantities, avoiding accumulated fractional-stock errors across split returns.


## Finished product stock

Products have separate finished stock, initially zero. In Inventory → Products and
recipes, **Record production** adds ready units and consumes the current recipe in
the same transaction. **Adjust finished stock** sets an opening/corrected count of
already made products without consuming materials. Both operations require a
matching previous stock count and an idempotency key; retrying a saved request
cannot manufacture or adjust it twice.

At the first transition into `crafted`, `ready_for_pickup`, or `shipped` (or archive),
including a direct jump from a pre-production stage, orders take available finished
products first. Only missing products consume recipe materials. Completed-stage
transitions never consume again. Reopening restores exactly the recorded products
and materials, even after a recipe edit. Existing historical consumption remains
unchanged. Product stock affects the queue's **From finished stock** / **To produce**
counts, material needs and shortage shopping list.

New line snapshots retain compact unit ranges, so a mixed stock/material order does
not restore fractional finished pieces on a partial return. Returned quantities
restore the next units from the original allocation, finished-stock units first
within each line. The recorded source is restored; refund alone never restocks.
Legacy material-only snapshots continue to work. Received returns still prevent
reopening production; an item with stock history cannot be deleted.

Empty finished stock never blocks stage changes: allocation falls back to materials.
Even zero material stock permits completion and records a visible negative shortage;
unmapped SKUs/empty recipes retain the existing gradual-setup behavior.
