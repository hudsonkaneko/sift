'use client';

import useSWR from 'swr';
import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/utils/api';
import type { GoogleCalendarAccount } from '@/lib/types/domain';

const fetcher = (url: string) => apiFetch<{ accounts: GoogleCalendarAccount[] }>(url);

export function useGoogleCalendar() {
  const { data, error, isLoading, mutate } = useSWR('/api/google-calendar/status', fetcher);
  const [syncing, setSyncing] = useState(false);

  const [connectionError, setConnectionError] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Re-fetch status when redirected back from OAuth with ?gcal=connected or ?gcal=error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gcalParam = params.get('gcal');
    if (gcalParam) {
      console.log('[useGoogleCalendar] detected ?gcal=' + gcalParam + ', re-fetching status...');
      if (gcalParam === 'error') {
        setConnectionError(true);
      }
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
      const result = await apiFetch<{ synced: number; failedCalendars?: string[]; accountFailures?: { email: string; reason: string }[] }>('/api/google-calendar/sync', {
        method: 'POST',
        body: JSON.stringify({ weekOf }),
      });
      console.log('[useGoogleCalendar] sync result:', result);
      if (result.failedCalendars?.length || result.accountFailures?.length) {
        const n = (result.failedCalendars?.length ?? 0) + (result.accountFailures?.length ?? 0);
        setSyncError(`${n} calendar${n === 1 ? '' : 's'} couldn't refresh — showing last-known events`);
      } else {
        setSyncError(null);
      }
    } catch (e) {
      console.error('[useGoogleCalendar] sync error:', e);
      const msg = e instanceof Error ? e.message : 'Google Calendar sync failed';
      setSyncError(msg);
    } finally {
      setSyncing(false);
    }
  };

  const dismissSyncError = () => setSyncError(null);

  const disconnect = async (googleEmail: string) => {
    // Optimistic: remove account from list instantly
    const optimistic = { accounts: accounts.filter(a => a.googleEmail !== googleEmail) };
    mutate(optimistic, false);

    apiFetch('/api/google-calendar/disconnect', {
      method: 'POST',
      body: JSON.stringify({ googleEmail }),
    }).then(() => mutate());
  };

  return { accounts, hasAccounts, syncing, isLoading, error, connectionError, setConnectionError, syncError, dismissSyncError, sync, disconnect, mutate };
}
