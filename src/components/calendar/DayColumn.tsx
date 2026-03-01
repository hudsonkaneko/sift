'use client';

import React from 'react';
import { Lock } from 'lucide-react';
import type { ScheduledSlotWithTask, FixedBlock } from '@/lib/types/domain';
import {
  HOUR_HEIGHT, START_HOUR, END_HOUR, GRID_PAD_TOP,
  CATEGORY_COLORS, CATEGORY_DOT_COLORS,
  getBlockStyle, hexStyles,
} from './constants';
import type { SlotDragState, BlockDragState, CreateDragState } from './useDragDrop';
import { formatTime } from '@/lib/utils/format';

interface Props {
  dayIndex: number;
  dayDate: number;
  isToday: boolean;
  blocks: FixedBlock[];
  slots: ScheduledSlotWithTask[];
  dragState: SlotDragState | null;
  blockDrag: BlockDragState | null;
  createDrag: CreateDragState | null;
  onSlotMouseDown: (e: React.MouseEvent, slot: ScheduledSlotWithTask, mode: 'move' | 'resize-bottom') => void;
  onBlockMouseDown: (e: React.MouseEvent, block: FixedBlock, mode: 'move' | 'resize-bottom') => void;
  onColumnMouseDown: (e: React.MouseEvent, colIndex: number, dayOfWeek: number) => void;
  onSlotContextMenu: (e: React.MouseEvent, slot: ScheduledSlotWithTask) => void;
  onBlockContextMenu: (e: React.MouseEvent, block: FixedBlock) => void;
  columnRef: (el: HTMLDivElement | null) => void;
}

const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

