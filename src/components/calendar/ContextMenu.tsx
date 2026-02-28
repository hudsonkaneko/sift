'use client';

import { useEffect, useRef } from 'react';
import { Lock, Unlock, Pencil, Trash2 } from 'lucide-react';
import type { Task } from '@/lib/types/domain';

// ─── Block context menu (Edit / Delete for user-created fixed blocks) ───

export interface BlockMenuState {
  blockId: string;
  blockName: string;
  x: number;
  y: number;
}

interface BlockContextMenuProps {
  menu: BlockMenuState;
  onEdit: (blockId: string) => void;
  onDelete: (blockId: string) => void;
  onClose: () => void;
}

export function BlockContextMenu({ menu, onEdit, onDelete, onClose }: BlockContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const timer = setTimeout(() => window.addEventListener('mousedown', handle), 0);
    return () => { clearTimeout(timer); window.removeEventListener('mousedown', handle); };
  }, [onClose]);

  const menuWidth = 180;
  const menuHeight = 88;
  const x = Math.min(menu.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(menu.y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-bg-primary border border-border rounded-xl shadow-lg p-1.5 w-[180px]"
      style={{ left: x, top: y }}
    >
      <p className="px-2.5 py-1 text-xs text-text-muted truncate">{menu.blockName}</p>
      <button
        onClick={() => { onEdit(menu.blockId); onClose(); }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
      >
        <Pencil size={14} className="text-text-muted" />
        Edit
      </button>
      <button
        onClick={() => { onDelete(menu.blockId); onClose(); }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-red-400 hover:bg-bg-tertiary transition-colors"
      >
        <Trash2 size={14} />
        Delete
      </button>
    </div>
  );
}

// ─── Swap menu (Lock/Unlock + Replace task for scheduled slots) ───

export interface SwapMenuState {
  slotId: string;
  taskId: string;
  taskName: string;
  isLocked: boolean;
  x: number;
  y: number;
}

interface SwapContextMenuProps {
  menu: SwapMenuState;
  tasks: Task[];
  onToggleLock: (slotId: string, locked: boolean) => void;
  onSwapTask: (slotId: string, newTaskId: string) => void;
  onClose: () => void;
}

export function SwapContextMenu({ menu, tasks, onToggleLock, onSwapTask, onClose }: SwapContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const timer = setTimeout(() => window.addEventListener('mousedown', handle), 0);
    return () => { clearTimeout(timer); window.removeEventListener('mousedown', handle); };
  }, [onClose]);

  const swappable = tasks.filter(t => !t.completed && t.id !== menu.taskId);
  const menuWidth = 240;
  const menuHeight = Math.min(320, 70 + swappable.length * 44);
  const x = Math.min(menu.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(menu.y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-bg-primary border border-border rounded-xl shadow-lg p-1.5 w-[240px] max-h-[320px] overflow-y-auto"
      style={{ left: x, top: y }}
    >
      <p className="px-2.5 py-1 text-xs text-text-muted truncate">{menu.taskName}</p>

      <button
        onClick={() => { onToggleLock(menu.slotId, !menu.isLocked); onClose(); }}
        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-primary hover:bg-bg-tertiary transition-colors"
      >
        {menu.isLocked ? <Unlock size={14} className="text-text-muted" /> : <Lock size={14} className="text-text-muted" />}
        {menu.isLocked ? 'Unlock' : 'Lock'}
      </button>

      {swappable.length > 0 && (
        <>
          <div className="border-t border-border my-1" />
          <p className="px-2.5 py-1 text-xs text-text-muted">Replace with...</p>
          {swappable.map(task => (
            <button
              key={task.id}
              onClick={() => { onSwapTask(menu.slotId, task.id); onClose(); }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-primary hover:bg-bg-tertiary transition-colors truncate"
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0 bg-accent" />
              <span className="truncate">{task.name}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
