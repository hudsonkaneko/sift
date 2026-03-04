'use client';

import useSWR from 'swr';
import { apiFetch } from '@/lib/utils/api';
import { mapFixedBlock } from '@/lib/utils/db';
import type { FixedBlock } from '@/lib/types/domain';

const fetcher = (url: string) => apiFetch<unknown[]>(url).then(rows => {
  const blocks = rows.map(mapFixedBlock);
  const googleBlocks = blocks.filter(b => b.googleEventId);
  const userBlocks = blocks.filter(b => b.userCreated);
  console.log(`[useFixedBlocks] fetched ${blocks.length} blocks (${googleBlocks.length} google, ${userBlocks.length} user-created) from ${url}`);
  return blocks;
});

export function useFixedBlocks(weekOf?: string) {
  const key = weekOf ? `/api/fixed-blocks?weekOf=${weekOf}` : '/api/fixed-blocks';
  const { data: fixedBlocks, error, isLoading, mutate } = useSWR(key, fetcher);

  const addFixedBlock = async (block: Omit<FixedBlock, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'googleEventId' | 'googleCalendarId' | 'specificDate'>) => {
    await apiFetch('/api/fixed-blocks', {
      method: 'POST',
      body: JSON.stringify(block),
    });
    mutate();
  };

  const updateFixedBlock = async (id: string, updates: Partial<FixedBlock>) => {
    await apiFetch(`/api/fixed-blocks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    mutate();
  };

  const deleteFixedBlock = async (id: string) => {
    await apiFetch(`/api/fixed-blocks/${id}`, { method: 'DELETE' });
    mutate();
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
