'use client';

import useSWR from 'swr';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/utils/api';
import type { GoogleCalendarAccount } from '@/lib/types/domain';

const fetcher = (url: string) => apiFetch<{ accounts: GoogleCalendarAccount[] }>(url);

export function useGoogleCalendar() {
  const { data, error, isLoading, mutate } = useSWR('/api/google-calendar/status', fetcher);
  const [syncing, setSyncing] = useState(false);

  // Re-fetch status when redirected back from OAuth with ?gcal=connected or ?gcal=error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcalParam = params.get('gcal');
    if (gcalParam) {
      console.log('[useGoogleCalendar] detected ?gcal=' + gcalParam + ', re-fetching status...');
      mutate();
      // Clean up the query param
      const url = new URL(window.location.href);
      url.searchParams.delete('gcal');
      window.history.replaceState({}, '', url.pathname);
    }
  }, [mutate]);

  const accounts = data?.accounts ?? [];
  const hasAccounts = accounts.length > 0;

  // Debug: log whenever connection state changes
  useEffect(() => {
    console.log('[useGoogleCalendar] state:', { hasAccounts, accountCount: accounts.length, error: error?.message, isLoading });
  }, [hasAccounts, accounts.length, error, isLoading]);

  const sync = async (weekOf: string) => {
    console.log(`[useGoogleCalendar] sync called with weekOf=${weekOf}`);
    setSyncing(true);
    try {
      const result = await apiFetch<{ synced: number }>('/api/google-calendar/sync', {
        method: 'POST',
        body: JSON.stringify({ weekOf }),
      });
      console.log('[useGoogleCalendar] sync result:', result);
    } catch (e) {
      console.error('[useGoogleCalendar] sync error:', e);
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async (googleEmail: string) => {
    await apiFetch('/api/google-calendar/disconnect', {
      method: 'POST',
      body: JSON.stringify({ googleEmail }),
    });
    mutate();
  };

  return { accounts, hasAccounts, syncing, isLoading, error, sync, disconnect, mutate };
}
