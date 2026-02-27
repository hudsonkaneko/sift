'use client';

import useSWR from 'swr';
import { apiFetch } from '@/lib/utils/api';
import { mapTask } from '@/lib/utils/db';
import type { Task, TaskCategory, RecurrenceType } from '@/lib/types/domain';

const fetcher = (url: string) => apiFetch<unknown[]>(url).then(rows => rows.map(mapTask));

export function useTasks() {
  const { data: tasks, error, isLoading, mutate } = useSWR('/api/tasks', fetcher);

  const addTask = async (task: {
    name: string;
    category?: TaskCategory;
    estimatedMinutes?: number;
    deadline?: string | null;
    recurrence?: RecurrenceType;
    color?: string | null;
    parentId?: string | null;
  }) => {
    await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    });
    mutate();
  };

  const updateTask = async (id: string, updates: Partial<Task>) => {
    await apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    mutate();
  };

  const deleteTask = async (id: string) => {
    await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
    mutate();
  };

  const toggleComplete = async (id: string, completed: boolean) => {
    await apiFetch(`/api/tasks/${id}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ completed }),
    });
    mutate();
  };

  const addSubtask = async (
    parentId: string,
    subtask: {
      name: string;
      category?: TaskCategory;
      estimatedMinutes?: number;
      deadline?: string | null;
      recurrence?: RecurrenceType;
      color?: string | null;
    },
  ) => {
    const data = await apiFetch<unknown>(`/api/tasks/${parentId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify(subtask),
    });
    mutate();
    return mapTask(data);
  };

  const deleteAllTasks = async () => {
    if (!tasks) return;
    // Delete top-level tasks (cascade handles subtasks)
    const topLevel = tasks.filter(t => !t.parentId);
    await Promise.all(topLevel.map(t => apiFetch(`/api/tasks/${t.id}`, { method: 'DELETE' })));
    mutate();
  };

  return {
    tasks: tasks || [],
    isLoading,
    error,
    addTask,
    updateTask,
    deleteTask,
    toggleComplete,
    addSubtask,
    deleteAllTasks,
    mutate,
  };
}
