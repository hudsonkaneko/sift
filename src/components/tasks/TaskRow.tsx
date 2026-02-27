'use client';

import React, { useRef, useEffect, useState } from 'react';
import type { Task, ScheduledSlotWithTask, TaskCategory } from '@/lib/types/domain';
import InlineEditor from './InlineEditor';
import {
  CATEGORY_HEX,
  CATEGORY_BADGES,
  COLOR_PALETTE,
  DAYS_SHORT,
  formatDuration,
  formatDeadline,
  formatTime,
} from '@/lib/utils/format';

interface EditState {
  taskId: string;
  field: 'name' | 'category' | 'estimatedMinutes' | 'deadline' | 'recurrence';
}

interface TaskRowProps {
  task: Task;
  subtasks: Task[];
  isSubtask: boolean;
  isExpanded: boolean;
  scheduledSlots: ScheduledSlotWithTask[];
  editState: EditState | null;
  colorPickerTaskId: string | null;
  onToggleComplete: (id: string, completed: boolean) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onSlotUpdate: (id: string, updates: { locked: boolean }) => void;
  onToggleExpanded: (taskId: string) => void;
  onStartEdit: (taskId: string, field: EditState['field']) => void;
  onEditSubmit: (taskId: string, field: string, value: string) => void;
  onEditCancel: () => void;
  onSetColorPicker: (taskId: string | null) => void;
  onContextMenu: (e: React.MouseEvent, taskId: string) => void;
}

