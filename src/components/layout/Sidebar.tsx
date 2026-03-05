'use client';

import { useState } from 'react';
import ChatPanel from '@/components/chat/ChatPanel';
import SessionSidebar from '@/components/chat/SessionSidebar';
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
  const [showSessions, setShowSessions] = useState(true);

  return (
    <div className="flex h-full overflow-hidden border-r border-border">
      {/* Session list sidebar */}
      {showSessions && (
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSwitchSession={onSwitchSession}
          onCreateSession={onCreateSession}
          onRenameSession={onRenameSession}
          onDeleteSession={onDeleteSession}
          onEnterProjectScope={onEnterProjectScope}
        />
      )}

      {/* Chat panel */}
      <div className={`${showSessions ? 'w-[360px]' : 'w-[400px]'} h-full min-h-0 flex flex-col bg-bg-primary`}>
        <ChatPanel
          messages={messages}
          onSend={onSend}
          onClear={onClear}
          loading={loading}
          projectScope={projectScope}
          onExitProjectScope={onExitProjectScope}
          onSettingsClick={onSettingsClick}
          showSessions={showSessions}
          onToggleSessions={() => setShowSessions(v => !v)}
        />
      </div>
    </div>
  );
}
