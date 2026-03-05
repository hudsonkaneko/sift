/**
 * Main scheduling orchestrator — greedy gap-filling algorithm.
 *
 * Extracted from scheduled-slots/generate/route.ts for modularity.
 * Receives pre-fetched data and returns slots to insert.
 */

import { findGaps, type Interval } from './gap-finder';
import { parseCustomRules, type ParsedRules } from './constraint-parser';
import { sortTasksByPriority } from './task-sorter';

// Google Calendar events get a buffer on each side for travel/transition
const GCAL_BUFFER_MINUTES = 10;

export interface SchedulerInput {
  userId: string;
  weekOf: string;
  timezone: string;
  tasks: RawTask[];
  lockedSlots: RawSlot[];
  fixedBlocks: RawFixedBlock[];
  preferences: SchedulerPreferences;
}

export interface RawTask {
  id: string;
  name: string;
  estimated_minutes: number;
  deadline: string | null;
  urgency: number;
  completed: boolean;
  [key: string]: unknown;
}

export interface RawSlot {
  id: string;
  task_id: string;
  day_of_week: number;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  locked: boolean;
  [key: string]: unknown;
}

export interface RawFixedBlock {
  id: string;
  day_of_week: number | null;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  google_event_id?: string | null;
  [key: string]: unknown;
}

export interface SchedulerPreferences {
  earliestHour: number;
  latestHour: number;
  minBlockMinutes: number;
  preferMornings: boolean;
  preferEvenings: boolean;
  avoidWeekends: boolean;
  customRules: string[];
}

export interface NewSlot {
  user_id: string;
  task_id: string;
  day_of_week: number;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  week_of: string;
  locked: false;
}

export interface SchedulerResult {
  slots: NewSlot[];
  debug: {
    schedulableTasks: number;
    dayOrder: number[];
    dayStart: number;
    dayEnd: number;
    parsedRules: {
      gapMinutes: number;
      blockedDays: number[];
      noScheduleBefore: number | null;
      noScheduleAfter: number | null;
    };
  };
}

function resolveLocalTime(timezone: string): {
  todayDayOfWeek: number;
  currentTimeMinutes: number;
  todayMidnight: Date;
} {
  const now = new Date();
  const tz = timezone || 'UTC';
  const localParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    weekday: 'short',
  }).formatToParts(now);

  const localHour = parseInt(localParts.find(p => p.type === 'hour')!.value);
  const localMinute = parseInt(localParts.find(p => p.type === 'minute')!.value);
  const localYear = parseInt(localParts.find(p => p.type === 'year')!.value);
  const localMonth = parseInt(localParts.find(p => p.type === 'month')!.value);
  const localDay = parseInt(localParts.find(p => p.type === 'day')!.value);
  const todayMidnight = new Date(localYear, localMonth - 1, localDay);

  return {
    todayDayOfWeek: todayMidnight.getDay(),
    currentTimeMinutes: localHour * 60 + localMinute,
    todayMidnight,
  };
}

