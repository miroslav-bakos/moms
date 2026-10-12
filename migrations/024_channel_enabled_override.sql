-- Preserve existing effective behavior until a user explicitly chooses a state.
ALTER TABLE channel_state ADD COLUMN enabled_override boolean;
