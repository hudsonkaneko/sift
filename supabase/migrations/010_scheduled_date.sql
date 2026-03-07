-- Add scheduled_date column as the authoritative date for each slot
ALTER TABLE scheduled_slots ADD COLUMN scheduled_date DATE;

-- Backfill from week_of + day_of_week
UPDATE scheduled_slots
  SET scheduled_date = (week_of::date + day_of_week * INTERVAL '1 day')
  WHERE scheduled_date IS NULL;

-- Make it NOT NULL after backfill
ALTER TABLE scheduled_slots ALTER COLUMN scheduled_date SET NOT NULL;

-- Indexes for the new query patterns
CREATE INDEX idx_scheduled_slots_user_date
  ON scheduled_slots(user_id, scheduled_date);
CREATE INDEX idx_scheduled_slots_user_date_locked
  ON scheduled_slots(user_id, scheduled_date, locked);
