'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { Task, ScheduledSlotWithTask, TaskCategory } from '@/lib/types/domain';
import TaskRow from './TaskRow';

interface EditState {
  taskId: string;
  field: 'name' | 'category' | 'estimatedMinutes' | 'deadline' | 'recurrence';
}

interface ContextMenuState {
  taskId: string;
  x: number;
  y: number;
}

interface TaskListProps {
  tasks: Task[];
  scheduledSlots: ScheduledSlotWithTask[];
  onToggleComplete: (id: string, completed: boolean) => void;
  onUpdateTask: (id: string, updates: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onSlotUpdate: (id: string, updates: { locked: boolean }) => void;
  onAddSubtask: (parentId: string, subtask: { name: string; category: TaskCategory; estimatedMinutes: number; deadline: string | null; recurrence: 'none'; color: string | null }) => Promise<Task>;
  onDeleteAll: () => void;
}

export default function TaskList({
  tasks,
  scheduledSlots,
  onToggleComplete,
  onUpdateTask,
  onDelete,
  onSlotUpdate,
  onAddSubtask,
  onDeleteAll,
}: TaskListProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [colorPickerTaskId, setColorPickerTaskId] = useState<string | null>(null);
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const [addingSubtaskFor, setAddingSubtaskFor] = useState<string | null>(null);
  const [newSubtaskName, setNewSubtaskName] = useState('');
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const subtaskInputRef = useRef<HTMLInputElement | null>(null);

  const { subtaskMap, incompleteTopLevel, completedTopLevel } = useMemo(() => {
    const sMap = new Map<string, Task[]>();
    const topLevel: Task[] = [];

    for (const task of tasks) {
      if (task.parentId) {
        const existing = sMap.get(task.parentId) || [];
        existing.push(task);
        sMap.set(task.parentId, existing);
      } else {
        topLevel.push(task);
      }
    }

    return {
      subtaskMap: sMap,
      incompleteTopLevel: topLevel.filter(t => !t.completed),
      completedTopLevel: topLevel.filter(t => t.completed),
    };
  }, [tasks]);

  const getSubtasksFor = useCallback((parentId: string) => {
    return subtaskMap.get(parentId) || [];
  }, [subtaskMap]);

  const toggleExpanded = useCallback((taskId: string) => {
    setExpandedParents(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const timer = setTimeout(() => window.addEventListener('mousedown', handleClickOutside), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [contextMenu]);

  // Focus subtask input when adding
  useEffect(() => {
    if (addingSubtaskFor && subtaskInputRef.current) {
      subtaskInputRef.current.focus();
    }
  }, [addingSubtaskFor]);

  const handleContextMenu = useCallback((e: React.MouseEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ taskId, x: e.clientX, y: e.clientY });
  }, []);

  const startEdit = useCallback((taskId: string, field: EditState['field']) => {
    setEditState({ taskId, field });
    setContextMenu(null);
  }, []);

  const handleEditSubmit = useCallback((taskId: string, field: string, value: string) => {
    if (field === 'name' && value.trim()) {
      onUpdateTask(taskId, { name: value.trim() });
    } else if (field === 'category') {
      onUpdateTask(taskId, { category: value as TaskCategory });
    } else if (field === 'recurrence') {
      onUpdateTask(taskId, { recurrence: value as Task['recurrence'] });
    } else if (field === 'estimatedMinutes') {
      const mins = parseInt(value, 10);
      if (!isNaN(mins) && mins > 0) {
        onUpdateTask(taskId, { estimatedMinutes: mins });
      }
    } else if (field === 'deadline') {
      onUpdateTask(taskId, { deadline: value || null });
    }
    setEditState(null);
  }, [onUpdateTask]);

  const handleAddSubtask = useCallback(async (parentId: string) => {
    const name = newSubtaskName.trim();
    if (!name) return;
    const parent = tasks.find(t => t.id === parentId);
    if (!parent) return;
    await onAddSubtask(parentId, {
      name,
      category: parent.category,
      estimatedMinutes: 30,
      deadline: parent.deadline,
      recurrence: 'none',
      color: parent.color,
    });
    setNewSubtaskName('');
    setAddingSubtaskFor(null);
    setExpandedParents(prev => {
      const next = new Set(prev);
      next.add(parentId);
      return next;
    });
  }, [newSubtaskName, tasks, onAddSubtask]);

  const totalIncomplete = tasks.filter(t => !t.completed).length;

  const renderParentWithSubtasks = (task: Task) => {
    const subtasks = getSubtasksFor(task.id);
    const hasChildren = subtasks.length > 0;
    const isExpanded = expandedParents.has(task.id);

    return (
      <React.Fragment key={task.id}>
        <TaskRow
          task={task}
          subtasks={subtasks}
          isSubtask={false}
          isExpanded={isExpanded}
          scheduledSlots={scheduledSlots}
          editState={editState}
          colorPickerTaskId={colorPickerTaskId}
          onToggleComplete={onToggleComplete}
          onUpdateTask={onUpdateTask}
          onSlotUpdate={onSlotUpdate}
          onToggleExpanded={toggleExpanded}
          onStartEdit={startEdit}
          onEditSubmit={handleEditSubmit}
          onEditCancel={() => setEditState(null)}
          onSetColorPicker={setColorPickerTaskId}
          onContextMenu={handleContextMenu}
        />
        {hasChildren && isExpanded && (
          <>
            {subtasks.map(sub => (
              <TaskRow
                key={sub.id}
                task={sub}
                subtasks={[]}
                isSubtask={true}
                isExpanded={false}
                scheduledSlots={scheduledSlots}
                editState={editState}
                colorPickerTaskId={colorPickerTaskId}
                onToggleComplete={onToggleComplete}
                onUpdateTask={onUpdateTask}
                onSlotUpdate={onSlotUpdate}
                onToggleExpanded={toggleExpanded}
                onStartEdit={startEdit}
                onEditSubmit={handleEditSubmit}
                onEditCancel={() => setEditState(null)}
                onSetColorPicker={setColorPickerTaskId}
                onContextMenu={handleContextMenu}
              />
            ))}
            {addingSubtaskFor === task.id && (
              <tr className="border-b border-border-light bg-bg-tertiary/50">
                <td className="py-1.5 pr-1" style={{ paddingLeft: '20px' }}>
                  <div className="flex items-center gap-1">
                    <span className="w-4 flex-shrink-0" />
                    <span className="w-4 h-4 flex items-center justify-center text-accent flex-shrink-0">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </span>
                  </div>
                </td>
                <td colSpan={8} className="py-1.5 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="text-text-muted text-[10px]">&mdash;</span>
                    <input
                      ref={subtaskInputRef}
                      type="text"
                      value={newSubtaskName}
                      onChange={e => setNewSubtaskName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleAddSubtask(task.id);
                        if (e.key === 'Escape') {
                          setAddingSubtaskFor(null);
                          setNewSubtaskName('');
                        }
                      }}
                      onBlur={() => {
                        if (!newSubtaskName.trim()) {
                          setAddingSubtaskFor(null);
                          setNewSubtaskName('');
                        }
                      }}
                      placeholder="Subtask name..."
                      className="bg-transparent text-xs text-text-primary placeholder-text-muted outline-none flex-1"
                    />
                    <button
                      onClick={() => handleAddSubtask(task.id)}
                      disabled={!newSubtaskName.trim()}
                      className="text-[10px] text-accent hover:text-accent-dim disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-1.5 py-0.5 rounded bg-accent/10 hover:bg-accent/20"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => { setAddingSubtaskFor(null); setNewSubtaskName(''); }}
                      className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </>
        )}
      </React.Fragment>
    );
  };

  return (
    <div className="px-5 py-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-text-primary">
          Tasks
          <span className="text-text-muted font-normal ml-1.5">{totalIncomplete} active</span>
        </h2>
        {tasks.length > 0 && (
          <div className="flex items-center gap-1.5">
            {confirmDeleteAll ? (
              <>
                <span className="text-[10px] text-red-400">Delete all tasks?</span>
                <button
                  onClick={() => { onDeleteAll(); setConfirmDeleteAll(false); }}
                  className="text-[10px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium"
                >
                  Yes, delete
                </button>
                <button
                  onClick={() => setConfirmDeleteAll(false)}
                  className="text-[10px] px-2 py-0.5 rounded bg-bg-tertiary text-text-muted hover:text-text-secondary transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmDeleteAll(true)}
                className="text-[10px] px-2 py-0.5 rounded text-text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-1"
                title="Delete all tasks"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
                Delete all
              </button>
            )}
          </div>
        )}
      </div>

      {tasks.length === 0 ? (
        <p className="text-xs text-text-muted py-4 text-center">
          No tasks yet. Use the chat to braindump your tasks.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted border-b border-border-light">
                <th className="text-left py-1.5 pr-1 w-14"></th>
                <th className="text-left py-1.5 pr-3 font-medium">Task</th>
                <th className="text-left py-1.5 pr-3 font-medium w-20">Category</th>
                <th className="text-left py-1.5 pr-3 font-medium w-16">Duration</th>
                <th className="text-left py-1.5 pr-3 font-medium w-20">Deadline</th>
                <th className="text-left py-1.5 pr-3 font-medium w-16">Recurrence</th>
                <th className="text-left py-1.5 pr-3 font-medium">Scheduled</th>
                <th className="text-center py-1.5 pr-3 font-medium w-10" title="Lock/Unlock">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="inline opacity-60">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" fill="none" stroke="currentColor" strokeWidth="2.5" />
                  </svg>
                </th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {incompleteTopLevel.map(task => renderParentWithSubtasks(task))}
              {completedTopLevel.map(task => renderParentWithSubtasks(task))}
            </tbody>
          </table>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (() => {
        const task = tasks.find(t => t.id === contextMenu.taskId);
        if (!task) return null;
        const isTopLevel = !task.parentId;
        const taskSlots = scheduledSlots.filter(s => s.taskId === contextMenu.taskId);
        const isScheduled = taskSlots.length > 0;
        const isLocked = taskSlots.some(s => s.locked);
        const menuWidth = 180;
        const menuHeight = 240;
        const x = Math.min(contextMenu.x, window.innerWidth - menuWidth - 8);
        const y = Math.min(contextMenu.y, window.innerHeight - menuHeight - 8);
        return (
          <div
            ref={contextMenuRef}
            className="fixed z-[100] bg-bg-primary border border-border rounded-xl shadow-lg py-1 min-w-[160px]"
            style={{ left: `${x}px`, top: `${y}px` }}
          >
            <button className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors flex items-center gap-2" onClick={() => startEdit(contextMenu.taskId, 'name')}>
              Rename
            </button>
            <button className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors flex items-center gap-2" onClick={() => startEdit(contextMenu.taskId, 'deadline')}>
              Set deadline
            </button>
            <button className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors flex items-center gap-2" onClick={() => startEdit(contextMenu.taskId, 'estimatedMinutes')}>
              Change duration
            </button>
            <button className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors flex items-center gap-2" onClick={() => startEdit(contextMenu.taskId, 'category')}>
              Change category
            </button>

            {isTopLevel && (
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors flex items-center gap-2"
                onClick={() => {
                  setAddingSubtaskFor(contextMenu.taskId);
                  setNewSubtaskName('');
                  setContextMenu(null);
                  setExpandedParents(prev => { const next = new Set(prev); next.add(contextMenu.taskId); return next; });
                }}
              >
                Add subtask
              </button>
            )}

            {isScheduled && (
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors flex items-center gap-2"
                onClick={() => {
                  const anyLocked = taskSlots.some(s => s.locked);
                  for (const slot of taskSlots) onSlotUpdate(slot.id, { locked: !anyLocked });
                  setContextMenu(null);
                }}
              >
                {isLocked ? 'Unlock all slots' : 'Lock all slots'}
              </button>
            )}

            <div className="border-b border-border my-0.5" />

            <button
              className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors flex items-center gap-2"
              onClick={() => { onToggleComplete(task.id, !task.completed); setContextMenu(null); }}
            >
              {task.completed ? 'Mark incomplete' : 'Mark complete'}
            </button>

            <button
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors flex items-center gap-2"
              onClick={() => { onDelete(task.id); setContextMenu(null); }}
            >
              Delete task
            </button>
          </div>
        );
      })()}
    </div>
  );
}
