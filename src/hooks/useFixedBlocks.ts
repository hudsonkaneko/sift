'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/utils/api';
import { mapFixedBlock } from '@/lib/utils/db';
import type { FixedBlock } from '@/lib/types/domain';

function lsCacheKey(weekOf?: string): string {
  return `sift:fixedBlocks:${weekOf || 'all'}`;
}

function readCache(weekOf?: string): FixedBlock[] | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(lsCacheKey(weekOf));
    if (raw) return JSON.parse(raw) as FixedBlock[];
  } catch { /* ignore corrupt cache */ }
  return undefined;
}

function writeCache(weekOf: string | undefined, blocks: FixedBlock[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(lsCacheKey(weekOf), JSON.stringify(blocks));
  } catch { /* ignore quota errors */ }
}

const fetcher = (url: string) => apiFetch<unknown[]>(url).then(rows => {
  const blocks = rows.map(mapFixedBlock);
  const googleBlocks = blocks.filter(b => b.googleEventId);
  const userBlocks = blocks.filter(b => b.userCreated);
  console.log(`[useFixedBlocks] fetched ${blocks.length} blocks (${googleBlocks.length} google, ${userBlocks.length} user-created) from ${url}`);
  return blocks;
});

export function useFixedBlocks(weekOf?: string) {
  const key = weekOf ? `/api/fixed-blocks?weekOf=${weekOf}` : '/api/fixed-blocks';
  const fallbackData = readCache(weekOf);
  const { data: fixedBlocks, error, isLoading, mutate } = useSWR(key, fetcher, {
    fallbackData,
  });

  // Persist fetched blocks to localStorage for instant render on next mount
  useEffect(() => {
    if (fixedBlocks && fixedBlocks.length > 0) {
      writeCache(weekOf, fixedBlocks);
    }
  }, [fixedBlocks, weekOf]);

  const addFixedBlock = async (block: Omit<FixedBlock, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'googleEventId' | 'googleCalendarId' | 'specificDate'>) => {
    // Optimistic: show block on calendar instantly
    const now = new Date().toISOString();
    const tempBlock: FixedBlock = {
      ...block,
      id: `temp-${Date.now()}`,
      userId: '',
      googleEventId: null,
      googleCalendarId: null,
      specificDate: null,
      createdAt: now,
      updatedAt: now,
    };
    mutate([...(fixedBlocks || []), tempBlock], false);

    apiFetch('/api/fixed-blocks', {
      method: 'POST',
      body: JSON.stringify(block),
    }).then(() => mutate());
  };

  const updateFixedBlock = async (id: string, updates: Partial<FixedBlock>) => {
    // Optimistic update: immediately apply changes in the UI
    const optimisticData = (fixedBlocks || []).map(b =>
      b.id === id ? { ...b, ...updates } : b
    );
    mutate(optimisticData, false);

    // Fire API call in background, then revalidate
    apiFetch(`/api/fixed-blocks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }).then(() => mutate());
  };

  const deleteFixedBlock = async (id: string) => {
    // Optimistic delete: immediately remove from UI
    const optimisticData = (fixedBlocks || []).filter(b => b.id !== id);
    mutate(optimisticData, false);

    // Fire API call in background, then revalidate
    apiFetch(`/api/fixed-blocks/${id}`, { method: 'DELETE' }).then(() => mutate());
  };

  return {
    fixedBlocks: fixedBlocks || [],
    isLoading,
    error,
    addFixedBlock,
    updateFixedBlock,
    deleteFixedBlock,
    mutate,
  };
}
