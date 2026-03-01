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
    // Optimistic update: immediately reflect the change in the UI
    mutateSlots(
      (current) => {
        if (!current) return current;
        return current.map(slot => {
          if (slot.id !== id) return slot;
          return {
            ...slot,
            ...(updates.dayOfWeek !== undefined && { dayOfWeek: updates.dayOfWeek }),
            ...(updates.startHour !== undefined && { startHour: updates.startHour }),
            ...(updates.startMinute !== undefined && { startMinute: updates.startMinute }),
            ...(updates.endHour !== undefined && { endHour: updates.endHour }),
            ...(updates.endMinute !== undefined && { endMinute: updates.endMinute }),
            ...(updates.locked !== undefined && { locked: updates.locked }),
            ...(updates.taskId !== undefined && { taskId: updates.taskId }),
          };
        });
      },
      { revalidate: false },
    );

    try {
      await apiFetch(`/api/scheduled-slots/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    } finally {
      mutateSlots();
    }
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
    // Optimistic update: move the primary slot immediately, remove siblings
    mutateSlots(
      (current) => {
        if (!current) return current;
        const primary = current.find(s => s.id === slotId);
        if (!primary) return current;
        const siblings = current.filter(s => s.taskId === primary.taskId);
        let totalMin = 0;
        for (const s of siblings) {
          totalMin += (s.endHour * 60 + s.endMinute) - (s.startHour * 60 + s.startMinute);
        }
        const startMin = targetStartHour * 60 + targetStartMinute;
        const endMin = Math.min(startMin + totalMin, 24 * 60);
        return [
          ...current.filter(s => s.taskId !== primary.taskId),
          {
            ...primary,
            dayOfWeek: targetDay,
            startHour: Math.floor(startMin / 60),
            startMinute: startMin % 60,
            endHour: Math.floor(endMin / 60),
            endMinute: endMin % 60,
            locked: true,
          },
        ];
      },
      { revalidate: false },
    );

    try {
      await apiFetch('/api/scheduled-slots/merge-move', {
        method: 'POST',
        body: JSON.stringify({ slotId, targetDay, targetStartHour, targetStartMinute, weekOf }),
      });
    } finally {
      mutateSlots();
    }
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
