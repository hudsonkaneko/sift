'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, ArrowLeft, Settings, PanelLeft } from 'lucide-react';
import { UserButton, useUser } from '@clerk/nextjs';
import type { ChatMessage } from '@/lib/types/domain';
import MultipleChoiceWidget from './MultipleChoiceWidget';

interface FollowUpQuestion {
  question: string;
  options: string[];
}

interface Props {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  onClear: () => void;
  loading: boolean;
  projectScope: { taskId: string; taskName: string } | null;
  onExitProjectScope: () => void;
  onSettingsClick: () => void;
  showSessions: boolean;
  onToggleSessions: () => void;
}

export default function ChatPanel({
  messages,
  onSend,
  onClear,
  loading,
  projectScope,
  onExitProjectScope,
  onSettingsClick,
  showSessions,
  onToggleSessions,
}: Props) {
  const { user } = useUser();
  const [input, setInput] = useState('');
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
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center justify-between">
          {projectScope ? (
            <button
              onClick={onExitProjectScope}
              className="flex items-center gap-2 text-text-primary hover:text-accent transition-colors group"
            >
              <ArrowLeft size={18} className="text-text-muted group-hover:text-accent transition-colors" />
              <span className="text-base font-semibold truncate max-w-[280px]">{projectScope.taskName}</span>
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={onToggleSessions}
                className={`p-1.5 rounded-lg hover:bg-bg-hover transition-colors ${showSessions ? 'text-accent' : 'text-text-secondary'}`}
                aria-label="Toggle sessions"
              >
                <PanelLeft className="w-5 h-5" />
              </button>
              <img src="/logo.png" alt="Sift" className="w-8 h-8 rounded-xl" />
            </div>
          )}
          <div className="flex items-center gap-2">
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
    </div>
  );
}
