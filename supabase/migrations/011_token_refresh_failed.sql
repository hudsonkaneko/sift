-- Track Google Calendar token refresh failures so the UI can prompt reconnection.
-- NULL = never failed (or cleared after a successful refresh).
-- TIMESTAMPTZ = first failure time.

ALTER TABLE google_calendar_tokens
  ADD COLUMN refresh_failed_at TIMESTAMPTZ;
