ALTER TABLE oauth_states ADD COLUMN owner_hash text;
ALTER TABLE oauth_states ADD COLUMN session_hash text;
-- Old authorization attempts were not bound to an authenticated owner.
DELETE FROM oauth_states;
