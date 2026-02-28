'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/utils/api';
import type { ChatSession, ChatMessage } from '@/lib/types/domain';

const sessionsFetcher = (url: string) => apiFetch<ChatSession[]>(url);

export function useChat() {
  const { data: sessions, mutate: mutateSessions } = useSWR('/api/chat/sessions', sessionsFetcher);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  // Auto-select first session when sessions load
  const effectiveSessionId = activeSessionId || sessions?.[0]?.id || null;

  const fetchMessages = useCallback(async (sessionId: string) => {
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
    const data = await apiFetch<{ id: string }>('/api/chat/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: 'New Chat' }),
    });
    await mutateSessions();
    setActiveSessionId(data.id);
    setMessages([]);
  }, [mutateSessions]);

  const renameSession = useCallback(async (id: string, name: string) => {
    await apiFetch(`/api/chat/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    mutateSessions();
  }, [mutateSessions]);

  const deleteSession = useCallback(async (id: string) => {
    await apiFetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
    await mutateSessions();
    if (activeSessionId === id) {
      setActiveSessionId(null);
      setMessages([]);
    }
  }, [activeSessionId, mutateSessions]);

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
      const result = await apiFetch<{ message: string; followUpQuestion?: { question: string; options: string[] } }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: text, sessionId: effectiveSessionId }),
      });

      // Refresh messages from server to get real IDs
      await fetchMessages(effectiveSessionId);
    } catch {
      // Refresh to show error message saved by server
      await fetchMessages(effectiveSessionId);
    } finally {
      setLoading(false);
    }
  }, [effectiveSessionId, loading, fetchMessages]);

  const clearMessages = useCallback(async () => {
    if (!effectiveSessionId) return;
    await apiFetch(`/api/chat/sessions/${effectiveSessionId}/messages`, { method: 'DELETE' });
    setMessages([]);
  }, [effectiveSessionId]);

  return {
    sessions: sessions || [],
    activeSessionId: effectiveSessionId,
    messages,
    loading,
    switchSession,
    createSession,
    renameSession,
    deleteSession,
    sendMessage,
    clearMessages,
    fetchMessages,
  };
}
