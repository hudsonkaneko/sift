'use client';

import { useState, useCallback, useRef } from 'react';
import type { ScheduledSlotWithTask, FixedBlock } from '@/lib/types/domain';
import { HOUR_HEIGHT, SNAP_MINUTES, START_HOUR, END_HOUR, GRID_PAD_TOP, snapMinutes } from './constants';

// ─── Drag state types ───

export interface SlotDragState {
  slotId: string;
  mode: 'move' | 'resize-bottom';
  originalSlot: ScheduledSlotWithTask;
  offsetY: number;
  currentColIndex: number;
  previewDayOfWeek: number;
  previewStartHour: number;
  previewStartMinute: number;
  previewEndHour: number;
  previewEndMinute: number;
  isMerge: boolean;
  combinedDuration: number;
}

export interface BlockDragState {
  blockId: string;
  mode: 'move' | 'resize-bottom';
  originalBlock: FixedBlock;
  offsetY: number;
  currentColIndex: number;
  previewDayOfWeek: number;
  previewStartHour: number;
  previewStartMinute: number;
  previewEndHour: number;
  previewEndMinute: number;
}

export interface CreateDragState {
  colIndex: number;
  dayOfWeek: number;
  anchorHour: number;
  anchorMinute: number;
  currentHour: number;
  currentMinute: number;
}

interface UseDragDropParams {
  slots: ScheduledSlotWithTask[];
  onSlotUpdate: (id: string, updates: {
    dayOfWeek?: number;
    startHour?: number;
    startMinute?: number;
    endHour?: number;
    endMinute?: number;
  }) => void;
  onMergeMove: (slotId: string, targetDay: number, targetStartHour: number, targetStartMinute: number) => void;
  onBlockUpdate: (id: string, updates: {
    dayOfWeek?: number;
    startHour?: number;
    startMinute?: number;
    endHour?: number;
    endMinute?: number;
  }) => void;
  onCreateDragEnd: (dayOfWeek: number, startHour: number, startMinute: number, endHour: number, endMinute: number) => void;
  columnRefs: React.RefObject<(HTMLDivElement | null)[]>;
}

