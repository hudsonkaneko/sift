'use client';

import { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/utils/api';
import { mapScheduledSlot, mapFixedBlock } from '@/lib/utils/db';
import type { ScheduledSlotWithTask, FixedBlock, Task } from '@/lib/types/domain';

function getSunday(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().split('T')[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapSlotWithTask(row: any): ScheduledSlotWithTask {
  const slot = mapScheduledSlot(row);
  return {
    ...slot,
    task: row.tasks ? {
      id: row.tasks.id,
      userId: row.tasks.user_id,
      name: row.tasks.name,
      category: row.tasks.category,
      estimatedMinutes: row.tasks.estimated_minutes,
      deadline: row.tasks.deadline,
      recurrence: row.tasks.recurrence,
      completed: row.tasks.completed,
      color: row.tasks.color,
      parentId: row.tasks.parent_id,
      urgency: row.tasks.urgency,
      createdAt: row.tasks.created_at,
      updatedAt: row.tasks.updated_at,
    } : null as unknown as Task,
  };
}

const slotsFetcher = async (url: string) => {
  const rows = await apiFetch<unknown[]>(url);
  return rows.map(mapSlotWithTask);
};

const blocksFetcher = async (url: string) => {
  const rows = await apiFetch<unknown[]>(url);
  return rows.map(mapFixedBlock);
};

export function useSchedule() {
  const [weekOffset, setWeekOffset] = useState(0);

  const weekOf = useMemo(() => {
    const now = new Date();
    now.setDate(now.getDate() + weekOffset * 7);
    return getSunday(now);
  }, [weekOffset]);

  const {
    data: slots,
    mutate: mutateSlots,
  } = useSWR(`/api/scheduled-slots?weekOf=${weekOf}`, slotsFetcher);

  const {
    data: fixedBlocks,
    mutate: mutateBlocks,
  } = useSWR('/api/fixed-blocks', blocksFetcher);

  const navigateWeek = useCallback((delta: number) => {
    setWeekOffset(prev => prev + delta);
  }, []);

  const goToToday = useCallback(() => {
    setWeekOffset(0);
  }, []);

  const updateSlot = useCallback(async (
    id: string,
    updates: {
      dayOfWeek?: number;
      startHour?: number;
      startMinute?: number;
      endHour?: number;
      endMinute?: number;
      locked?: boolean;
      taskId?: string;
    },
  ) => {
    await apiFetch(`/api/scheduled-slots/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    mutateSlots();
  }, [mutateSlots]);

  const deleteSlot = useCallback(async (id: string) => {
    await apiFetch(`/api/scheduled-slots/${id}`, { method: 'DELETE' });
    mutateSlots();
  }, [mutateSlots]);

  const mergeMove = useCallback(async (
    slotId: string,
    targetDay: number,
    targetStartHour: number,
    targetStartMinute: number,
  ) => {
    await apiFetch('/api/scheduled-slots/merge-move', {
      method: 'POST',
      body: JSON.stringify({ slotId, targetDay, targetStartHour, targetStartMinute, weekOf }),
    });
    mutateSlots();
  }, [weekOf, mutateSlots]);

  const isCurrentWeek = useMemo(() => {
    return weekOf === getSunday(new Date());
  }, [weekOf]);

  return {
    weekOf,
    slots: slots || [],
    fixedBlocks: fixedBlocks || [],
    isCurrentWeek,
    navigateWeek,
    goToToday,
    updateSlot,
    deleteSlot,
    mergeMove,
    mutateSlots,
    mutateBlocks,
  };
}
