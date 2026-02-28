import type { Task, FixedBlock, ScheduledSlot, SchedulingPreferences } from '@/lib/types/domain';

/**
 * Map a Supabase snake_case row to a camelCase domain object.
 * These mappers centralize the conversion so components only work with domain types.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapTask(row: any): Task {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    category: row.category,
    estimatedMinutes: row.estimated_minutes,
    deadline: row.deadline,
    recurrence: row.recurrence,
    completed: row.completed,
    color: row.color,
    parentId: row.parent_id,
    urgency: row.urgency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapFixedBlock(row: any): FixedBlock {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    dayOfWeek: row.day_of_week,
    startHour: row.start_hour,
    startMinute: row.start_minute,
    endHour: row.end_hour,
    endMinute: row.end_minute,
    userCreated: row.user_created,
    color: row.color,
    recurring: row.recurring ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapScheduledSlot(row: any): ScheduledSlot {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    dayOfWeek: row.day_of_week,
    startHour: row.start_hour,
    startMinute: row.start_minute,
    endHour: row.end_hour,
    endMinute: row.end_minute,
    weekOf: row.week_of,
    locked: row.locked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapPreferences(row: any): SchedulingPreferences {
  return {
    id: row.id,
    userId: row.user_id,
    earliestHour: row.earliest_hour,
    latestHour: row.latest_hour,
    minBlockMinutes: row.min_block_minutes,
    preferMornings: row.prefer_mornings,
    preferEvenings: row.prefer_evenings,
    avoidWeekends: row.avoid_weekends,
    customRules: row.custom_rules || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
