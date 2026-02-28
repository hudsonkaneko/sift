-- Sift Phase 1 MVP: Initial Schema
-- All tables use RLS to ensure users can only access their own data.

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE task_category AS ENUM ('School', 'Startup', 'Collab', 'Personal');
CREATE TYPE recurrence_type AS ENUM ('none', 'daily', 'weekdays', 'weekly');
CREATE TYPE user_tone AS ENUM ('friendly', 'direct', 'gentle', 'hype');

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE users (
  id TEXT PRIMARY KEY, -- synced from Clerk user ID
  email TEXT NOT NULL,
  display_name TEXT,
  tone user_tone NOT NULL DEFAULT 'friendly',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category task_category NOT NULL DEFAULT 'Personal',
  estimated_minutes INTEGER NOT NULL DEFAULT 30,
  deadline DATE,
  recurrence recurrence_type NOT NULL DEFAULT 'none',
  completed BOOLEAN NOT NULL DEFAULT false,
  color TEXT, -- hex color string
  parent_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  urgency INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fixed_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_hour INTEGER NOT NULL CHECK (start_hour >= 0 AND start_hour <= 23),
  start_minute INTEGER NOT NULL DEFAULT 0 CHECK (start_minute >= 0 AND start_minute <= 59),
  end_hour INTEGER NOT NULL CHECK (end_hour >= 0 AND end_hour <= 24),
  end_minute INTEGER NOT NULL DEFAULT 0 CHECK (end_minute >= 0 AND end_minute <= 59),
  user_created BOOLEAN NOT NULL DEFAULT true,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scheduled_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_hour INTEGER NOT NULL CHECK (start_hour >= 0 AND start_hour <= 23),
  start_minute INTEGER NOT NULL DEFAULT 0 CHECK (start_minute >= 0 AND start_minute <= 59),
  end_hour INTEGER NOT NULL CHECK (end_hour >= 0 AND end_hour <= 24),
  end_minute INTEGER NOT NULL DEFAULT 0 CHECK (end_minute >= 0 AND end_minute <= 59),
  week_of DATE NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'New Chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scheduling_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  earliest_hour INTEGER NOT NULL DEFAULT 9,
  latest_hour INTEGER NOT NULL DEFAULT 23,
  min_block_minutes INTEGER NOT NULL DEFAULT 30,
  prefer_mornings BOOLEAN NOT NULL DEFAULT true,
  prefer_evenings BOOLEAN NOT NULL DEFAULT true,
  avoid_weekends BOOLEAN NOT NULL DEFAULT false,
  custom_rules JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scheduling_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_text TEXT NOT NULL,
  rule_type TEXT NOT NULL DEFAULT 'custom',
  source TEXT NOT NULL DEFAULT 'chat',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_parent_id ON tasks(parent_id);
CREATE INDEX idx_fixed_blocks_user_id ON fixed_blocks(user_id);
CREATE INDEX idx_scheduled_slots_user_id ON scheduled_slots(user_id);
CREATE INDEX idx_scheduled_slots_week_of ON scheduled_slots(week_of);
CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_scheduling_preferences_user_id ON scheduling_preferences(user_id);
CREATE INDEX idx_scheduling_rules_user_id ON scheduling_rules(user_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_rules ENABLE ROW LEVEL SECURITY;

-- Users: can read/update own row
CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (id = auth.jwt() ->> 'sub');
CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (id = auth.jwt() ->> 'sub');

-- Tasks: full CRUD on own rows
CREATE POLICY "tasks_select_own" ON tasks
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "tasks_insert_own" ON tasks
  FOR INSERT WITH CHECK (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "tasks_update_own" ON tasks
  FOR UPDATE USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "tasks_delete_own" ON tasks
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');

-- Fixed blocks: full CRUD on own rows
CREATE POLICY "fixed_blocks_select_own" ON fixed_blocks
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "fixed_blocks_insert_own" ON fixed_blocks
  FOR INSERT WITH CHECK (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "fixed_blocks_update_own" ON fixed_blocks
  FOR UPDATE USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "fixed_blocks_delete_own" ON fixed_blocks
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');

-- Scheduled slots: full CRUD on own rows
CREATE POLICY "scheduled_slots_select_own" ON scheduled_slots
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "scheduled_slots_insert_own" ON scheduled_slots
  FOR INSERT WITH CHECK (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "scheduled_slots_update_own" ON scheduled_slots
  FOR UPDATE USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "scheduled_slots_delete_own" ON scheduled_slots
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');

-- Chat sessions: full CRUD on own rows
CREATE POLICY "chat_sessions_select_own" ON chat_sessions
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "chat_sessions_insert_own" ON chat_sessions
  FOR INSERT WITH CHECK (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "chat_sessions_update_own" ON chat_sessions
  FOR UPDATE USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "chat_sessions_delete_own" ON chat_sessions
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');

-- Chat messages: full CRUD on own rows
CREATE POLICY "chat_messages_select_own" ON chat_messages
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "chat_messages_insert_own" ON chat_messages
  FOR INSERT WITH CHECK (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "chat_messages_update_own" ON chat_messages
  FOR UPDATE USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "chat_messages_delete_own" ON chat_messages
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');

-- Scheduling preferences: full CRUD on own row
CREATE POLICY "scheduling_preferences_select_own" ON scheduling_preferences
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "scheduling_preferences_insert_own" ON scheduling_preferences
  FOR INSERT WITH CHECK (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "scheduling_preferences_update_own" ON scheduling_preferences
  FOR UPDATE USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "scheduling_preferences_delete_own" ON scheduling_preferences
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');

-- Scheduling rules: full CRUD on own rows
CREATE POLICY "scheduling_rules_select_own" ON scheduling_rules
  FOR SELECT USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "scheduling_rules_insert_own" ON scheduling_rules
  FOR INSERT WITH CHECK (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "scheduling_rules_update_own" ON scheduling_rules
  FOR UPDATE USING (user_id = auth.jwt() ->> 'sub');
CREATE POLICY "scheduling_rules_delete_own" ON scheduling_rules
  FOR DELETE USING (user_id = auth.jwt() ->> 'sub');

-- ============================================================
-- SERVICE ROLE POLICY (for webhook user sync)
-- ============================================================

-- Allow service role to insert/update users (used by Clerk webhook)
CREATE POLICY "users_service_insert" ON users
  FOR INSERT WITH CHECK (true);
