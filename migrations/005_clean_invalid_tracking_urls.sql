-- Clear tracking_url values that are not valid HTTP(S) URLs (e.g. raw cell text "tracking"
-- stored by an earlier csvHyperlink() bug, same issue fixed for order_url in migration 004).

UPDATE orders
SET tracking_url = ''
WHERE tracking_url <> ''
  AND tracking_url NOT LIKE 'http%';

-- Backfill Posta tracking URLs. Migration 003 used an 8-digit regex; UPU S10 has 9 digits.

UPDATE orders
SET tracking_url = 'https://tandt.posta.sk/en/items/' || tracking_code
WHERE tracking_code <> ''
  AND tracking_url = ''
  AND tracking_code ~ '^[A-Z]{2}[0-9]{9}[A-Z]{2}$';

-- Backfill GLS tracking URLs for any cleared above (migration 003 only ran for '' rows).

UPDATE orders
SET tracking_url = 'https://gls-group.eu/EU/en/parcel-tracking?match=' || tracking_code
WHERE tracking_code <> ''
  AND tracking_url = ''
  AND tracking_code ~ '^[0-9]+$';