export function useDragDrop({
  slots,
  onSlotUpdate,
  onMergeMove,
  onBlockUpdate,
  onCreateDragEnd,
  columnRefs,
}: UseDragDropParams) {
  const [dragState, setDragState] = useState<SlotDragState | null>(null);
  const [blockDrag, setBlockDrag] = useState<BlockDragState | null>(null);
  const [createDrag, setCreateDrag] = useState<CreateDragState | null>(null);

  const dragRef = useRef(dragState);
  dragRef.current = dragState;
  const blockDragRef = useRef(blockDrag);
  blockDragRef.current = blockDrag;
  const createDragRef = useRef(createDrag);
  createDragRef.current = createDrag;

  // ─── Helpers ───

  const findColumnIndex = useCallback((clientX: number): number => {
    const cols = columnRefs.current;
    if (!cols) return 0;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      if (!col) continue;
      const rect = col.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return i;
    }
    return 0;
  }, [columnRefs]);

  const getRelativeY = useCallback((clientY: number, colIndex: number): number => {
    const col = columnRefs.current?.[colIndex];
    if (!col) return 0;
    const rect = col.getBoundingClientRect();
    return clientY - rect.top + col.scrollTop;
  }, [columnRefs]);

  // ─── Slot drag ───

  const startSlotDrag = useCallback((
    e: React.MouseEvent,
    slot: ScheduledSlotWithTask,
    mode: 'move' | 'resize-bottom',
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const colIndex = findColumnIndex(e.clientX);
    const relY = getRelativeY(e.clientY, colIndex);
    const slotTop = ((slot.startHour - START_HOUR) + slot.startMinute / 60) * HOUR_HEIGHT + GRID_PAD_TOP;
    const offsetY = mode === 'move' ? relY - slotTop : 0;

    // Merge detection: check for sibling slots with same taskId
    const siblingSlots = slots.filter(s => s.taskId === slot.taskId);
    const hasSiblings = siblingSlots.length > 1;
    let combinedDuration = 0;
    if (hasSiblings) {
      for (const s of siblingSlots) {
        combinedDuration += (s.endHour * 60 + s.endMinute) - (s.startHour * 60 + s.startMinute);
      }
    } else {
      combinedDuration = (slot.endHour * 60 + slot.endMinute) - (slot.startHour * 60 + slot.startMinute);
    }

    const state: SlotDragState = {
      slotId: slot.id,
      mode,
      originalSlot: slot,
      offsetY,
      currentColIndex: colIndex,
      previewDayOfWeek: slot.dayOfWeek,
      previewStartHour: slot.startHour,
      previewStartMinute: slot.startMinute,
      previewEndHour: slot.endHour,
      previewEndMinute: slot.endMinute,
      isMerge: hasSiblings && mode === 'move',
      combinedDuration,
    };

    setDragState(state);

    const handleMouseMove = (ev: MouseEvent) => {
      const ds = dragRef.current;
      if (!ds) return;

      const ci = findColumnIndex(ev.clientX);
      const ry = getRelativeY(ev.clientY, ci);

      if (ds.mode === 'move') {
        const topPx = ry - ds.offsetY;
        const totalMin = ((topPx - GRID_PAD_TOP) / HOUR_HEIGHT) * 60 + START_HOUR * 60;
        const snapped = snapMinutes(Math.max(START_HOUR * 60, totalMin));
        const duration = ds.isMerge ? ds.combinedDuration : (ds.originalSlot.endHour * 60 + ds.originalSlot.endMinute) - (ds.originalSlot.startHour * 60 + ds.originalSlot.startMinute);
        const endMin = Math.min(snapped + duration, END_HOUR * 60);
        const startMin = endMin - duration;

        setDragState(prev => prev ? {
          ...prev,
          currentColIndex: ci,
          previewDayOfWeek: ci,
          previewStartHour: Math.floor(startMin / 60),
          previewStartMinute: startMin % 60,
          previewEndHour: Math.floor(endMin / 60),
          previewEndMinute: endMin % 60,
        } : null);
      } else {
        // resize-bottom
        const totalMin = ((ry - GRID_PAD_TOP) / HOUR_HEIGHT) * 60 + START_HOUR * 60;
        const startMin = ds.originalSlot.startHour * 60 + ds.originalSlot.startMinute;
        const snapped = snapMinutes(Math.max(startMin + SNAP_MINUTES, Math.min(totalMin, END_HOUR * 60)));

        setDragState(prev => prev ? {
          ...prev,
          previewEndHour: Math.floor(snapped / 60),
          previewEndMinute: snapped % 60,
        } : null);
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      const ds = dragRef.current;
      if (!ds) return;

      const changed = ds.previewDayOfWeek !== ds.originalSlot.dayOfWeek ||
        ds.previewStartHour !== ds.originalSlot.startHour ||
        ds.previewStartMinute !== ds.originalSlot.startMinute ||
        ds.previewEndHour !== ds.originalSlot.endHour ||
        ds.previewEndMinute !== ds.originalSlot.endMinute;

      if (changed) {
        if (ds.isMerge) {
          onMergeMove(ds.slotId, ds.previewDayOfWeek, ds.previewStartHour, ds.previewStartMinute);
        } else {
          onSlotUpdate(ds.slotId, {
            dayOfWeek: ds.previewDayOfWeek,
            startHour: ds.previewStartHour,
            startMinute: ds.previewStartMinute,
            endHour: ds.previewEndHour,
            endMinute: ds.previewEndMinute,
          });
        }
      }

      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [slots, findColumnIndex, getRelativeY, onSlotUpdate, onMergeMove]);

  // ─── Block drag ───

  const startBlockDrag = useCallback((
    e: React.MouseEvent,
    block: FixedBlock,
    mode: 'move' | 'resize-bottom',
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const colIndex = findColumnIndex(e.clientX);
    const relY = getRelativeY(e.clientY, colIndex);
    const blockTop = ((block.startHour - START_HOUR) + block.startMinute / 60) * HOUR_HEIGHT + GRID_PAD_TOP;
    const offsetY = mode === 'move' ? relY - blockTop : 0;

    const state: BlockDragState = {
      blockId: block.id,
      mode,
      originalBlock: block,
      offsetY,
      currentColIndex: colIndex,
      previewDayOfWeek: block.dayOfWeek,
      previewStartHour: block.startHour,
      previewStartMinute: block.startMinute,
      previewEndHour: block.endHour,
      previewEndMinute: block.endMinute,
    };

    setBlockDrag(state);

    const handleMouseMove = (ev: MouseEvent) => {
      const bd = blockDragRef.current;
      if (!bd) return;

      const ci = findColumnIndex(ev.clientX);
      const ry = getRelativeY(ev.clientY, ci);

      if (bd.mode === 'move') {
        const topPx = ry - bd.offsetY;
        const totalMin = ((topPx - GRID_PAD_TOP) / HOUR_HEIGHT) * 60 + START_HOUR * 60;
        const snapped = snapMinutes(Math.max(START_HOUR * 60, totalMin));
        const duration = (bd.originalBlock.endHour * 60 + bd.originalBlock.endMinute) - (bd.originalBlock.startHour * 60 + bd.originalBlock.startMinute);
        const endMin = Math.min(snapped + duration, END_HOUR * 60);
        const startMin = endMin - duration;

        setBlockDrag(prev => prev ? {
          ...prev,
          currentColIndex: ci,
          previewDayOfWeek: ci,
          previewStartHour: Math.floor(startMin / 60),
          previewStartMinute: startMin % 60,
          previewEndHour: Math.floor(endMin / 60),
          previewEndMinute: endMin % 60,
        } : null);
      } else {
        const totalMin = ((ry - GRID_PAD_TOP) / HOUR_HEIGHT) * 60 + START_HOUR * 60;
        const startMin = bd.originalBlock.startHour * 60 + bd.originalBlock.startMinute;
        const snapped = snapMinutes(Math.max(startMin + SNAP_MINUTES, Math.min(totalMin, END_HOUR * 60)));

        setBlockDrag(prev => prev ? {
          ...prev,
          previewEndHour: Math.floor(snapped / 60),
          previewEndMinute: snapped % 60,
        } : null);
      }
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      const bd = blockDragRef.current;
      if (!bd) return;

      const changed = bd.previewDayOfWeek !== bd.originalBlock.dayOfWeek ||
        bd.previewStartHour !== bd.originalBlock.startHour ||
        bd.previewStartMinute !== bd.originalBlock.startMinute ||
        bd.previewEndHour !== bd.originalBlock.endHour ||
        bd.previewEndMinute !== bd.originalBlock.endMinute;

      if (changed) {
        onBlockUpdate(bd.blockId, {
          dayOfWeek: bd.previewDayOfWeek,
          startHour: bd.previewStartHour,
          startMinute: bd.previewStartMinute,
          endHour: bd.previewEndHour,
          endMinute: bd.previewEndMinute,
        });
      }

      setBlockDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [findColumnIndex, getRelativeY, onBlockUpdate]);

  // ─── Create drag ───

  const startCreateDrag = useCallback((e: React.MouseEvent, colIndex: number, dayOfWeek: number) => {
    const relY = getRelativeY(e.clientY, colIndex);
    const totalMin = ((relY - GRID_PAD_TOP) / HOUR_HEIGHT) * 60 + START_HOUR * 60;
    const snapped = snapMinutes(Math.max(START_HOUR * 60, Math.min(totalMin, END_HOUR * 60)));
    const hour = Math.floor(snapped / 60);
    const minute = snapped % 60;

    const state: CreateDragState = {
      colIndex,
      dayOfWeek,
      anchorHour: hour,
      anchorMinute: minute,
      currentHour: hour,
      currentMinute: minute,
    };

    setCreateDrag(state);

    const handleMouseMove = (ev: MouseEvent) => {
      const cd = createDragRef.current;
      if (!cd) return;

      const ry = getRelativeY(ev.clientY, cd.colIndex);
      const tm = ((ry - GRID_PAD_TOP) / HOUR_HEIGHT) * 60 + START_HOUR * 60;
      const sn = snapMinutes(Math.max(START_HOUR * 60, Math.min(tm, END_HOUR * 60)));

      setCreateDrag(prev => prev ? {
        ...prev,
        currentHour: Math.floor(sn / 60),
        currentMinute: sn % 60,
      } : null);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      const cd = createDragRef.current;
      if (!cd) return;

      const anchorMin = cd.anchorHour * 60 + cd.anchorMinute;
      const currentMin = cd.currentHour * 60 + cd.currentMinute;
      const startMin = Math.min(anchorMin, currentMin);
      const endMin = Math.max(anchorMin, currentMin);

      // If drag was less than SNAP_MINUTES, default to 1-hour block
      const duration = endMin - startMin;
      const finalStart = startMin;
      const finalEnd = duration < SNAP_MINUTES ? Math.min(startMin + 60, END_HOUR * 60) : endMin;

      onCreateDragEnd(
        cd.dayOfWeek,
        Math.floor(finalStart / 60),
        finalStart % 60,
        Math.floor(finalEnd / 60),
        finalEnd % 60,
      );

      setCreateDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [getRelativeY, onCreateDragEnd]);

  const isDragging = dragState !== null || blockDrag !== null || createDrag !== null;

  return {
    dragState,
    blockDrag,
    createDrag,
    isDragging,
    startSlotDrag,
    startBlockDrag,
    startCreateDrag,
  };
}
