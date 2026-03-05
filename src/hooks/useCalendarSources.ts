'use client';

import useSWR from 'swr';
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '@/lib/utils/api';
import type { GoogleCalendarSource } from '@/lib/types/domain';

const STORAGE_KEY = 'sift-calendar-visibility';

export interface CalendarVisibility {
  fixedBlocks: boolean;
  googleCalendars: Record<string, boolean>;
}

const DEFAULT_VISIBILITY: CalendarVisibility = {
  fixedBlocks: true,
  googleCalendars: {},
};

function loadVisibility(): CalendarVisibility {
  if (typeof window === 'undefined') return DEFAULT_VISIBILITY;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBILITY;
    return { ...DEFAULT_VISIBILITY, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_VISIBILITY;
  }
}

function saveVisibility(v: CalendarVisibility) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
}

const fetcher = (url: string) => apiFetch<GoogleCalendarSource[]>(url);

export function useCalendarSources(hasAccounts: boolean) {
  const { data: sources, mutate } = useSWR(
    hasAccounts ? '/api/google-calendar/calendars' : null,
    fetcher,
  );

  const [visibility, setVisibility] = useState<CalendarVisibility>(DEFAULT_VISIBILITY);

  // Load from localStorage on mount
  useEffect(() => {
    setVisibility(loadVisibility());
  }, []);

  const toggleFixedBlocks = useCallback(() => {
    setVisibility(prev => {
      const next = { ...prev, fixedBlocks: !prev.fixedBlocks };
      saveVisibility(next);
      return next;
    });
  }, []);

  const toggleGoogleCalendar = useCallback((googleCalendarId: string) => {
    setVisibility(prev => {
      const current = prev.googleCalendars[googleCalendarId] ?? true;
      const next = {
        ...prev,
        googleCalendars: { ...prev.googleCalendars, [googleCalendarId]: !current },
      };
      saveVisibility(next);
      return next;
    });
  }, []);

  const isGoogleCalendarVisible = useCallback((googleCalendarId: string) => {
    return visibility.googleCalendars[googleCalendarId] ?? true;
  }, [visibility.googleCalendars]);

  const toggleScheduling = useCallback(async (sourceId: string) => {
    const source = sources?.find(s => s.id === sourceId);
    if (!source) return;
    const newValue = !source.affectsScheduling;

    // Optimistically update
    mutate(
      sources?.map(s => s.id === sourceId ? { ...s, affectsScheduling: newValue } : s),
      false,
    );

    await apiFetch(`/api/google-calendar/calendars/${sourceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ affectsScheduling: newValue }),
    });

    mutate();
  }, [sources, mutate]);

  return {
    sources: sources || [],
    visibility,
    toggleFixedBlocks,
    toggleGoogleCalendar,
    toggleScheduling,
    isGoogleCalendarVisible,
    mutateSources: mutate,
  };
}
