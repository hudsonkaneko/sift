-- New table: google_calendar_sources
CREATE TABLE google_calendar_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  google_calendar_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, google_calendar_id)
);

CREATE INDEX idx_google_calendar_sources_user ON google_calendar_sources(user_id);

ALTER TABLE google_calendar_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own calendar sources"
  ON google_calendar_sources FOR ALL
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE POLICY "Service role full access on google_calendar_sources"
  ON google_calendar_sources FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add google_calendar_id column to fixed_blocks
ALTER TABLE fixed_blocks ADD COLUMN google_calendar_id TEXT;

-- Drop old unique constraint and create new one scoped to calendar
ALTER TABLE fixed_blocks DROP CONSTRAINT IF EXISTS fixed_blocks_user_id_google_event_id_key;
ALTER TABLE fixed_blocks ADD CONSTRAINT fixed_blocks_user_gcal_event_unique
  UNIQUE (user_id, google_event_id, google_calendar_id);
