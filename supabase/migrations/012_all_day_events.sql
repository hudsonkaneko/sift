-- Support for all-day Google Calendar events, which have no start/end times.
-- Rendered in a dedicated strip above the hourly calendar grid.
-- Ignored by the scheduler (they don't occupy any specific time slot).

ALTER TABLE fixed_blocks
  ADD COLUMN is_all_day BOOLEAN NOT NULL DEFAULT FALSE;