export function generateSchedule(input: SchedulerInput): SchedulerResult {
  const {
    userId, weekOf, timezone, tasks, lockedSlots, fixedBlocks, preferences,
  } = input;

  const {
    earliestHour, latestHour, minBlockMinutes,
    preferMornings, preferEvenings, avoidWeekends, customRules,
  } = preferences;

  // Parse custom rules
  const parsedRules = parseCustomRules(customRules);
  console.log(`[SCHEDULER] customRules:`, customRules, `parsed:`, {
    gapMinutes: parsedRules.gapMinutes,
    blockedDays: [...parsedRules.blockedDays],
    noScheduleBefore: parsedRules.noScheduleBefore,
    noScheduleAfter: parsedRules.noScheduleAfter,
  });

  // Filter schedulable tasks
  const lockedTaskIds = new Set(lockedSlots.map(s => s.task_id));
  const schedulableTasks = tasks.filter(t =>
    !t.completed && t.estimated_minutes > 0 && !lockedTaskIds.has(t.id)
  );

  // Calculate locked minutes per task
  const lockedMinutesByTask = new Map<string, number>();
  for (const slot of lockedSlots) {
    const duration = (slot.end_hour * 60 + slot.end_minute) - (slot.start_hour * 60 + slot.start_minute);
    lockedMinutesByTask.set(slot.task_id, (lockedMinutesByTask.get(slot.task_id) || 0) + duration);
  }

  // Resolve local time
  const { todayDayOfWeek, currentTimeMinutes, todayMidnight } = resolveLocalTime(timezone);

  // Sort tasks by priority
  const sortedTasks = sortTasksByPriority(schedulableTasks, todayMidnight);

  // Build occupied intervals per day (0-6)
  const occupiedPerDay = new Map<number, Interval[]>();
  for (let d = 0; d < 7; d++) occupiedPerDay.set(d, []);

  for (const fb of fixedBlocks) {
    const day = fb.day_of_week;
    if (day == null || day < 0 || day > 6) continue;
    const intervals = occupiedPerDay.get(day)!;
    const blockStart = fb.start_hour * 60 + fb.start_minute;
    const blockEnd = fb.end_hour * 60 + fb.end_minute;
    if (fb.google_event_id) {
      intervals.push({
        start: Math.max(0, blockStart - GCAL_BUFFER_MINUTES),
        end: Math.min(24 * 60, blockEnd + GCAL_BUFFER_MINUTES),
      });
    } else {
      intervals.push({ start: blockStart, end: blockEnd });
    }
  }

  for (const slot of lockedSlots) {
    const day = slot.day_of_week;
    if (day == null || day < 0 || day > 6) continue;
    occupiedPerDay.get(day)!.push({
      start: slot.start_hour * 60 + slot.start_minute,
      end: slot.end_hour * 60 + slot.end_minute,
    });
  }

  // Determine day order
  const weekOfDate = new Date(weekOf + 'T00:00:00');
  const weekOfSunday = new Date(weekOfDate);
  weekOfSunday.setDate(weekOfSunday.getDate() - weekOfSunday.getDay());
  const todaySunday = new Date(todayMidnight);
  todaySunday.setDate(todaySunday.getDate() - todaySunday.getDay());
  const isCurrentWeek = weekOfSunday.getTime() === todaySunday.getTime();

  let dayOrder: number[];
  if (avoidWeekends) {
    dayOrder = [1, 2, 3, 4, 5];
  } else {
    dayOrder = [1, 2, 3, 4, 5, 6, 0];
  }

  if (parsedRules.blockedDays.size > 0) {
    dayOrder = dayOrder.filter(d => !parsedRules.blockedDays.has(d));
  }

  if (isCurrentWeek) {
    dayOrder = dayOrder.filter(d => {
      const dAdj = d === 0 ? 7 : d;
      const todayAdj = todayDayOfWeek === 0 ? 7 : todayDayOfWeek;
      return dAdj >= todayAdj;
    });
  }

  // Apply time window overrides
  let dayStart = earliestHour * 60;
  if (parsedRules.noScheduleBefore && parsedRules.noScheduleBefore > 0 && parsedRules.noScheduleBefore < 24 * 60) {
    dayStart = Math.max(dayStart, parsedRules.noScheduleBefore);
  }
  let dayEnd = latestHour * 60;
  if (parsedRules.noScheduleAfter && parsedRules.noScheduleAfter > 0 && parsedRules.noScheduleAfter < 24 * 60) {
    dayEnd = Math.min(dayEnd, parsedRules.noScheduleAfter);
  }
  if (dayStart >= dayEnd) {
    console.warn(`[SCHEDULER] dayStart (${dayStart}) >= dayEnd (${dayEnd}), resetting to defaults`);
    dayStart = earliestHour * 60;
    dayEnd = latestHour * 60;
  }

  // Greedy gap-filling
  const newSlots: NewSlot[] = [];

  for (const task of sortedTasks) {
    let remaining = task.estimated_minutes - (lockedMinutesByTask.get(task.id) || 0);
    if (remaining <= 0) continue;

    for (const day of dayOrder) {
      if (remaining <= 0) break;

      const occupied = occupiedPerDay.get(day) || [];
      const effectiveDayStart = (isCurrentWeek && day === todayDayOfWeek)
        ? Math.max(dayStart, Math.ceil(currentTimeMinutes / 15) * 15)
        : dayStart;
      let gaps = findGaps(occupied, effectiveDayStart, dayEnd, minBlockMinutes);

      if (!preferMornings && preferEvenings) {
        gaps.reverse();
      }

      for (const gap of gaps) {
        if (remaining <= 0) break;
        const gapDuration = gap.end - gap.start;
        const placed = Math.min(remaining, gapDuration);

        if (placed < minBlockMinutes && remaining >= minBlockMinutes) {
          continue;
        }

        const slotStart = gap.start;
        const slotEnd = slotStart + placed;

        newSlots.push({
          user_id: userId,
          task_id: task.id,
          day_of_week: day,
          start_hour: Math.floor(slotStart / 60),
          start_minute: slotStart % 60,
          end_hour: Math.floor(slotEnd / 60),
          end_minute: slotEnd % 60,
          week_of: weekOf,
          locked: false,
        });

        const occupiedEnd = parsedRules.gapMinutes > 0
          ? Math.min(slotEnd + parsedRules.gapMinutes, dayEnd)
          : slotEnd;
        occupiedPerDay.get(day)!.push({ start: slotStart, end: occupiedEnd });
        remaining -= placed;
      }
    }
  }

  return {
    slots: newSlots,
    debug: {
      schedulableTasks: schedulableTasks.length,
      dayOrder,
      dayStart,
      dayEnd,
      parsedRules: {
        gapMinutes: parsedRules.gapMinutes,
        blockedDays: [...parsedRules.blockedDays],
        noScheduleBefore: parsedRules.noScheduleBefore,
        noScheduleAfter: parsedRules.noScheduleAfter,
      },
    },
  };
}
