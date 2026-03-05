/**
 * Schedule Risk Detection — analyzes whether a user's week is overloaded.
 *
 * Computes the ratio of available scheduling time to required task time,
 * identifies at-risk tasks (those closest to deadline with least slack),
 * and returns structured warnings for the UI.
 */

import { findGaps, type Interval } from '@/lib/scheduler/gap-finder';
import { parseCustomRules } from '@/lib/scheduler/constraint-parser';
import { calculatePriorityFromRaw } from '@/lib/utils/priority';

export type RiskLevel = 'safe' | 'tight' | 'overloaded';

export interface RiskyTask {
  id: string;
  name: string;
  estimatedMinutes: number;
  deadline: string | null;
  priorityScore: number;
  reason: string;
}

export interface RiskAnalysisResult {
  requiredMinutes: number;
  availableMinutes: number;
  riskRatio: number;
  riskLevel: RiskLevel;
  riskyTasks: RiskyTask[];
  summary: string;
}

export interface RiskAnalysisInput {
  tasks: {
    id: string;
    name: string;
    estimated_minutes: number;
    deadline: string | null;
    urgency: number;
    completed: boolean;
    parent_id?: string | null;
  }[];
  fixedBlocks: {
    day_of_week: number | null;
    start_hour: number;
    start_minute: number;
    end_hour: number;
    end_minute: number;
    google_event_id?: string | null;
  }[];
  lockedSlots: {
    task_id: string;
    day_of_week: number;
    start_hour: number;
    start_minute: number;
    end_hour: number;
    end_minute: number;
  }[];
  preferences: {
    earliestHour: number;
    latestHour: number;
    minBlockMinutes: number;
    avoidWeekends: boolean;
    customRules: string[];
  };
  weekOf: string;
  timezone: string;
}

const GCAL_BUFFER_MINUTES = 10;

