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
    // Optimistic update: apply changes instantly
    const optimistic = (tasks || []).map(t =>
      t.id === id ? { ...t, ...updates } : t
    );
    mutate(optimistic, false);

    apiFetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }).then(() => mutate());
  };

  const deleteTask = async (id: string) => {
    // Optimistic delete: remove task and its subtasks instantly
    const optimistic = (tasks || []).filter(t => t.id !== id && t.parentId !== id);
    mutate(optimistic, false);

    apiFetch(`/api/tasks/${id}`, { method: 'DELETE' }).then(() => mutate());
  };

  const toggleComplete = async (id: string, completed: boolean) => {
    // Optimistic update — reflect the change instantly
    const optimistic = (tasks || []).map(t => {
      if (t.id === id) return { ...t, completed };
      // If completing a parent, also complete its children
      if (completed && t.parentId === id) return { ...t, completed: true };
      return t;
    });
    mutate(optimistic, false);

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
    // Optimistic: add a temporary subtask immediately
    const tempId = `temp-${Date.now()}`;
    const now = new Date().toISOString();
    const parent = (tasks || []).find(t => t.id === parentId);
    const tempTask: Task = {
      id: tempId,
      userId: parent?.userId || '',
      name: subtask.name,
      category: subtask.category || parent?.category || 'Personal',
      estimatedMinutes: subtask.estimatedMinutes || 30,
      deadline: subtask.deadline ?? null,
      recurrence: subtask.recurrence || 'none',
      completed: false,
      color: subtask.color ?? parent?.color ?? null,
      parentId,
      urgency: 0,
      createdAt: now,
      updatedAt: now,
    };
    mutate([...(tasks || []), tempTask], false);

    const data = await apiFetch<unknown>(`/api/tasks/${parentId}/subtasks`, {
      method: 'POST',
      body: JSON.stringify(subtask),
    });
    mutate();
    return mapTask(data);
  };

  const deleteAllTasks = async () => {
    if (!tasks) return;
    // Optimistic: clear all tasks instantly
    mutate([], false);

    const topLevel = tasks.filter(t => !t.parentId);
    Promise.all(topLevel.map(t => apiFetch(`/api/tasks/${t.id}`, { method: 'DELETE' }))).then(() => mutate());
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
