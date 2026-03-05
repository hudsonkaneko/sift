-- Add project-scoped chats: link chat_sessions to a parent task
ALTER TABLE chat_sessions ADD COLUMN task_id UUID REFERENCES tasks(id) ON DELETE CASCADE;
CREATE INDEX idx_chat_sessions_task_id ON chat_sessions(task_id);
