INSERT INTO channel_state (channel, enabled, cursor)
VALUES ('sashe', false, now() - interval '30 days')
ON CONFLICT (channel) DO NOTHING;
