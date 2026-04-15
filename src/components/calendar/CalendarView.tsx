'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { ScheduledSlotWithTask, FixedBlock, Task } from '@/lib/types/domain';
import { DAYS, DAY_INDICES, HOUR_HEIGHT, START_HOUR, END_HOUR, GRID_PAD_TOP, SNAP_MINUTES, getWeekDates, dateToDayOfMonth, dateToDayOfWeek, formatWeekLabel } from './constants';
import TimeColumn from './TimeColumn';
import DayColumn from './DayColumn';
import AllDayStrip from './AllDayStrip';
import EventFormModal, { type EventFormState } from './EventFormModal';
import { BlockContextMenu, SwapContextMenu, type BlockMenuState, type SwapMenuState } from './ContextMenu';
import { useDragDrop } from './useDragDrop';

interface Props {
  weekOf: string;
  slots: ScheduledSlotWithTask[];
  fixedBlocks: FixedBlock[];
  tasks: Task[];
  isCurrentWeek: boolean;
  onNavigateWeek: (delta: number) => void;
  onGoToToday: () => void;
  onSlotUpdate: (id: string, updates: {
    dayOfWeek?: number;
    startHour?: number;
    startMinute?: number;
    endHour?: number;
    endMinute?: number;
    locked?: boolean;
    taskId?: string;
  }) => void;
  onSlotDelete: (id: string) => void;
  onMergeMove: (slotId: string, targetDay: number, targetStartHour: number, targetStartMinute: number) => void;
  onBlockUpdate: (id: string, updates: {
    name?: string;
    color?: string | null;
    recurring?: boolean;
    dayOfWeek?: number;
    startHour?: number;
    startMinute?: number;
    endHour?: number;
    endMinute?: number;
  }) => void;
  onBlockDelete: (id: string) => void;
  onAddFixedBlock: (block: {
    name: string;
    dayOfWeek: number;
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
    color: string | null;
    recurring: boolean;
  }) => void;
  onGenerateSchedule?: () => void;
  generatingSchedule?: boolean;
}

