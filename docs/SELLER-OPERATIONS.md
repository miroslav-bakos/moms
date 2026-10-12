# Seller operations

## Guided setup

Restart the local setup guide from settings. Choose a marketplace or manual orders, open its account settings, connect the account and enable synchronization. The first synchronization runs only the chosen marketplace. Marketplace application credentials and provider authorization still use the existing account settings.

After mapping an SKU to a product recipe, run the trial with that SKU. This is a read-only rehearsal: it shows finished pieces, production quantities and required/missing materials without saving an order or changing stock. Manual order creation remains available from the first-import step.

## Stock by order

Inventory → Materials → Stock by order shows reserved, available and missing quantities for products and materials, with each order's allocation. The planning order is earliest ship-by date, then oldest order date, then local order ID. Orders without dates follow dated orders.

Reservations are a recalculated plan rather than a stock lock. Completing a different order may use these pieces. Stock shortages still permit completion; existing transaction and reopening protections remain in force.

## Production meanings

Settings → Workflow provides “Production complete — consume stock” for each stage. Moving into a complete stage consumes once, moving between complete stages does not consume again, and reopening restores the recorded snapshot. Archiving remains independent and retains its existing completion behavior.

The default NEW stage stays incomplete. Empty a stage before changing its meaning; changing a name or order of columns does not alter stock. Existing standard completion meanings are retained by migration 037.

## Send dispatch to Etsy

