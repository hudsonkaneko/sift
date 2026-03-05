'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, Search, Send, Trash2, Pencil, ArrowLeft } from 'lucide-react';
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
}: Props) {
  const { user } = useUser();
  const [input, setInput] = useState('');
  const [showSessions, setShowSessions] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!showSessions) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sessionListRef.current && !sessionListRef.current.contains(e.target as Node)) {
        setShowSessions(false);
        setEditingSessionId(null);
      }
    };
    const timer = setTimeout(() => window.addEventListener('mousedown', handleClickOutside), 0);
    return () => { clearTimeout(timer); window.removeEventListener('mousedown', handleClickOutside); };
  }, [showSessions]);

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

  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <>
      {/* Sidebar header */}
      <div className="px-5 pt-5 pb-3">
        <div className="mb-6">
          {projectScope ? (
            <button
              onClick={onExitProjectScope}
              className="flex items-center gap-2 text-text-primary hover:text-accent transition-colors group"
            >
              <ArrowLeft size={18} className="text-text-muted group-hover:text-accent transition-colors" />
              <span className="text-base font-semibold truncate max-w-[280px]">{projectScope.taskName}</span>
            </button>
          ) : (
            <span className="text-xl font-bold text-accent">Sift</span>
          )}
        </div>

        <div className="space-y-0.5">
          <button
            onClick={() => { onCreateSession(); setShowSessions(false); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <Plus size={16} className="text-accent" />
            New Session
          </button>
          <button
            onClick={() => setShowSessions(!showSessions)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            <Search size={16} className="text-accent" />
            Search
          </button>
        </div>
      </div>

      {/* Session dropdown */}
      {showSessions && (
        <div ref={sessionListRef} className="px-4 pb-2">
          <div className="bg-bg-secondary border border-border rounded-xl p-2 max-h-[200px] overflow-y-auto space-y-0.5 shadow-sm">
            {sessions.map(session => (
              <div
                key={session.id}
                className={`group flex items-center px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
                  session.id === activeSessionId
                    ? 'bg-accent-light text-accent font-medium'
                    : 'text-text-secondary hover:bg-bg-tertiary'
                }`}
                onClick={() => {
                  if (editingSessionId !== session.id) {
                    onSwitchSession(session.id);
                    setShowSessions(false);
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
            ))}
          </div>
        </div>
      )}

      {/* Current session label */}
      <div className="px-5 py-2 flex items-center justify-between border-b border-border-light">
        <span className="text-xs font-medium text-text-muted truncate">
          {activeSession?.name || 'No session'}
        </span>
        {messages.length > 0 && (
          <button onClick={onClear} className="text-xs text-text-muted hover:text-text-secondary transition-colors">
            Clear
          </button>
        )}
      </div>

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