export default function CalendarView({
  weekOf,
  slots,
  fixedBlocks,
  tasks,
  isCurrentWeek,
  onNavigateWeek,
  onGoToToday,
  onSlotUpdate,
  onSlotDelete,
  onMergeMove,
  onBlockUpdate,
  onBlockDelete,
  onAddFixedBlock,
  onGenerateSchedule,
  generatingSchedule,
}: Props) {
  const [now, setNow] = useState<Date | null>(null);
  const [eventForm, setEventForm] = useState<EventFormState | null>(null);
  const [blockMenu, setBlockMenu] = useState<BlockMenuState | null>(null);
  const [swapMenu, setSwapMenu] = useState<SwapMenuState | null>(null);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to 8am on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 8 * HOUR_HEIGHT;
    }
  }, []);

  // Initialize and update current time on client only (avoids hydration mismatch)
  useEffect(() => {
    setNow(new Date());
    const interval = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(interval);
  }, []);

  // Refresh on visibility change
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const todayDateStr = now
    ? `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
    : '';
  const weekDates = getWeekDates(weekOf);

  // ─── Drag system ───

  const handleCreateDragEnd = useCallback((
    dayOfWeek: number,
    startHour: number,
    startMinute: number,
    endHour: number,
    endMinute: number,
  ) => {
    setEventForm({
      mode: 'create',
      name: '',
      color: null,
      recurring: false,
      dayOfWeek,
      startHour,
      startMinute,
      endHour,
      endMinute,
    });
  }, []);

  const {
    dragState,
    blockDrag,
    createDrag,
    isDragging,
    startSlotDrag,
    startBlockDrag,
    startCreateDrag,
  } = useDragDrop({
    slots,
    onSlotUpdate: (id, updates) => onSlotUpdate(id, updates),
    onMergeMove,
    onBlockUpdate: (id, updates) => onBlockUpdate(id, updates),
    onCreateDragEnd: handleCreateDragEnd,
    columnRefs: columnRefs as React.RefObject<(HTMLDivElement | null)[]>,
  });

  // ─── Context menus ───

  const handleSlotContextMenu = useCallback((e: React.MouseEvent, slot: ScheduledSlotWithTask) => {
    setBlockMenu(null);
    setSwapMenu({
      slotId: slot.id,
      taskId: slot.taskId,
      taskName: slot.task?.name || 'Task',
      isLocked: slot.locked,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const handleBlockContextMenu = useCallback((e: React.MouseEvent, block: FixedBlock) => {
    setSwapMenu(null);
    setBlockMenu({
      blockId: block.id,
      blockName: block.name,
      isGoogleEvent: !block.userCreated,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const handleSwapTask = useCallback((slotId: string, newTaskId: string) => {
    const slot = slots.find(s => s.id === slotId);
    const newTask = tasks.find(t => t.id === newTaskId);
    if (!slot || !newTask) return;

    const startMin = slot.startHour * 60 + slot.startMinute;
    let endMin = startMin + newTask.estimatedMinutes;
    endMin = Math.max(startMin + SNAP_MINUTES, Math.min(endMin, END_HOUR * 60));

    onSlotUpdate(slotId, {
      taskId: newTaskId,
      endHour: Math.floor(endMin / 60),
      endMinute: endMin % 60,
    });
  }, [slots, tasks, onSlotUpdate]);

  // ─── Event form handlers ───

  const handleEventFormSave = useCallback((form: EventFormState) => {
    if (form.mode === 'create') {
      onAddFixedBlock({
        name: form.name,
        dayOfWeek: form.dayOfWeek,
        startHour: form.startHour,
        startMinute: form.startMinute,
        endHour: form.endHour,
        endMinute: form.endMinute,
        color: form.color,
        recurring: form.recurring,
      });
    } else if (form.blockId) {
      onBlockUpdate(form.blockId, {
        name: form.name,
        color: form.color,
        recurring: form.recurring,
        dayOfWeek: form.dayOfWeek,
        startHour: form.startHour,
        startMinute: form.startMinute,
        endHour: form.endHour,
        endMinute: form.endMinute,
      });
    }
    setEventForm(null);
  }, [onAddFixedBlock, onBlockUpdate]);

  const handleEditBlock = useCallback((blockId: string) => {
    const block = fixedBlocks.find(b => b.id === blockId);
    if (!block) return;
    setEventForm({
      mode: 'edit',
      blockId: block.id,
      name: block.name,
      color: block.color,
      recurring: block.recurring,
      dayOfWeek: block.dayOfWeek,
      startHour: block.startHour,
      startMinute: block.startMinute,
      endHour: block.endHour,
      endMinute: block.endMinute,
    });
  }, [fixedBlocks]);

  const gridHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT + GRID_PAD_TOP;

  return (
    <div className="flex flex-col h-full">
      {/* Header: week navigation */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onNavigateWeek(-4)}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-muted transition-colors"
            title="Previous month"
          >
            <ChevronsLeft size={16} />
          </button>
          <button
            onClick={() => onNavigateWeek(-1)}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-muted transition-colors"
            title="Previous week"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => onNavigateWeek(1)}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-muted transition-colors"
            title="Next week"
          >
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => onNavigateWeek(4)}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-muted transition-colors"
            title="Next month"
          >
            <ChevronsRight size={16} />
          </button>

          {!isCurrentWeek && (
            <button
              onClick={onGoToToday}
              className="ml-2 px-2.5 py-1 rounded-lg text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
            >
              Today
            </button>
          )}
        </div>

        <span className="text-sm font-medium text-text-primary">
          {formatWeekLabel(weekOf)}
        </span>

        <div className="flex items-center gap-2">
          {onGenerateSchedule && (
            <button
              onClick={onGenerateSchedule}
              disabled={generatingSchedule}
              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-accent hover:bg-accent-dim text-white disabled:opacity-50 transition-colors"
            >
              {generatingSchedule ? 'Generating...' : 'Generate Schedule'}
            </button>
          )}
        </div>
      </div>

      {/* Day headers */}
      <div className="flex border-b border-border-light">
        <div className="w-14 flex-shrink-0" />
        {DAY_INDICES.map(i => {
          const isTodayCol = weekDates[i] === todayDateStr;
          return (
            <div
              key={i}
              className={`flex-1 text-center py-2 border-r border-border-light last:border-r-0 ${
                isTodayCol ? 'bg-accent/5' : ''
              }`}
            >
              <div className="text-[10px] text-text-muted uppercase tracking-wider">{DAYS[i]}</div>
              <div className={`text-sm font-semibold ${
                isTodayCol ? 'text-accent' : 'text-text-primary'
              }`}>
                {dateToDayOfMonth(weekDates[i])}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day events strip (only renders if any all-day events this week) */}
      <AllDayStrip
        weekDates={weekDates}
        todayDateStr={todayDateStr}
        allDayBlocks={fixedBlocks.filter(b => b.isAllDay)}
      />

      {/* Grid */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="flex" style={{ minHeight: gridHeight }}>
          <TimeColumn
            now={now ?? new Date(0)}
            isToday={weekDates.includes(todayDateStr)}
          />

          {DAY_INDICES.map(dayIndex => {
            const dateStr = weekDates[dayIndex];
            const dayBlocks = fixedBlocks.filter(b =>
              !b.isAllDay && (b.specificDate ? b.specificDate === dateStr : b.dayOfWeek === dayIndex)
            );
            const daySlots = slots.filter(s => s.scheduledDate === dateStr);

            return (
              <DayColumn
                key={dayIndex}
                dayIndex={dayIndex}
                dayDate={dateStr}
                isToday={dateStr === todayDateStr}
                blocks={dayBlocks}
                slots={daySlots}
                dragState={dragState}
                blockDrag={blockDrag}
                createDrag={createDrag}
                onSlotMouseDown={startSlotDrag}
                onBlockMouseDown={startBlockDrag}
                onColumnMouseDown={startCreateDrag}
                onSlotContextMenu={handleSlotContextMenu}
                onBlockContextMenu={handleBlockContextMenu}
                columnRef={el => { columnRefs.current[dayIndex] = el; }}
                now={now ?? new Date(0)}
              />
            );
          })}
        </div>
      </div>

      {/* Drag overlay */}
      {isDragging && (
        <div className={`fixed inset-0 z-40 ${createDrag ? 'cursor-crosshair' : 'cursor-grabbing'}`} />
      )}

      {/* Event form modal */}
      {eventForm && (
        <EventFormModal
          form={eventForm}
          onClose={() => setEventForm(null)}
          onSave={handleEventFormSave}
        />
      )}

      {/* Context menus */}
      {blockMenu && (
        <BlockContextMenu
          menu={blockMenu}
          onEdit={handleEditBlock}
          onDelete={id => { onBlockDelete(id); setBlockMenu(null); }}
          onColorChange={(id, color) => { onBlockUpdate(id, { color }); setBlockMenu(null); }}
          onClose={() => setBlockMenu(null)}
        />
      )}
      {swapMenu && (
        <SwapContextMenu
          menu={swapMenu}
          tasks={tasks}
          onToggleLock={(slotId, locked) => onSlotUpdate(slotId, { locked })}
          onSwapTask={handleSwapTask}
          onClose={() => setSwapMenu(null)}
        />
      )}
    </div>
  );
}