export function analyzeScheduleRisk(input: RiskAnalysisInput): RiskAnalysisResult {
  const { tasks, fixedBlocks, lockedSlots, preferences, weekOf, timezone } = input;

  // 1. Calculate total required time (incomplete tasks with duration > 0)
  const incompleteTasks = tasks.filter(t => !t.completed && t.estimated_minutes > 0);
  const requiredMinutes = incompleteTasks.reduce((sum, t) => sum + t.estimated_minutes, 0);

  // Subtract already-locked time
  const lockedMinutesByTask = new Map<string, number>();
  for (const slot of lockedSlots) {
    const duration = (slot.end_hour * 60 + slot.end_minute) - (slot.start_hour * 60 + slot.start_minute);
    lockedMinutesByTask.set(slot.task_id, (lockedMinutesByTask.get(slot.task_id) || 0) + duration);
  }
  let alreadyScheduledMinutes = 0;
  for (const mins of lockedMinutesByTask.values()) {
    alreadyScheduledMinutes += mins;
  }
  const netRequiredMinutes = Math.max(0, requiredMinutes - alreadyScheduledMinutes);

  // 2. Calculate total available time across the week
  const parsedRules = parseCustomRules(preferences.customRules);

  let dayStart = preferences.earliestHour * 60;
  if (parsedRules.noScheduleBefore) {
    dayStart = Math.max(dayStart, parsedRules.noScheduleBefore);
  }
  let dayEnd = preferences.latestHour * 60;
  if (parsedRules.noScheduleAfter) {
    dayEnd = Math.min(dayEnd, parsedRules.noScheduleAfter);
  }
  if (dayStart >= dayEnd) {
    dayStart = preferences.earliestHour * 60;
    dayEnd = preferences.latestHour * 60;
  }

  // Build occupied intervals per day
  const occupiedPerDay = new Map<number, Interval[]>();
  for (let d = 0; d < 7; d++) occupiedPerDay.set(d, []);

  for (const fb of fixedBlocks) {
    const day = fb.day_of_week;
    if (day == null || day < 0 || day > 6) continue;
    const blockStart = fb.start_hour * 60 + fb.start_minute;
    const blockEnd = fb.end_hour * 60 + fb.end_minute;
    if (fb.google_event_id) {
      occupiedPerDay.get(day)!.push({
        start: Math.max(0, blockStart - GCAL_BUFFER_MINUTES),
        end: Math.min(24 * 60, blockEnd + GCAL_BUFFER_MINUTES),
      });
    } else {
      occupiedPerDay.get(day)!.push({ start: blockStart, end: blockEnd });
    }
  }

  for (const slot of lockedSlots) {
    if (slot.day_of_week < 0 || slot.day_of_week > 6) continue;
    occupiedPerDay.get(slot.day_of_week)!.push({
      start: slot.start_hour * 60 + slot.start_minute,
      end: slot.end_hour * 60 + slot.end_minute,
    });
  }

  // Determine which days are schedulable
  let schedulableDays: number[];
  if (preferences.avoidWeekends) {
    schedulableDays = [1, 2, 3, 4, 5];
  } else {
    schedulableDays = [0, 1, 2, 3, 4, 5, 6];
  }
  schedulableDays = schedulableDays.filter(d => !parsedRules.blockedDays.has(d));

  // Skip past days for current week
  const now = new Date();
  const tz = timezone || 'UTC';
  try {
    const localParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short',
    }).formatToParts(now);
    const localYear = parseInt(localParts.find(p => p.type === 'year')!.value);
    const localMonth = parseInt(localParts.find(p => p.type === 'month')!.value);
    const localDay = parseInt(localParts.find(p => p.type === 'day')!.value);
    const todayMidnight = new Date(localYear, localMonth - 1, localDay);
    const todayDayOfWeek = todayMidnight.getDay();

    const weekOfDate = new Date(weekOf + 'T00:00:00');
    const weekOfSunday = new Date(weekOfDate);
    weekOfSunday.setDate(weekOfSunday.getDate() - weekOfSunday.getDay());
    const todaySunday = new Date(todayMidnight);
    todaySunday.setDate(todaySunday.getDate() - todaySunday.getDay());
    const isCurrentWeek = weekOfSunday.getTime() === todaySunday.getTime();

    if (isCurrentWeek) {
      schedulableDays = schedulableDays.filter(d => {
        const dAdj = d === 0 ? 7 : d;
        const todayAdj = todayDayOfWeek === 0 ? 7 : todayDayOfWeek;
        return dAdj >= todayAdj;
      });
    }
  } catch {
    // If timezone parsing fails, use all schedulable days
  }

  // Sum available gap minutes
  let availableMinutes = 0;
  for (const day of schedulableDays) {
    const occupied = occupiedPerDay.get(day) || [];
    const gaps = findGaps(occupied, dayStart, dayEnd, preferences.minBlockMinutes);
    for (const gap of gaps) {
      availableMinutes += gap.end - gap.start;
    }
  }

  // 3. Compute risk ratio
  const riskRatio = netRequiredMinutes > 0 ? availableMinutes / netRequiredMinutes : Infinity;

  let riskLevel: RiskLevel;
  if (riskRatio >= 1.3) {
    riskLevel = 'safe';
  } else if (riskRatio >= 1.0) {
    riskLevel = 'tight';
  } else {
    riskLevel = 'overloaded';
  }

  // 4. Identify risky tasks (deadline within the week or overdue, sorted by priority)
  const referenceDate = new Date();
  const riskyTasks: RiskyTask[] = incompleteTasks
    .map(t => {
      const priorityScore = calculatePriorityFromRaw(t.deadline, t.urgency, t.estimated_minutes, referenceDate);
      let reason = '';

      if (t.deadline) {
        const deadlineDate = new Date(t.deadline + 'T00:00:00');
        const diffDays = Math.floor((deadlineDate.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) {
          reason = `Overdue by ${Math.abs(diffDays)} day(s)`;
        } else if (diffDays <= 2) {
          reason = `Due in ${diffDays === 0 ? 'today' : diffDays === 1 ? 'tomorrow' : '2 days'}`;
        } else if (diffDays <= 7 && t.estimated_minutes >= 60) {
          reason = `Due in ${diffDays} days, needs ${Math.round(t.estimated_minutes / 60)}h+`;
        } else {
          return null; // Not risky enough
        }
      } else if (t.urgency >= 60) {
        reason = `High urgency (${t.urgency}) with no deadline`;
      } else {
        return null;
      }

      return {
        id: t.id,
        name: t.name,
        estimatedMinutes: t.estimated_minutes,
        deadline: t.deadline,
        priorityScore,
        reason,
      };
    })
    .filter((t): t is RiskyTask => t !== null)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 5); // Top 5 riskiest

  // 5. Build summary message
  const availableHours = (availableMinutes / 60).toFixed(1);
  const requiredHours = (netRequiredMinutes / 60).toFixed(1);
  let summary: string;
  if (riskLevel === 'overloaded') {
    summary = `Your week is overloaded. You have ${availableHours}h available but ${requiredHours}h of tasks. Consider deferring or reducing scope on some tasks.`;
  } else if (riskLevel === 'tight') {
    summary = `Your week is tight. You have ${availableHours}h available for ${requiredHours}h of tasks — little room for unexpected work.`;
  } else {
    summary = `Your week looks manageable. ${availableHours}h available for ${requiredHours}h of tasks.`;
  }

  if (riskyTasks.length > 0) {
    const taskNames = riskyTasks.slice(0, 3).map(t => t.name).join(', ');
    summary += ` Watch out for: ${taskNames}.`;
  }

  console.log('[PLANNING] Risk analysis:', { riskLevel, riskRatio: riskRatio.toFixed(2), requiredMinutes: netRequiredMinutes, availableMinutes, riskyTasks: riskyTasks.length });

  return {
    requiredMinutes: netRequiredMinutes,
    availableMinutes,
    riskRatio: Math.round(riskRatio * 100) / 100,
    riskLevel,
    riskyTasks,
    summary,
  };
}
