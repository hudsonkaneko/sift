'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, Search, Send, Trash2, Pencil, ArrowLeft, FolderOpen, Settings, PanelLeft } from 'lucide-react';
import { UserButton } from '@clerk/nextjs';
import { useUser } from '@clerk/nextjs';
import type { ChatMessage, ChatSession } from '@/lib/types/domain';
import MultipleChoiceWidget from './MultipleChoiceWidget';

interface FollowUpQuestion {
  question: string;
  options: string[];
}

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

export default function ChatPanel({
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
  const { user } = useUser();
  const [input, setInput] = useState('');
  const [showSessions, setShowSessions] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    await onSend(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const userInitials = user
    ? (user.firstName?.[0] || '') + (user.lastName?.[0] || '') || user.emailAddresses[0]?.emailAddress[0]?.toUpperCase() || '?'
    : '?';

  return (
    <>
      {/* Sidebar header */}
      <div className="px-5 pt-5 pb-3">
        <div className="mb-6 flex items-center justify-between">
          {projectScope ? (
            <button
              onClick={onExitProjectScope}
              className="flex items-center gap-2 text-text-primary hover:text-accent transition-colors group"
            >
              <ArrowLeft size={18} className="text-text-muted group-hover:text-accent transition-colors" />
              <span className="text-base font-semibold truncate max-w-[280px]">{projectScope.taskName}</span>
            </button>
          ) : (
            <img src="/logo.png" alt="Sift" className="w-9 h-9 rounded-xl" />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSessions(v => !v)}
              className={`p-1.5 rounded-lg hover:bg-bg-hover transition-colors ${showSessions ? 'text-accent' : 'text-text-secondary'}`}
              aria-label="Toggle sessions"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            <button
              onClick={onSettingsClick}
              className="p-1.5 rounded-lg hover:bg-bg-hover text-text-secondary transition-colors"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>

        <button
          onClick={onCreateSession}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          <Plus size={16} className="text-accent" />
          New Chat
        </button>
      </div>

      {/* Collapsible session list */}
      {showSessions && (() => {
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
          <div className="flex-shrink-0 overflow-y-auto max-h-[40vh] border-b border-border">
            {/* Search/filter input */}
            <div className="px-4 pt-2 pb-1.5">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-bg-secondary text-xs">
                <Search size={12} className="text-text-muted flex-shrink-0" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Filter..."
                  className="bg-transparent outline-none text-text-primary placeholder-text-muted flex-1 min-w-0"
                />
                {(searchQuery || messages.length > 0) && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="text-text-muted hover:text-text-secondary transition-colors"
                      >
                        Clear
                      </button>
                    )}
                    {messages.length > 0 && (
                      <button
                        onClick={onClear}
                        className="text-text-muted hover:text-text-secondary transition-colors"
                      >
                        Clear chat
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* Session items */}
            <div className="px-2 pb-2 space-y-0.5">
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
      })()}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-text-muted text-sm space-y-3 mt-8">
            <p className="text-text-secondary font-medium">Try something like:</p>
            <p className="text-sm text-text-secondary bg-bg-tertiary rounded-2xl p-4 leading-relaxed">
              &ldquo;I need to write my WRIT 340 paper by Friday, work on the Axion pitch deck for 4 hours, and do Japanese homework every day for 30 minutes&rdquo;
            </p>
            <p className="text-sm text-text-secondary bg-bg-tertiary rounded-2xl p-4 leading-relaxed">
              &ldquo;Add a Project Play brainstorm session, 2 hours, sometime this week&rdquo;
            </p>
          </div>
        )}
        {messages.map((msg, msgIndex) => {
          const isAssistant = msg.role === 'assistant';
          const followUp = isAssistant
            ? (msg.metadata?.followUpQuestion as FollowUpQuestion | undefined) || null
            : null;
          const isLastAssistant = isAssistant && msgIndex === messages.length - 1;

          return (
            <div
              key={msg.id}
              className={`flex items-end gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'user' ? (
                <>
                  <div className="max-w-[80%] bg-bg-tertiary text-text-primary rounded-2xl rounded-br-md px-4 py-3 text-sm leading-relaxed">
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-semibold">{userInitials}</span>
                  </div>
                </>
              ) : (
                <div className="max-w-[90%] text-sm leading-relaxed text-text-primary px-1 py-1">
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {followUp && (
                    <MultipleChoiceWidget
                      question={followUp.question}
                      options={followUp.options}
                      onSelect={(answer) => onSend(answer)}
                      disabled={loading || !isLastAssistant}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
        {loading && (
          <div className="flex items-center gap-2 px-1 py-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-accent/40 animate-pulse" />
              <div className="w-2 h-2 rounded-full bg-accent/40 animate-pulse [animation-delay:150ms]" />
              <div className="w-2 h-2 rounded-full bg-accent/40 animate-pulse [animation-delay:300ms]" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="px-4 py-4">
        <div className="flex items-end gap-2 bg-bg-secondary border border-border rounded-2xl px-4 py-3 shadow-sm">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Write something"
            rows={1}
            className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted resize-none outline-none max-h-[120px]"
          />
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || loading}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-accent hover:bg-accent-dim text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </>
  );
}
