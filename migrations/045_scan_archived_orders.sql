-- A returned parcel may only retain its original archived order barcode.
-- Keep scan selections until explicitly cleared, regardless of archive edits.
DROP TRIGGER remove_archived_scan_order ON orders;
DROP FUNCTION remove_archived_scan_order();
