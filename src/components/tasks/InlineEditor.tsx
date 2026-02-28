'use client';

import { useRef, useEffect } from 'react';
import type { Task, TaskCategory, RecurrenceType } from '@/lib/types/domain';
import { ALL_CATEGORIES } from '@/lib/utils/format';

interface InlineEditorProps {
  task: Task;
  field: 'name' | 'category' | 'estimatedMinutes' | 'deadline' | 'recurrence';
  onSubmit: (taskId: string, field: string, value: string) => void;
  onCancel: () => void;
}

export default function InlineEditor({ task, field, onSubmit, onCancel }: InlineEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  if (field === 'category') {
    return (
      <select
        className="bg-bg-primary border border-accent rounded px-1 py-0.5 text-xs text-text-primary outline-none w-full"
        defaultValue={task.category}
        autoFocus
        onChange={e => {
          onSubmit(task.id, field, e.target.value);
        }}
        onBlur={onCancel}
      >
        {ALL_CATEGORIES.map(cat => (
          <option key={cat} value={cat}>{cat}</option>
        ))}
      </select>
    );
  }

  if (field === 'recurrence') {
    return (
      <select
        className="bg-bg-primary border border-accent rounded px-1 py-0.5 text-xs text-text-primary outline-none w-full"
        defaultValue={task.recurrence}
        autoFocus
        onChange={e => {
          onSubmit(task.id, field, e.target.value);
        }}
        onBlur={onCancel}
      >
        <option value="none">None</option>
        <option value="daily">Daily</option>
        <option value="weekdays">Weekdays</option>
        <option value="weekly">Weekly</option>
      </select>
    );
  }

  if (field === 'deadline') {
    return (
      <input
        ref={inputRef}
        type="date"
        className="bg-bg-primary border border-accent rounded px-1 py-0.5 text-xs text-text-primary outline-none w-full"
        defaultValue={task.deadline || ''}
        onBlur={e => onSubmit(task.id, field, e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onSubmit(task.id, field, (e.target as HTMLInputElement).value);
          if (e.key === 'Escape') onCancel();
        }}
      />
    );
  }

  // name or estimatedMinutes
  return (
    <input
      ref={inputRef}
      type={field === 'estimatedMinutes' ? 'number' : 'text'}
      className="bg-bg-primary border border-accent rounded px-1 py-0.5 text-xs text-text-primary outline-none w-full"
      defaultValue={field === 'estimatedMinutes' ? task.estimatedMinutes : task.name}
      min={field === 'estimatedMinutes' ? 5 : undefined}
      onBlur={e => onSubmit(task.id, field, e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') onSubmit(task.id, field, (e.target as HTMLInputElement).value);
        if (e.key === 'Escape') onCancel();
      }}
    />
  );
}
