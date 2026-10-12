-- All-numeric tracking codes are GLS; overwrite whatever URL they have with the correct GLS URL.
-- Codes starting with 1 use the SK portal; all others use the EU portal.
UPDATE orders
  SET tracking_url = 'https://gls-group.eu/SK/sk/sledovanie-zasielok/?match=' || tracking_code
  WHERE tracking_code ~ '^1\d+$';

UPDATE orders
  SET tracking_url = 'https://gls-group.eu/EU/en/parcel-tracking?match=' || tracking_code
  WHERE tracking_code ~ '^\d+$' AND tracking_code NOT LIKE '1%';
