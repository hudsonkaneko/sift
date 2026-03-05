'use client';

import ChatPanel from '@/components/chat/ChatPanel';
import type { ChatMessage, ChatSession } from '@/lib/types/domain';

interface Props {
  messages: ChatMessage[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSend: (message: string) => Promise<void>;
  onClear: () => void;
  onSwitchSession: (id: string) => void;
  onCreateSession: () => void;
  onRenameSession: (id: string, name: string) => void;
  onDeleteSession: (id: string) => void;
  loading: boolean;
  projectScope: { taskId: string; taskName: string } | null;
  onExitProjectScope: () => void;
  onEnterProjectScope: (taskId: string, taskName: string, sessionId: string) => void;
  onSettingsClick: () => void;
}

export default function Sidebar({
  messages,
  sessions,
  activeSessionId,
  onSend,
  onClear,
  onSwitchSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
  loading,
  projectScope,
  onExitProjectScope,
  onEnterProjectScope,
  onSettingsClick,
}: Props) {
  return (
    <div className="w-[400px] min-w-[360px] flex flex-col bg-bg-primary border-r border-border">
      <ChatPanel
        messages={messages}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSend={onSend}
        onClear={onClear}
        onSwitchSession={onSwitchSession}
        onCreateSession={onCreateSession}
        onRenameSession={onRenameSession}
        onDeleteSession={onDeleteSession}
        loading={loading}
        projectScope={projectScope}
        onExitProjectScope={onExitProjectScope}
        onEnterProjectScope={onEnterProjectScope}
        onSettingsClick={onSettingsClick}
      />
    </div>
  );
}
