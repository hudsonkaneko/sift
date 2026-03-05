'use client';

import { useEffect, useRef } from 'react';
import { Lock, Unlock, Pencil, Trash2, RotateCcw } from 'lucide-react';
import type { Task } from '@/lib/types/domain';
import { COLOR_PALETTE } from '@/lib/utils/format';

// ─── Block context menu (Edit / Delete for user-created fixed blocks) ───

export interface BlockMenuState {
  blockId: string;
  blockName: string;
  isGoogleEvent: boolean;
  x: number;
  y: number;
}

interface BlockContextMenuProps {
  menu: BlockMenuState;
  onEdit: (blockId: string) => void;
  onDelete: (blockId: string) => void;
  onColorChange: (blockId: string, color: string | null) => void;
  onClose: () => void;
}

export function BlockContextMenu({ menu, onEdit, onDelete, onColorChange, onClose }: BlockContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', handle);
    window.addEventListener('contextmenu', handle);
    return () => {
      window.removeEventListener('mousedown', handle);
      window.removeEventListener('contextmenu', handle);
    };
  }, [onClose]);

  const menuWidth = 180;
  const menuHeight = menu.isGoogleEvent ? 80 : 88;
  const x = Math.min(menu.x, window.innerWidth - menuWidth - 8);
  const y = Math.min(menu.y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-bg-primary border border-border rounded-xl shadow-lg p-1.5 w-[180px]"
      style={{ left: x, top: y }}
    >
      <p className="px-2.5 py-1 text-xs text-text-muted truncate">{menu.blockName}</p>

      {menu.isGoogleEvent ? (
        <>
          <div className="flex items-center gap-1.5 px-2.5 py-2">
            {COLOR_PALETTE.map(c => (
              <button
                key={c.hex}
                title={c.name}
                onClick={() => { onColorChange(menu.blockId, c.hex); onClose(); }}
                className="w-5 h-5 rounded-full border border-white/20 hover:scale-125 transition-transform"
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
          <button
            onClick={() => { onColorChange(menu.blockId, null); onClose(); }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-text-muted hover:bg-bg-tertiary transition-colors"
          >
            <RotateCcw size={14} />
            Reset color
          </button>
        </>
      ) : (
        <>
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
        </>
      )}
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
    window.addEventListener('mousedown', handle);
    window.addEventListener('contextmenu', handle);
    return () => {
      window.removeEventListener('mousedown', handle);
      window.removeEventListener('contextmenu', handle);
    };
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
