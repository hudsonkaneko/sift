'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { apiFetch } from '@/lib/utils/api';
import { mapScheduledSlot } from '@/lib/utils/db';
import { getSunday } from '@/lib/utils/date';
import type { ScheduledSlotWithTask, Task } from '@/lib/types/domain';

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

function getDateForDayOfWeek(weekOf: string, dayOfWeek: number): string {
  const d = new Date(weekOf + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dayOfWeek);
  return d.toISOString().split('T')[0];
}

const slotsFetcher = async (url: string) => {
  const rows = await apiFetch<unknown[]>(url);
  return rows.map(mapSlotWithTask);
};

export function useSchedule() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);

  const weekOf = useMemo(() => {
    const now = new Date();
    now.setDate(now.getDate() + weekOffset * 7);
    const result = getSunday(now);
    console.log(`[useSchedule] weekOf computed: now=${new Date().toISOString()}, offset=${weekOffset}, adjusted=${now.toISOString()}, getSunday→"${result}"`);
    return result;
  }, [weekOffset]);

  const {
    data: slots,
    error: slotsError,
    mutate: mutateSlots,
  } = useSWR(`/api/scheduled-slots?weekOf=${weekOf}`, slotsFetcher);

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
    // When dayOfWeek changes, also send scheduledDate so the server has it
    const patchBody: Record<string, unknown> = { ...updates };
    if (updates.dayOfWeek !== undefined) {
      patchBody.scheduledDate = getDateForDayOfWeek(weekOf, updates.dayOfWeek);
    }

    // Optimistic update: immediately move the slot in the UI
    const optimisticSlots = (slots || []).map(s => {
      if (s.id !== id) return s;
      return {
        ...s,
        ...(updates.dayOfWeek !== undefined && { dayOfWeek: updates.dayOfWeek }),
        ...(updates.startHour !== undefined && { startHour: updates.startHour }),
        ...(updates.startMinute !== undefined && { startMinute: updates.startMinute }),
        ...(updates.endHour !== undefined && { endHour: updates.endHour }),
        ...(updates.endMinute !== undefined && { endMinute: updates.endMinute }),
        ...(updates.locked !== undefined && { locked: updates.locked }),
        ...(updates.dayOfWeek !== undefined && { scheduledDate: getDateForDayOfWeek(weekOf, updates.dayOfWeek) }),
        // Auto-lock when position changes (matches server behavior)
        ...((updates.dayOfWeek !== undefined || updates.startHour !== undefined || updates.startMinute !== undefined) && { locked: true }),
      };
    });
    mutateSlots(optimisticSlots, false);

    // Fire API call in background, then revalidate
    apiFetch(`/api/scheduled-slots/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patchBody),
    }).then(() => mutateSlots());
  }, [slots, weekOf, mutateSlots]);

  const deleteSlot = useCallback(async (id: string) => {
    // Optimistic delete: remove slot from calendar instantly
    const optimistic = (slots || []).filter(s => s.id !== id);
    mutateSlots(optimistic, false);

    apiFetch(`/api/scheduled-slots/${id}`, { method: 'DELETE' }).then(() => mutateSlots());
  }, [slots, mutateSlots]);

  const mergeMove = useCallback(async (
    slotId: string,
    targetDay: number,
    targetStartHour: number,
    targetStartMinute: number,
  ) => {
    // Optimistic: move the slot to its new position immediately
    const slot = (slots || []).find(s => s.id === slotId);
    if (slot) {
      const duration = (slot.endHour * 60 + slot.endMinute) - (slot.startHour * 60 + slot.startMinute);
      const newEndTotal = targetStartHour * 60 + targetStartMinute + duration;
      const optimistic = (slots || []).map(s =>
        s.id === slotId
          ? { ...s, dayOfWeek: targetDay, startHour: targetStartHour, startMinute: targetStartMinute, endHour: Math.floor(newEndTotal / 60), endMinute: newEndTotal % 60, locked: true }
          : s
      );
      mutateSlots(optimistic, false);
    }

    apiFetch('/api/scheduled-slots/merge-move', {
      method: 'POST',
      body: JSON.stringify({ slotId, targetDay, targetStartHour, targetStartMinute, weekOf }),
    }).then(() => mutateSlots());
  }, [slots, weekOf, mutateSlots]);

  const generateSchedule = useCallback(async () => {
    if (generatingRef.current) return; // prevent concurrent generation
    generatingRef.current = true;
    setGenerating(true);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log(`[useSchedule] generateSchedule: weekOf="${weekOf}", timezone="${tz}", weekOffset=${weekOffset}, now=${new Date().toISOString()}`);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await apiFetch('/api/scheduled-slots/generate', {
        method: 'POST',
        body: JSON.stringify({ weekOf, timezone: tz }),
      });
      if (result?.debug) {
        console.log('%c[GENERATE DEBUG] Copy the object below and paste to Claude:', 'font-weight:bold;color:#f59e0b;font-size:14px');
        console.log(JSON.stringify(result.debug, null, 2));
      }
      await mutateSlots();
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [weekOf, weekOffset, mutateSlots]);

  const isCurrentWeek = useMemo(() => {
    return weekOf === getSunday(new Date());
  }, [weekOf]);

  return {
    weekOf,
    slots: slots || [],
    error: slotsError,
    isCurrentWeek,
    generating,
    setGenerating,
    navigateWeek,
    goToToday,
    updateSlot,
    deleteSlot,
    mergeMove,
    generateSchedule,
    mutateSlots,
  };
}
