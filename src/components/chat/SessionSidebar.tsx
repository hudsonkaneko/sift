'use client';

import { useState } from 'react';
import { Plus, Search, Pencil, Trash2, FolderOpen } from 'lucide-react';
import type { ChatSession } from '@/lib/types/domain';

interface Props {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSwitchSession: (id: string) => void;
  onCreateSession: () => void;
  onRenameSession: (id: string, name: string) => void;
  onDeleteSession: (id: string) => void;
  onEnterProjectScope: (taskId: string, taskName: string, sessionId: string) => void;
}

export default function SessionSidebar({
  sessions,
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  onRenameSession,
  onDeleteSession,
  onEnterProjectScope,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const query = searchQuery.toLowerCase();
  const allFiltered = sessions.filter(s => s.name.toLowerCase().includes(query));
  const generalSessions = allFiltered.filter(s => !s.taskId);
  const projectGroups = new Map<string, { taskName: string; sessions: ChatSession[] }>();
  for (const s of allFiltered) {
    if (s.taskId) {
      const existing = projectGroups.get(s.taskId);
      if (existing) {
        existing.sessions.push(s);
      } else {
        projectGroups.set(s.taskId, { taskName: s.taskName || 'Untitled Project', sessions: [s] });
      }
    }
  }

  const renderSession = (session: ChatSession, isProject: boolean) => (
    <div
      key={session.id}
      className={`group flex items-center ${isProject ? 'pl-7 pr-3' : 'px-3'} py-1.5 rounded-lg text-sm cursor-pointer transition-colors ${
        session.id === activeSessionId
          ? 'bg-accent-light text-accent font-medium'
          : 'text-text-secondary hover:bg-bg-tertiary'
      }`}
      onClick={() => {
        if (editingSessionId !== session.id) {
          if (isProject && session.taskId && session.taskName) {
            onEnterProjectScope(session.taskId, session.taskName, session.id);
          } else {
            onSwitchSession(session.id);
          }
        }
      }}
    >
      {editingSessionId === session.id ? (
        <input
          value={editName}
          onChange={e => setEditName(e.target.value)}
          onBlur={() => { if (editName.trim()) onRenameSession(session.id, editName.trim()); setEditingSessionId(null); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { if (editName.trim()) onRenameSession(session.id, editName.trim()); setEditingSessionId(null); }
            if (e.key === 'Escape') setEditingSessionId(null);
          }}
          className="bg-bg-primary border border-border rounded-lg px-2 py-1 text-sm text-text-primary outline-none focus:border-accent w-full"
          autoFocus
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <>
          <span className="truncate flex-1">{session.name}</span>
          <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
            <button
              className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-text-secondary transition-colors"
              onClick={e => { e.stopPropagation(); setEditingSessionId(session.id); setEditName(session.name); }}
              title="Rename"
            >
              <Pencil size={12} />
            </button>
            {sessions.length > 1 && (
              <button
                className="p-1 rounded-md hover:bg-bg-hover text-text-muted hover:text-red-400 transition-colors"
                onClick={e => { e.stopPropagation(); onDeleteSession(session.id); }}
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="w-[220px] min-w-[220px] h-full flex flex-col bg-bg-secondary border-r border-border">
      {/* New chat button */}
      <div className="px-3 pt-4 pb-2">
        <button
          onClick={onCreateSession}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-text-primary hover:bg-bg-tertiary transition-colors border border-border"
        >
          <Plus size={14} className="text-accent" />
          New Chat
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-primary text-xs">
          <Search size={12} className="text-text-muted flex-shrink-0" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="bg-transparent outline-none text-text-primary placeholder-text-muted flex-1 min-w-0"
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {generalSessions.map(s => renderSession(s, false))}
        {projectGroups.size > 0 && generalSessions.length > 0 && (
          <div className="border-t border-border my-1.5" />
        )}
        {Array.from(projectGroups.entries()).map(([taskId, group]) => (
          <div key={taskId}>
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-muted select-none">
              <FolderOpen size={12} />
              <span className="truncate">{group.taskName}</span>
            </div>
            {group.sessions.map(s => renderSession(s, true))}
          </div>
        ))}
        {allFiltered.length === 0 && (
          <div className="px-3 py-2 text-xs text-text-muted">No sessions found</div>
        )}
      </div>
    </div>
  );
}
