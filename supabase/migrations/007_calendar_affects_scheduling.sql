-- Add affects_scheduling toggle to google_calendar_sources
-- When false, events from this calendar won't block time during schedule generation
ALTER TABLE google_calendar_sources
  ADD COLUMN affects_scheduling BOOLEAN NOT NULL DEFAULT true;
