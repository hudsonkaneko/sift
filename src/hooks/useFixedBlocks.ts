'use client';

import useSWR from 'swr';
import { apiFetch } from '@/lib/utils/api';
import { mapFixedBlock } from '@/lib/utils/db';
import type { FixedBlock } from '@/lib/types/domain';

const fetcher = (url: string) => apiFetch<unknown[]>(url).then(rows => rows.map(mapFixedBlock));

export function useFixedBlocks() {
  const { data: fixedBlocks, error, isLoading, mutate } = useSWR('/api/fixed-blocks', fetcher);

  const addFixedBlock = async (block: Omit<FixedBlock, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) => {
    await apiFetch('/api/fixed-blocks', {
      method: 'POST',
      body: JSON.stringify(block),
    });
    mutate();
  };

  const updateFixedBlock = async (id: string, updates: Partial<FixedBlock>) => {
    // Optimistic update: immediately reflect the change in the UI
    mutate(
      (current) => {
        if (!current) return current;
        return current.map(block => {
          if (block.id !== id) return block;
          return { ...block, ...updates };
        });
      },
      { revalidate: false },
    );

    try {
      await apiFetch(`/api/fixed-blocks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    } finally {
      mutate();
    }
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