The initial channel is Etsy. Authorize with `transactions_w` as well as the existing read scope; existing accounts may need scope configuration and reauthorization. Etsy also requires app approval for the shipment endpoint; scopes alone do not guarantee access. See the [official Etsy fulfillment guide](https://developers.etsy.com/documentation/tutorials/fulfillment/). A shipment must contain the complete order and a tracking code. In order details, record that shipment and select “Send dispatch to Etsy”. Choose GLS (`gls`), Slovenská pošta (`slovenska-posta`) or Other (`other`). Etsy receives the tracking with that carrier and sends its shipping notification to the buyer. Local archiving and stock are not changed by writeback.

A confirmed result is retained and repeated clicks do not resend. If the result is unclear (including a timeout or interrupted process), the action checks Etsy for the same tracking rather than posting again. If Etsy has no matching tracking yet, verify the receipt on Etsy; MOMS deliberately does not automatically resend an ambiguous attempt. A definite rejection or failed preflight check can be retried after resolving connection/permission issues. Confirmed or uncertain shipments cannot be canceled locally. Partial-order writeback, refunds and marketplace-side cancellation are outside this release. Amazon and Shopify support is described below.

## Service diagnostics

The dashboard shows enabled channels with stale imports or connection errors and stale/failed backups. Channel requests have a 30-second timeout; read requests retry HTTP 429/502/503/504 at most twice. Write requests never automatically retry. A support JSON report is available in Settings → Logs; it includes connection/backup states and timestamps, without raw error payloads, credentials or customer details.

## Accountant handoff

Settings → Logs → Accounting export downloads CSV for an inclusive UTC order-date period of at most one year and 10,000 orders. It includes revenue, production/shipping/marketplace/payment/other costs, totals, contribution, cost basis and missing fields. Revenue currency and cost currency are separate. Missing costs remain blank; mixed currencies and refund/cancellation outcomes suppress profit. This is an order-based handoff, not a tax ledger or a marketplace payout reconciliation.

## Backup copies and recovery

In application settings, set “Backup copy directory” to an existing absolute directory on a mounted external drive or network share, then restart MOMS. For Docker, mount that directory into the app container and use the container path. The administrator must choose a destination outside the device; MOMS cannot prove that an arbitrary directory is physically off-device.

Every complete local backup is then copied and its SHA-256 checked before the copy is finalized. Copy files use owner-only permissions; destinations must support these permissions. Local backups are retained when copying fails; the dashboard reports copy failures. Copies are not automatically pruned, and the drive/share must be mounted and accessible. Keep the directory private because complete backups contain credentials.

To recover on another installation, copy a `.moms.gz` file from that destination, open Settings → Backups, and use “Choose File & Verify” to check checksums and restoration into a temporary database. Then use “Choose File & Restore” on the intended installation. Restore replaces that installation's data/settings and restarts the app. Keep an independent backup before restoration. Configure the new installation's external-copy destination after restoring.

### Carrier conventions for later channels

The seller uses Amazon `OTHER` with manually entered carrier name `national post` and tracking. For Shopify the seller uses GLS or Other; Slovenská pošta tracking links use `http://tandt.posta.sk/en/items/` plus the tracking number. These carrier conventions are now implemented as described below.

## Send dispatch to Amazon and Shopify

In order details → Shipments and returns, finish production, record one shipment covering all order lines and enter its tracking number. Use “Send dispatch to Amazon” or “Send dispatch to Shopify”. This confirms shipment on that marketplace; local archiving remains independent. It does not create a carrier label or book transport.

Amazon sends `carrierCode: Other`, `carrierName: National Post`, `shippingMethod: Parcel` and the recorded tracking number through [confirmShipment](https://developer-docs.amazon.com/sp-api/docs/confirm-the-shipment-status). The app needs the Inventory and Order Tracking role. Only merchant-fulfilled, unshipped orders with matching source item IDs/quantities and no existing active package qualify. A persistent numeric package reference and complete request snapshot are saved before sending. Reconciliation uses the Orders 2026 packages API and requires that same reference, carrier, tracking and item quantities.

Shopify uses [fulfillmentCreate](https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/fulfillmentCreate) with customer notification enabled. Choose GLS or Other. Other sends the provided tracking URL; if blank, MOMS constructs `http://tandt.posta.sk/en/items/` plus the encoded tracking number. GLS lets Shopify generate its supported carrier link unless an explicit URL was entered. The token requires `read_orders`, `read_fulfillments`, and merchant-managed fulfillment order read/write access (`read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`). Defaults request these scopes for new connections; existing configured scope overrides and existing tokens are preserved. Missing permissions require granting those scopes and reconnecting. MOMS checks all source item quantities, remaining quantities, supported create action and one shared location before creating the fulfillment.

Confirmed shipments cannot be sent again or canceled locally. After a timeout or interrupted send, “Check … tracking” only reads remote shipment details; it never automatically creates another shipment. If confirmation remains unclear, review the marketplace before taking further action. A definite rejection or failed preflight can be retried after correcting permissions or remote order conditions. Existing remote shipments, conflicting quantities, missing original line IDs and incomplete/paginated remote data prevent sending. This release still sends one full-order shipment; partial marketplace writeback is separate work. Tests use fixtures and disposable PostgreSQL; no real buyer notifications are sent during verification.

## Confirm dispatch when moving to Shipped

Moving a supported marketplace order to the Shipped workflow stage now asks for confirmation showing the channel, order and saved tracking number. Cancel keeps the original stage and sends nothing. Confirm records or reuses one full-order shipment and sends its tracking to the marketplace. Tracking is required. Bulk changes also require this confirmation; local archiving remains a separate operation.

“Mark as Shipped (archive)” also asks for marketplace confirmation, then archives only after the marketplace shipment is confirmed. Rejected, blocked or unclear dispatch stays outside the archive for review. This applies to both individual and selected-order actions. Manual orders still archive directly.

A successful stage save is distinguished from a confirmed remote shipment. Rejected, blocked and unclear outcomes show a message and remain available for review in shipment details. Already-shipped cards offer “Confirm marketplace dispatch” or “Check marketplace tracking”; uncertain attempts only reconcile remote tracking and never automatically resend. An existing Amazon package can be recognized without a write when its tracking, National Post/Parcel carrier, complete original item quantities and unique package reference match.

Legacy orders missing source item IDs are upgraded only after a unique original SKU/quantity match against the marketplace. Product mappings can match local display names back to these original SKUs, including multiple order lines, only when every line has a unique match with the same quantity. A single locked production line may retain its edited SKU when its quantity matches the sole verified original item. This retains the original local line IDs and stock snapshots. Ambiguous or changed data blocks confirmation.

The Shipped board column and the archive default to latest dispatch first, using a persistent dispatch timestamp. Expanding Shipped or selecting its tab refreshes the open and archived lists together, so newly archived orders appear in the current list. Editing an order or polling its channel does not bump this timestamp. Historical records use shipment/audit history when available and a stable source/order date otherwise.
