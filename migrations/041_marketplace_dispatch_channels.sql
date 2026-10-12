ALTER TABLE marketplace_dispatches DROP CONSTRAINT marketplace_dispatches_channel_check;
ALTER TABLE marketplace_dispatches ADD CONSTRAINT marketplace_dispatches_channel_check CHECK (channel IN ('etsy','amazon','shopify'));
CREATE SEQUENCE marketplace_package_reference_seq START WITH 1000000000000;
ALTER TABLE marketplace_dispatches ADD COLUMN package_reference_id bigint NOT NULL DEFAULT nextval('marketplace_package_reference_seq');
ALTER SEQUENCE marketplace_package_reference_seq OWNED BY marketplace_dispatches.package_reference_id;
ALTER TABLE marketplace_dispatches ADD COLUMN request_payload jsonb;
