// Domain types for Sift — adapted from existing src/main/types.ts

export type TaskCategory = 'School' | 'Startup' | 'Collab' | 'Personal';
export type RecurrenceType = 'none' | 'daily' | 'weekdays' | 'weekly';
export type UserTone = 'friendly' | 'direct' | 'gentle' | 'hype';

export interface User {
  id: string; // Clerk user ID
  email: string;
  displayName: string | null;
  tone: UserTone;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string; // UUID
  userId: string;
  name: string;
  category: TaskCategory;
  estimatedMinutes: number;
  deadline: string | null; // ISO date string (YYYY-MM-DD)
  recurrence: RecurrenceType;
  completed: boolean;
  color: string | null; // hex color string
  parentId: string | null; // null = top-level task
  urgency: number;
  createdAt: string;
  updatedAt: string;
}

export interface FixedBlock {
  id: string; // UUID
  userId: string;
  name: string;
  dayOfWeek: number; // 0=Sunday … 6=Saturday
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  userCreated: boolean;
  color: string | null;
  recurring: boolean;
  googleEventId: string | null;
  googleCalendarId: string | null;
  specificDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleCalendarAccount {
  id: string;
  userId: string;
  googleEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface GoogleCalendarSource {
  id: string;
  userId: string;
  googleCalendarId: string;
  name: string;
  color: string | null;
  enabled: boolean;
  googleEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledSlot {
  id: string; // UUID
  userId: string;
  taskId: string;
  dayOfWeek: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  weekOf: string; // ISO date of the Sunday of the week
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledSlotWithTask extends ScheduledSlot {
  task: Task;
}

export interface ChatSession {
  id: string; // UUID
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string; // UUID
  sessionId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SchedulingPreferences {
  id: string;
  userId: string;
  earliestHour: number;
  latestHour: number;
  minBlockMinutes: number;
  preferMornings: boolean;
  preferEvenings: boolean;
  avoidWeekends: boolean;
  customRules: string[];
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_PREFERENCES: Omit<SchedulingPreferences, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
  earliestHour: 9,
  latestHour: 23,
  minBlockMinutes: 30,
  preferMornings: true,
  preferEvenings: true,
  avoidWeekends: false,
  customRules: [],
};

export interface SchedulingRule {
  id: string;
  userId: string;
  ruleText: string;
  ruleType: string;
  source: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedTaskData {
  name: string;
  category: TaskCategory;
  estimatedMinutes: number;
  deadline: string | null;
  recurrence: RecurrenceType;
  color?: string | null;
  parentId?: string | null;
  subtasks?: ParsedTaskData[];
  urgency?: number;
}

export interface WeekSchedule {
  fixedBlocks: FixedBlock[];
  scheduledSlots: ScheduledSlotWithTask[];
}