export default function TaskRow({
  task,
  subtasks,
  isSubtask,
  isExpanded,
  scheduledSlots,
  editState,
  colorPickerTaskId,
  onToggleComplete,
  onUpdateTask,
  onSlotUpdate,
  onToggleExpanded,
  onStartEdit,
  onEditSubmit,
  onEditCancel,
  onSetColorPicker,
  onContextMenu,
}: TaskRowProps) {
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const hasChildren = subtasks.length > 0;
  const completedSubtasks = subtasks.filter(s => s.completed).length;
  const isCompleted = task.completed;

  const displayDuration = hasChildren
    ? subtasks.reduce((sum, s) => sum + s.estimatedMinutes, 0) + task.estimatedMinutes
    : task.estimatedMinutes;

  const taskSlots = scheduledSlots.filter(s => s.taskId === task.id);
  const isScheduled = taskSlots.length > 0;
  const isLocked = taskSlots.some(s => s.locked);

  const getScheduledInfo = (): string => {
    if (taskSlots.length === 0) return 'Not scheduled';
    return taskSlots
      .map(s => `${DAYS_SHORT[s.dayOfWeek]} ${formatTime(s.startHour, s.startMinute)}-${formatTime(s.endHour, s.endMinute)}`)
      .join(', ');
  };

  const toggleTaskLock = () => {
    if (taskSlots.length === 0) return;
    const anyLocked = taskSlots.some(s => s.locked);
    for (const slot of taskSlots) {
      onSlotUpdate(slot.id, { locked: !anyLocked });
    }
  };

  // Close color picker on outside click
  useEffect(() => {
    if (colorPickerTaskId !== task.id) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        onSetColorPicker(null);
      }
    };
    const timer = setTimeout(() => window.addEventListener('mousedown', handleClickOutside), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [colorPickerTaskId, task.id, onSetColorPicker]);

  const renderEditableCell = (field: EditState['field'], displayValue: string, className: string = '') => {
    const isEditing = editState?.taskId === task.id && editState?.field === field;

    if (isEditing) {
      return (
        <InlineEditor
          task={task}
          field={field}
          onSubmit={onEditSubmit}
          onCancel={onEditCancel}
        />
      );
    }

    return (
      <span
        className={`cursor-pointer hover:underline decoration-dotted underline-offset-2 ${className}`}
        onClick={() => onStartEdit(task.id, field)}
      >
        {displayValue}
      </span>
    );
  };

  return (
    <tr
      className={`border-b border-border-light transition-colors ${
        isCompleted ? 'opacity-40 hover:opacity-60' : 'hover:bg-bg-tertiary'
      }`}
      onContextMenu={e => onContextMenu(e, task.id)}
    >
      {/* Checkbox / expand toggle */}
      <td className="py-1.5 pr-1" style={{ paddingLeft: isSubtask ? '20px' : '0' }}>
        <div className="flex items-center gap-1">
          {hasChildren && !isSubtask ? (
            <button
              onClick={() => onToggleExpanded(task.id)}
              className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors flex-shrink-0"
            >
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ) : (
            <span className="w-4 flex-shrink-0" />
          )}
          {isCompleted ? (
            <button
              onClick={() => onToggleComplete(task.id, false)}
              className="w-4 h-4 rounded border border-accent bg-accent/20 flex items-center justify-center flex-shrink-0"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </button>
          ) : (
            <button
              onClick={() => onToggleComplete(task.id, true)}
              className="w-4 h-4 rounded border border-border hover:border-accent transition-colors flex items-center justify-center flex-shrink-0"
            />
          )}
        </div>
      </td>

      {/* Task name */}
      <td className={`py-1.5 pr-3 ${isCompleted ? 'text-text-secondary line-through' : 'text-text-primary font-medium'}`}>
        <div className="flex items-center gap-1.5">
          {isSubtask && <span className="text-text-muted text-[10px]">&mdash;</span>}
          {isCompleted ? (
            <span>{task.name}</span>
          ) : (
            renderEditableCell('name', task.name)
          )}
          {hasChildren && !isSubtask && (
            <span className="text-[10px] text-text-muted bg-bg-tertiary rounded-full px-1.5 py-0.5 ml-1 tabular-nums flex-shrink-0">
              {completedSubtasks}/{subtasks.length}
            </span>
          )}
        </div>
      </td>

      {/* Category */}
      <td className="py-1.5 pr-3">
        {isCompleted ? (
          <div className="flex items-center gap-1.5">
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: task.color || CATEGORY_HEX[task.category] }}
            />
            <span
              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                task.color ? '' : CATEGORY_BADGES[task.category]
              }`}
              style={task.color ? { backgroundColor: `${task.color}26`, color: task.color } : undefined}
            >
              {task.category}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 relative">
            <button
              className="w-3 h-3 rounded-full flex-shrink-0 border border-transparent hover:border-text-muted/40 transition-colors"
              style={{ backgroundColor: task.color || CATEGORY_HEX[task.category] }}
              onClick={() => onSetColorPicker(colorPickerTaskId === task.id ? null : task.id)}
              title="Change color"
            />
            {editState?.taskId === task.id && editState?.field === 'category' ? (
              renderEditableCell('category', task.category)
            ) : (
              <span
                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer hover:ring-1 hover:ring-accent/50 transition ${
                  task.color ? '' : CATEGORY_BADGES[task.category]
                }`}
                style={task.color ? { backgroundColor: `${task.color}26`, color: task.color } : undefined}
                onClick={() => onStartEdit(task.id, 'category')}
              >
                {task.category}
              </span>
            )}
            {colorPickerTaskId === task.id && (
              <div
                ref={colorPickerRef}
                className="absolute top-full left-0 mt-1 z-50 bg-bg-primary border border-border rounded-xl shadow-lg p-2 flex items-center gap-1.5"
              >
                {COLOR_PALETTE.map(c => (
                  <button
                    key={c.hex}
                    title={c.name}
                    onClick={() => {
                      onUpdateTask(task.id, { color: task.color === c.hex ? null : c.hex });
                      onSetColorPicker(null);
                    }}
                    className={`w-4 h-4 rounded-full border-2 transition-all ${
                      task.color === c.hex ? 'border-accent scale-110 ring-2 ring-accent/30' : 'border-transparent hover:border-text-muted/40'
                    }`}
                    style={{ backgroundColor: c.hex }}
                  />
                ))}
                {task.color && (
                  <button
                    onClick={() => {
                      onUpdateTask(task.id, { color: null });
                      onSetColorPicker(null);
                    }}
                    className="ml-0.5 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
                    title="Reset to category default"
                  >
                    &times;
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </td>

      {/* Duration */}
      <td className={`py-1.5 pr-3 tabular-nums ${isCompleted ? 'text-text-muted' : 'text-text-secondary'}`}>
        {isCompleted ? formatDuration(displayDuration) : renderEditableCell('estimatedMinutes', formatDuration(displayDuration))}
      </td>

      {/* Deadline */}
      <td className="py-1.5 pr-3">
        {isCompleted ? (
          <span className="text-text-muted">{formatDeadline(task.deadline)}</span>
        ) : (
          renderEditableCell('deadline', formatDeadline(task.deadline), `${
            task.deadline && formatDeadline(task.deadline) === 'Overdue'
              ? 'text-red-400'
              : task.deadline && formatDeadline(task.deadline) === 'Today'
                ? 'text-amber-400'
                : 'text-text-secondary'
          }`)
        )}
      </td>

      {/* Recurrence */}
      <td className={`py-1.5 pr-3 capitalize text-text-muted`}>
        {isCompleted ? task.recurrence : renderEditableCell('recurrence', task.recurrence)}
      </td>

      {/* Scheduled */}
      <td className="py-1.5 pr-3 text-text-muted">
        {isCompleted ? '-' : getScheduledInfo()}
      </td>

      {/* Lock */}
      <td className="py-1.5 pr-3 text-center">
        {!isCompleted && isScheduled ? (
          <button
            onClick={toggleTaskLock}
            className={`p-0.5 rounded transition-colors ${
              isLocked ? 'text-amber-400 hover:text-amber-300' : 'text-text-muted hover:text-text-secondary opacity-40 hover:opacity-70'
            }`}
            title={isLocked ? 'Click to unlock all slots' : 'Click to lock all slots'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              {isLocked ? (
                <path d="M7 11V7a5 5 0 0110 0v4" fill="none" stroke="currentColor" strokeWidth="2.5" />
              ) : (
                <path d="M7 11V7a5 5 0 0110 0" fill="none" stroke="currentColor" strokeWidth="2.5" />
              )}
            </svg>
          </button>
        ) : (
          <span className="text-text-muted opacity-20">&mdash;</span>
        )}
      </td>

      {/* Menu */}
      <td className="py-1.5">
        <button
          onClick={e => onContextMenu(e, task.id)}
          className="text-text-muted hover:text-text-primary transition-colors p-0.5"
          title="More options"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>
      </td>
    </tr>
  );
}