export default function DayColumn({
  dayIndex,
  blocks,
  slots,
  dragState,
  blockDrag,
  createDrag,
  onSlotMouseDown,
  onBlockMouseDown,
  onColumnMouseDown,
  onSlotContextMenu,
  onBlockContextMenu,
  columnRef,
}: Props) {
  // Current time indicator
  const now = new Date();
  const isCurrentWeekDay = now.getDay() === dayIndex;

  return (
    <div
      ref={columnRef}
      className="relative flex-1 border-r border-border-light last:border-r-0"
      style={{ paddingTop: GRID_PAD_TOP }}
      onMouseDown={e => {
        // Only start create drag if clicking directly on the column background
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.hourLine) {
          onColumnMouseDown(e, dayIndex, dayIndex);
        }
      }}
    >
      {/* Hour grid lines */}
      {hours.map(hour => (
        <div
          key={hour}
          data-hour-line="true"
          className="border-t border-border-light"
          style={{ height: HOUR_HEIGHT }}
        />
      ))}

      {/* Current time line */}
      {isCurrentWeekDay && now.getHours() >= START_HOUR && now.getHours() < END_HOUR && (
        <div
          className="absolute left-0 right-0 z-20 pointer-events-none"
          style={{
            top: ((now.getHours() - START_HOUR) + now.getMinutes() / 60) * HOUR_HEIGHT + GRID_PAD_TOP,
          }}
        >
          <div className="flex items-center">
            <div className="w-2 h-2 rounded-full bg-accent -ml-1" />
            <div className="flex-1 h-[2px] bg-accent" />
          </div>
        </div>
      )}

      {/* Fixed blocks */}
      {blocks.map(block => {
        const isUserEvent = block.userCreated;
        const isDragging = blockDrag?.blockId === block.id;
        const isDraggedAway = isDragging && blockDrag!.previewDayOfWeek !== dayIndex;
        const style = getBlockStyle(
          isDragging && !isDraggedAway ? blockDrag!.previewStartHour : block.startHour,
          isDragging && !isDraggedAway ? blockDrag!.previewStartMinute : block.startMinute,
          isDragging && !isDraggedAway ? blockDrag!.previewEndHour : block.endHour,
          isDragging && !isDraggedAway ? blockDrag!.previewEndMinute : block.endMinute,
        );

        const useInlineColor = isUserEvent && block.color;

        return (
          <div
            key={block.id}
            className={`absolute left-1 right-1 rounded-lg border px-2 py-1 overflow-hidden text-[11px] leading-tight select-none ${
              isUserEvent
                ? useInlineColor
                  ? 'cursor-grab'
                  : 'bg-accent/10 border-accent/25 text-accent cursor-grab'
                : 'bg-bg-tertiary border-border-light text-text-muted'
            } ${isDragging ? 'ring-2 ring-accent' : ''} ${isDraggedAway ? 'opacity-25' : isDragging ? 'opacity-70' : ''}`}
            style={{
              top: style.top,
              height: style.height,
              zIndex: isDragging ? 30 : 10,
              ...(useInlineColor ? hexStyles(block.color!) : {}),
            }}
            onMouseDown={e => {
              if (!isUserEvent) return;
              // Resize if clicking bottom 8px
              const rect = (e.target as HTMLElement).closest('[data-block]')?.getBoundingClientRect();
              if (rect && e.clientY > rect.bottom - 8) {
                onBlockMouseDown(e, block, 'resize-bottom');
              } else {
                onBlockMouseDown(e, block, 'move');
              }
            }}
            onContextMenu={e => {
              if (!isUserEvent) return;
              e.preventDefault();
              onBlockContextMenu(e, block);
            }}
            data-block
          >
            <div className="font-medium truncate">{block.name}</div>
            {style.height > 28 && (
              <div className="text-[10px] opacity-60 mt-0.5">
                {formatTime(block.startHour, block.startMinute)} – {formatTime(block.endHour, block.endMinute)}
              </div>
            )}
          </div>
        );
      })}

      {/* Scheduled slots */}
      {slots.map(slot => {
        const isDragging = dragState?.slotId === slot.id;
        const isDraggedAway = isDragging && dragState!.previewDayOfWeek !== dayIndex;
        const isSibling = dragState?.isMerge && dragState.originalSlot.taskId === slot.taskId && dragState.slotId !== slot.id;

        const style = getBlockStyle(
          isDragging && !isDraggedAway ? dragState!.previewStartHour : slot.startHour,
          isDragging && !isDraggedAway ? dragState!.previewStartMinute : slot.startMinute,
          isDragging && !isDraggedAway ? dragState!.previewEndHour : slot.endHour,
          isDragging && !isDraggedAway ? dragState!.previewEndMinute : slot.endMinute,
        );

        const category = slot.task?.category || 'Personal';
        const colorClasses = CATEGORY_COLORS[category];
        const dotClass = CATEGORY_DOT_COLORS[category];

        return (
          <div
            key={slot.id}
            className={`absolute left-1 right-1 rounded-lg border px-2 py-1 overflow-hidden text-[11px] leading-tight cursor-grab select-none ${colorClasses} ${
              isDragging ? 'ring-2 ring-accent z-30' : 'z-10'
            } ${isDraggedAway ? 'opacity-25' : isDragging ? 'opacity-70' : ''} ${isSibling ? 'opacity-30 border-dashed' : ''}`}
            style={{
              top: style.top,
              height: style.height,
            }}
            onMouseDown={e => {
              const rect = (e.target as HTMLElement).closest('[data-slot]')?.getBoundingClientRect();
              if (rect && e.clientY > rect.bottom - 8) {
                onSlotMouseDown(e, slot, 'resize-bottom');
              } else {
                onSlotMouseDown(e, slot, 'move');
              }
            }}
            onContextMenu={e => {
              e.preventDefault();
              onSlotContextMenu(e, slot);
            }}
            data-slot
          >
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
              <span className="font-medium truncate">{slot.task?.name || 'Task'}</span>
              {slot.locked && (
                <Lock size={10} className="text-amber-500 flex-shrink-0" />
              )}
            </div>
            {style.height > 28 && (
              <div className="text-[10px] opacity-60 mt-0.5">
                {formatTime(slot.startHour, slot.startMinute)} – {formatTime(slot.endHour, slot.endMinute)}
              </div>
            )}

            {/* Resize handle */}
            <div className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize" />
          </div>
        );
      })}

      {/* Drag ghost preview (slot dragged to different column) */}
      {dragState && dragState.previewDayOfWeek === dayIndex && dragState.originalSlot.dayOfWeek !== dayIndex && (
        <div
          className={`absolute left-1 right-1 rounded-lg border px-2 py-1 overflow-hidden text-[11px] leading-tight opacity-80 ring-1 ring-accent z-20 pointer-events-none ${
            CATEGORY_COLORS[dragState.originalSlot.task?.category || 'Personal']
          }`}
          style={getBlockStyle(
            dragState.previewStartHour,
            dragState.previewStartMinute,
            dragState.previewEndHour,
            dragState.previewEndMinute,
          )}
        >
          <div className="font-medium truncate">{dragState.originalSlot.task?.name || 'Task'}</div>
        </div>
      )}

      {/* Block drag ghost preview */}
      {blockDrag && blockDrag.previewDayOfWeek === dayIndex && blockDrag.originalBlock.dayOfWeek !== dayIndex && (
        <div
          className="absolute left-1 right-1 rounded-lg border px-2 py-1 overflow-hidden text-[11px] leading-tight opacity-80 ring-1 ring-accent z-20 pointer-events-none bg-accent/10 border-accent/25 text-accent"
          style={getBlockStyle(
            blockDrag.previewStartHour,
            blockDrag.previewStartMinute,
            blockDrag.previewEndHour,
            blockDrag.previewEndMinute,
          )}
        >
          <div className="font-medium truncate">{blockDrag.originalBlock.name}</div>
        </div>
      )}

      {/* Create drag selection */}
      {createDrag && createDrag.colIndex === dayIndex && (() => {
        const anchorMin = createDrag.anchorHour * 60 + createDrag.anchorMinute;
        const currentMin = createDrag.currentHour * 60 + createDrag.currentMinute;
        const startMin = Math.min(anchorMin, currentMin);
        const endMin = Math.max(anchorMin, currentMin);
        if (endMin <= startMin) return null;
        const style = getBlockStyle(
          Math.floor(startMin / 60), startMin % 60,
          Math.floor(endMin / 60), endMin % 60,
        );
        return (
          <div
            className="absolute left-1 right-1 rounded-lg border-2 border-dashed border-accent/50 bg-accent/10 z-20 pointer-events-none"
            style={{ top: style.top, height: style.height }}
          />
        );
      })()}
    </div>
  );
}
