'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/utils/api';
import type { ChatSession, ChatMessage } from '@/lib/types/domain';

const sessionsFetcher = (url: string) => apiFetch<ChatSession[]>(url);

export function useChat() {
  const [projectScope, setProjectScope] = useState<{ taskId: string; taskName: string } | null>(null);

  const sessionsKey = projectScope
    ? `/api/chat/sessions?taskId=${projectScope.taskId}`
    : '/api/chat/sessions';

  const { data: sessions, mutate: mutateSessions } = useSWR(sessionsKey, sessionsFetcher);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  // Auto-select first session when sessions load
  const effectiveSessionId = activeSessionId || sessions?.[0]?.id || null;

  const fetchMessages = useCallback(async (sessionId: string) => {
    // Skip fetching for temporary optimistic session IDs
    if (sessionId.startsWith('temp-')) return;

    const rows = await apiFetch<Array<Record<string, unknown>>>(`/api/chat/sessions/${sessionId}/messages`);
    const mapped: ChatMessage[] = rows.map(r => ({
      id: r.id as string,
      sessionId: r.session_id as string,
      userId: r.user_id as string,
      role: r.role as 'user' | 'assistant',
      content: r.content as string,
      metadata: (r.metadata || {}) as Record<string, unknown>,
      createdAt: r.created_at as string,
    }));
    setMessages(mapped);
  }, []);

  const switchSession = useCallback(async (id: string) => {
    setActiveSessionId(id);
    await fetchMessages(id);
  }, [fetchMessages]);

  const createSession = useCallback(async () => {
    const body: Record<string, string> = { name: 'New Chat' };
    if (projectScope) {
      body.taskId = projectScope.taskId;
    }

    // Optimistic: add temp session immediately
    const tempId = `temp-${Date.now()}`;
    const tempSession: ChatSession = {
      id: tempId,
      userId: '',
      name: 'New Chat',
      taskId: projectScope?.taskId || null,
      taskName: projectScope?.taskName || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mutateSessions([tempSession, ...(sessions || [])], false);
    setActiveSessionId(tempId);
    setMessages([]);

    const data = await apiFetch<{ id: string }>('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await mutateSessions();
    setActiveSessionId(data.id);
  }, [mutateSessions, sessions, projectScope]);

  const renameSession = useCallback(async (id: string, name: string) => {
    // Optimistic: update session name instantly
    const optimistic = (sessions || []).map(s =>
      s.id === id ? { ...s, name } : s
    );
    mutateSessions(optimistic, false);

    apiFetch(`/api/chat/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }).then(() => mutateSessions());
  }, [sessions, mutateSessions]);

  const deleteSession = useCallback(async (id: string) => {
    // Optimistic: remove session instantly
    const optimistic = (sessions || []).filter(s => s.id !== id);
    mutateSessions(optimistic, false);

    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
    }

    apiFetch(`/api/chat/sessions/${id}`, { method: 'DELETE' }).then(() => mutateSessions());
  }, [activeSessionId, sessions, mutateSessions]);

  const sendMessage = useCallback(async (text: string) => {
    if (!effectiveSessionId || loading) return;

    // Optimistic: add user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      sessionId: effectiveSessionId,
      userId: '',
      role: 'user',
      content: text,
      metadata: {},
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);
    setLoading(true);

    try {
      const result = await apiFetch<{ message: string; sessionName?: string; followUpQuestion?: { question: string; options: string[] } }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: text, sessionId: effectiveSessionId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      });

      // Refresh messages from server to get real IDs
      await fetchMessages(effectiveSessionId);
      // Refresh session list if the session was auto-renamed
      if (result.sessionName) {
        mutateSessions();
      }
    } catch {
      // Refresh to show error message saved by server
      await fetchMessages(effectiveSessionId);
    } finally {
      setLoading(false);
    }
  }, [effectiveSessionId, loading, fetchMessages]);

  const clearMessages = useCallback(async () => {
    if (!effectiveSessionId) return;
    // Optimistic: clear messages instantly
    setMessages([]);
    apiFetch(`/api/chat/sessions/${effectiveSessionId}/messages`, { method: 'DELETE' });
  }, [effectiveSessionId]);

  const createProjectChat = useCallback(async (taskId: string, taskName: string) => {
    setProjectScope({ taskId, taskName });
    setActiveSessionId(null);
    setMessages([]);
    // Create the first session for this project
    const data = await apiFetch<{ id: string }>('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Chat', taskId }),
    });
    await mutateSessions();
    setActiveSessionId(data.id);
  }, [mutateSessions]);

  const enterProjectScope = useCallback(async (taskId: string, taskName: string, sessionId: string) => {
    setProjectScope({ taskId, taskName });
    setActiveSessionId(sessionId);
    await fetchMessages(sessionId);
  }, [fetchMessages]);

  const exitProjectScope = useCallback(() => {
    setProjectScope(null);
    setActiveSessionId(null);
    setMessages([]);
  }, []);

  return {
    sessions: sessions || [],
    activeSessionId: effectiveSessionId,
    messages,
    loading,
    projectScope,
    switchSession,
    createSession,
    renameSession,
    deleteSession,
    sendMessage,
    clearMessages,
    fetchMessages,
    createProjectChat,
    enterProjectScope,
    exitProjectScope,
  };
}
