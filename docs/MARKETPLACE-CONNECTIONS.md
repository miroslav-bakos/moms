# Marketplace configuration and OAuth callbacks

Use applications and seller accounts you own. Provider approval, API roles, scopes and limits remain controlled by each marketplace. Never paste credentials into an issue or commit them. Configure account fields in MOMS Settings; use `.env.example` as a reference for available bootstrap variables. Start with one channel disabled, save its credentials, restart when requested, authorize if needed, then enable synchronization.

## Which connections need a callback?

| Connection | Callback requirement |
| --- | --- |
| SAShE seller ID + API key | None |
| Etsy OAuth | Register an exact redirect URI; the guide uses a public HTTPS callback |
| Amazon private SP-API application with refresh token | No public callback needed for this connection mode |
| Amazon third-party seller authorization | Registered authorization/redirect URLs and approved roles; advanced provider setup |
| Shopify own-store Admin token or `client_credentials` | No OAuth callback |
| Shopify OAuth | Registered redirect URI required |

Tailscale Funnel is one way to supply public HTTPS; it is not a requirement for manual orders or the callback-free modes above. Private Tailscale Serve is not a public callback service. Changing the hostname or port requires updating the marketplace redirect URI and reconnecting.

## Tailscale Funnel for OAuth callbacks

### Local launcher or host Node installation

1. Install [Tailscale](https://tailscale.com/download) on the same computer as MOMS and sign in to your own account. Keep it running.
2. Open MOMS → Settings → Marketplace setup guide (`/marketplace-setup.html`). Click **Enable callback**.
3. If prompted, follow the Tailscale approval link, allow Funnel for this device and retry. A managed tailnet may require administrator approval.
4. MOMS creates a public HTTPS Funnel on port **10000**, targeting its separate loopback callback listener at `127.0.0.1:3081` for the default app port 3080. It verifies public reachability before saving callback settings.
5. Copy the complete provider callback into the provider's application settings. For a fictional hostname:

```text
https://your-computer.example-tailnet.ts.net:10000/auth/etsy/callback
https://your-computer.example-tailnet.ts.net:10000/auth/shopify/callback
https://your-computer.example-tailnet.ts.net:10000/auth/amazon/callback
```

Use your actual generated hostname, including `:10000` and the exact path. Start authorization from the private MOMS tab; after approval, the callback page tells you to return there. Keep MOMS and Tailscale running throughout authorization. The listener accepts only the three GET callback paths and its verification endpoint; orders, settings and the main UI are not served through it.

**Check callback** reports current configuration; **Disable callback** removes MOMS's matching Funnel handler and stops its listener. MOMS refuses to overwrite another service occupying this port. Do not use a global Tailscale reset to fix a conflict.

### Docker limitations

The supplied Compose installation does not install Tailscale in the app container or connect it to the host daemon. Its callback listener binds to container loopback, so simply publishing port 3081 or installing Tailscale on the host does not make the guide work. The host setup button is not an automatic Docker solution.

For Docker, an operator must arrange a callback-only proxy sharing the listener's network namespace and a Tailscale deployment that can reach it, persist `MARKETPLACE_CALLBACKS_ENABLED=true`, and register the resulting exact HTTPS redirect URIs. This networking adaptation is not supplied by the default Compose file. Use a host/native installation for the guided callback setup, or a callback-free marketplace mode where available. **Do not Funnel port 3080 as a shortcut:** it serves the whole application.

For supported Funnel ports, permissions and troubleshooting, consult the [official Funnel guide](https://tailscale.com/docs/features/tailscale-funnel) and [CLI reference](https://tailscale.com/docs/reference/tailscale-cli/funnel). The built-in callback setup is distinct from the optional private Serve helper in [DESKTOP.md](DESKTOP.md).

## SAShE

Obtain your seller user ID and API key, enter them in SAShE account settings, then enable synchronization. MOMS reads packages/orders and their items and delivery details. There is no OAuth redirect and no marketplace shipment confirmation writeback. Check the imported SKU mappings before using stock/production actions.

## Etsy

Create your own application through the [Etsy developer portal](https://developers.etsy.com/documentation/), configure its application key and shop ID in MOMS and register the exact callback from the guide. Save/restart, then use **Authorize** and approve access with the shop owner account.

Order import needs `transactions_r`. To send shipment tracking, add `transactions_w` to the configured scopes and reauthorize; the `.env.example` read/listing scope set does not include it. Etsy must also approve access to the shipment endpoint. Listing scopes in existing configurations do not mean MOMS implements catalog management. See [dispatch instructions](SELLER-OPERATIONS.md#send-dispatch-to-etsy).

## Amazon

For your own seller account, configure private mode, Login with Amazon client ID/secret, the SP-API refresh token, region group and marketplace IDs. Keep unrelated marketplaces out of that configuration. Use the provider's [SP-API documentation](https://developer-docs.amazon.com/sp-api/) to register and authorize the application and grant the required roles. Default Orders API version is `2026-01-01`; legacy `v0` imports remain configurable.

Delivery-address access is restricted and separately configurable (`AMAZON_FETCH_ADDRESS`); enabling the flag does not grant Amazon permissions. Dispatch needs the Inventory and Order Tracking role and an eligible merchant-fulfilled, unshipped order. Finances balance access and Solicitations review requests also depend on provider eligibility/roles. Third-party authorization requires additional provider registration beyond generating a callback URL; the callback-only listener does not publish a complete public authorization website.

## Shopify

Configure your `your-shop.myshopify.com` domain and choose the supported method: an existing valid Admin access token, own-store `client_credentials` with client ID/secret, or OAuth. Tokens/credentials must belong to an app installed on that store. OAuth additionally needs the exact registered callback; own-store credentials do not.

For import and shipment confirmation grant `read_orders`, `read_fulfillments`, `read_merchant_managed_fulfillment_orders` and `write_merchant_managed_fulfillment_orders`. Existing tokens need reconnecting after scope changes. Shopify Payments balance queries require separate permitted Payments access; unavailable funds are not estimated from sales. The configured default Admin API version is `2026-04`. See [Shopify dispatch behavior](SELLER-OPERATIONS.md#send-dispatch-to-amazon-and-shopify) and the [official Admin API documentation](https://shopify.dev/docs/api/admin).

## Connection troubleshooting

- Callback mismatch: compare scheme, hostname, port and path character for character with the provider registration.
- Expired/invalid authorization: start again from the private MOMS tab; do not reuse an old callback link.
- Tailscale not found or Funnel denied: confirm installation, signed-in state and device permission; Docker has the limitations described above.
- Import succeeds but dispatch fails: verify write permissions, endpoint approval and full-order shipment eligibility. Read scopes alone do not authorize shipment writes.
- Missing orders: check enabled channel, shop/marketplace IDs, polling lookback and diagnostics before widening the import window.
- Unclear shipment result: inspect remote tracking and use reconciliation; do not send a second shipment blindly.
