'use client';

import useSWR from 'swr';
import { apiFetch } from '@/lib/utils/api';
import { mapPreferences } from '@/lib/utils/db';
import type { SchedulingPreferences } from '@/lib/types/domain';

const fetcher = (url: string) => apiFetch<unknown>(url).then(mapPreferences);

export function usePreferences() {
  const { data: preferences, error, isLoading, mutate } = useSWR('/api/preferences', fetcher);

  const updatePreferences = async (updates: Partial<SchedulingPreferences>) => {
    const data = await apiFetch<unknown>('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    const mapped = mapPreferences(data);
    mutate(mapped, false);
    return mapped;
  };

  return {
    preferences,
    isLoading,
    error,
    updatePreferences,
  };
}
