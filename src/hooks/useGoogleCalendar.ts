'use client';

import useSWR from 'swr';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/utils/api';

const fetcher = (url: string) => apiFetch<{ connected: boolean }>(url);

export function useGoogleCalendar() {
  const { data, error, isLoading, mutate } = useSWR('/api/google-calendar/status', fetcher);
  const [syncing, setSyncing] = useState(false);

  // Re-fetch status when redirected back from OAuth with ?gcal=connected
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('gcal') === 'connected') {
      mutate();
      // Clean up the query param
      const url = new URL(window.location.href);
      url.searchParams.delete('gcal');
      window.history.replaceState({}, '', url.pathname);
    }
  }, [mutate]);

  const isConnected = data?.connected ?? false;

  const sync = async (weekOf: string) => {
    setSyncing(true);
    try {
      await apiFetch<{ synced: number }>('/api/google-calendar/sync', {
        method: 'POST',
        body: JSON.stringify({ weekOf }),
      });
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    await apiFetch('/api/google-calendar/disconnect', { method: 'POST' });
    mutate();
  };

  return { isConnected, syncing, isLoading, error, sync, disconnect, mutate };
}
