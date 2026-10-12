-- GLS tracking numbers starting with "1" are SK domestic parcels and use
-- a different tracking URL than the EU generic one set by migrations 003/005.

UPDATE orders
SET tracking_url = 'https://gls-group.eu/SK/sk/sledovanie-zasielok/?match=' || tracking_code
WHERE tracking_code ~ '^1[0-9]+$';
