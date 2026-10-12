-- Clear order_url values that are not valid HTTP(S) URLs.
-- These were stored by csvHyperlink() returning raw cell text when
-- the cell didn't contain an actual URL or HYPERLINK formula.

UPDATE orders
SET order_url = ''
WHERE order_url IS NOT NULL
  AND order_url <> ''
  AND order_url NOT LIKE 'http%';
