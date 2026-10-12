-- Backfill tracking_url for orders that have a tracking_code but no URL.
-- Posta SK uses the UPU S10 format: 2 letters + 8 digits + 2 letters (e.g. RR12345678SK).
-- GLS numbers are all-numeric.

UPDATE orders
SET tracking_url = 'https://tandt.posta.sk/en/items/' || tracking_code
WHERE tracking_code <> ''
  AND tracking_url = ''
  AND tracking_code ~ '^[A-Z]{2}[0-9]{8}[A-Z]{2}$';

UPDATE orders
SET tracking_url = 'https://gls-group.eu/EU/en/parcel-tracking?match=' || tracking_code
WHERE tracking_code <> ''
  AND tracking_url = ''
  AND tracking_code ~ '^[0-9]+$';
