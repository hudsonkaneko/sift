-- Google Calendar integration: extend fixed_blocks + token storage

-- Add google_event_id and specific_date to fixed_blocks
ALTER TABLE fixed_blocks
  ADD COLUMN google_event_id TEXT,
  ADD COLUMN specific_date DATE;

-- Unique constraint: one fixed_block per google event per user
ALTER TABLE fixed_blocks
  ADD CONSTRAINT uq_fixed_blocks_google_event
  UNIQUE (user_id, google_event_id);

CREATE INDEX idx_fixed_blocks_specific_date ON fixed_blocks(specific_date);
CREATE INDEX idx_fixed_blocks_google_event_id ON fixed_blocks(google_event_id);

-- Google Calendar OAuth tokens
CREATE TABLE google_calendar_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expiry TIMESTAMPTZ NOT NULL,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE google_calendar_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gcal_tokens_select_own" ON google_calendar_tokens
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "gcal_tokens_insert_own" ON google_calendar_tokens
  FOR INSERT WITH CHECK (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "gcal_tokens_update_own" ON google_calendar_tokens
  FOR UPDATE USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "gcal_tokens_delete_own" ON google_calendar_tokens
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');
