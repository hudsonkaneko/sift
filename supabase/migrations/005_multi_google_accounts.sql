-- Multi Google account support: allow multiple Google accounts per user

-- 1. Restructure google_calendar_tokens: add id + email, drop user_id PK
ALTER TABLE google_calendar_tokens DROP CONSTRAINT google_calendar_tokens_pkey;
ALTER TABLE google_calendar_tokens ADD COLUMN id UUID DEFAULT gen_random_uuid();
ALTER TABLE google_calendar_tokens ADD COLUMN google_email TEXT;
ALTER TABLE google_calendar_tokens ADD PRIMARY KEY (id);
ALTER TABLE google_calendar_tokens ADD CONSTRAINT uq_gcal_tokens_user_email UNIQUE (user_id, google_email);

-- 2. Add google_email to calendar sources
ALTER TABLE google_calendar_sources ADD COLUMN google_email TEXT;
-- Update unique constraint to scope per account
ALTER TABLE google_calendar_sources DROP CONSTRAINT google_calendar_sources_user_id_google_calendar_id_key;
ALTER TABLE google_calendar_sources ADD CONSTRAINT uq_gcal_sources_user_cal_email UNIQUE (user_id, google_calendar_id, google_email);
