-- Fix: NULL google_email causes duplicate rows (NULL != NULL in unique constraints)

-- 1. Delete duplicate source rows with NULL google_email, keeping only the oldest per (user_id, google_calendar_id)
DELETE FROM google_calendar_sources
WHERE google_email IS NULL
  AND id NOT IN (
    SELECT DISTINCT ON (user_id, google_calendar_id) id
    FROM google_calendar_sources
    WHERE google_email IS NULL
    ORDER BY user_id, google_calendar_id, created_at ASC
  );

-- 2. Delete duplicate token rows with NULL google_email, keeping only the oldest per user_id
DELETE FROM google_calendar_tokens
WHERE google_email IS NULL
  AND id NOT IN (
    SELECT DISTINCT ON (user_id) id
    FROM google_calendar_tokens
    WHERE google_email IS NULL
    ORDER BY user_id, created_at ASC
  );

-- 3. Partial unique indexes to prevent future NULL-email duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uq_gcal_sources_null_email
  ON google_calendar_sources (user_id, google_calendar_id)
  WHERE google_email IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gcal_tokens_null_email
  ON google_calendar_tokens (user_id)
  WHERE google_email IS NULL;
