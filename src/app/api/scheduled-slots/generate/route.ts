import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

interface Interval {
  start: number; // minutes from midnight
  end: number;
}

// Parsed constraints extracted from free-text custom rules
interface ParsedRules {
  gapMinutes: number; // buffer between scheduled slots (default 0)
  blockedDays: Set<number>; // days to avoid entirely (0=Sun...6=Sat)
  noScheduleBefore: number | null; // override earliest hour (minutes from midnight)
  noScheduleAfter: number | null; // override latest hour (minutes from midnight)
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

function parseCustomRules(rules: string[]): ParsedRules {
  const parsed: ParsedRules = {
    gapMinutes: 0,
    blockedDays: new Set(),
    noScheduleBefore: null,
    noScheduleAfter: null,
  };

  for (const rule of rules) {
    const lower = rule.toLowerCase();

    // Gap/buffer: "10 minute gap", "15 min buffer", "leave 10 minutes between"
    const gapMatch = lower.match(/(\d+)\s*(?:min(?:ute)?s?)\s*(?:gap|buffer|break|between|padding|space)/);
    if (!gapMatch) {
      // Also try: "leave X minutes between", "X min gaps"
      const gapMatch2 = lower.match(/(?:leave|add|put|have)\s*(\d+)\s*(?:min(?:ute)?s?)/);
      if (gapMatch2) {
        parsed.gapMinutes = Math.max(parsed.gapMinutes, parseInt(gapMatch2[1]));
      }
    } else {
      parsed.gapMinutes = Math.max(parsed.gapMinutes, parseInt(gapMatch[1]));
    }

    // Time restrictions: "no scheduling before 10am", "don't schedule after 8pm"
    const beforeMatch = lower.match(/(?:no|don'?t|never|avoid)\s*schedul\w*\s*before\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (beforeMatch) {
      let hour = parseInt(beforeMatch[1]);
      const minute = beforeMatch[2] ? parseInt(beforeMatch[2]) : 0;
      if (beforeMatch[3] === 'pm' && hour < 12) hour += 12;
      if (beforeMatch[3] === 'am' && hour === 12) hour = 0;
      const mins = hour * 60 + minute;
      parsed.noScheduleBefore = parsed.noScheduleBefore ? Math.max(parsed.noScheduleBefore, mins) : mins;
    }

    const afterMatch = lower.match(/(?:no|don'?t|never|avoid)\s*schedul\w*\s*after\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (afterMatch) {
      let hour = parseInt(afterMatch[1]);
      const minute = afterMatch[2] ? parseInt(afterMatch[2]) : 0;
      if (afterMatch[3] === 'pm' && hour < 12) hour += 12;
      if (afterMatch[3] === 'am' && hour === 12) hour = 0;
      const mins = hour * 60 + minute;
      parsed.noScheduleAfter = parsed.noScheduleAfter ? Math.min(parsed.noScheduleAfter, mins) : mins;
    }

    // Day restrictions: "no scheduling on fridays", "don't schedule on sunday"
    const dayMatch = lower.match(/(?:no|don'?t|never|avoid)\s*schedul\w*\s*(?:on\s*)?(\w+)/);
    if (dayMatch) {
      const dayName = dayMatch[1];
      // Strip trailing 's' for plurals like "fridays"
      const normalized = dayName.replace(/s$/, '');
      if (DAY_NAMES[normalized] !== undefined) {
        parsed.blockedDays.add(DAY_NAMES[normalized]);
      }
    }
  }

  return parsed;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  intervals.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [{ ...intervals[0] }];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i].start <= last.end) {
      last.end = Math.max(last.end, intervals[i].end);
    } else {
      merged.push({ ...intervals[i] });
    }
  }
  return merged;
}

function findGaps(occupied: Interval[], dayStart: number, dayEnd: number, minBlock: number): Interval[] {
  const merged = mergeIntervals(occupied);
  const gaps: Interval[] = [];
  let cursor = dayStart;

  for (const interval of merged) {
    if (interval.start > cursor) {
      const gap = interval.start - cursor;
      if (gap >= minBlock) {
        gaps.push({ start: cursor, end: interval.start });
      }
    }
    cursor = Math.max(cursor, interval.end);
  }

  if (cursor < dayEnd) {
    const gap = dayEnd - cursor;
    if (gap >= minBlock) {
      gaps.push({ start: cursor, end: dayEnd });
    }
  }

  return gaps;
}

/**
 * POST /api/scheduled-slots/generate
 *
 * Auto-generates a schedule for the current week:
 * 1. Fetches incomplete tasks, existing locked slots, fixed blocks, preferences
 * 2. Deletes unlocked slots for this week
 * 3. Builds occupied intervals per day
 * 4. Sorts tasks by priority (deadline proximity + urgency)
 * 5. Greedily places tasks into available gaps
 */
export async function POST(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { weekOf, timezone } = await req.json();
  if (!weekOf) {
    return NextResponse.json({ error: 'weekOf is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Fetch all needed data in parallel
  const [tasksResult, lockedSlotsResult, allSlotsResult, blocksResult, prefsResult, excludedSourcesResult] = await Promise.all([
    supabase.from('tasks').select('*').eq('user_id', userId).eq('completed', false),
    supabase.from('scheduled_slots').select('*').eq('user_id', userId).eq('week_of', weekOf).eq('locked', true),
    supabase.from('scheduled_slots').select('id').eq('user_id', userId).eq('week_of', weekOf).eq('locked', false),
    supabase.from('fixed_blocks').select('*').eq('user_id', userId)
      .or(`specific_date.is.null,and(specific_date.gte.${weekOf},specific_date.lte.${(() => { const d = new Date(weekOf + 'T00:00:00'); d.setDate(d.getDate() + 6); return d.toISOString().split('T')[0]; })()})`),
    supabase.from('scheduling_preferences').select('*').eq('user_id', userId).single(),
    supabase.from('google_calendar_sources').select('google_calendar_id').eq('user_id', userId).eq('affects_scheduling', false),
  ]);

  const tasks = tasksResult.data || [];
  const lockedSlots = lockedSlotsResult.data || [];
  const unlockedSlotIds = (allSlotsResult.data || []).map(s => s.id);
  const prefs = prefsResult.data;

  // Filter out fixed blocks from calendars excluded from scheduling
  const excludedCalendarIds = new Set(
    (excludedSourcesResult.data || []).map((s: { google_calendar_id: string }) => s.google_calendar_id)
  );
  const fixedBlocks = (blocksResult.data || []).filter(
    (fb: { google_calendar_id: string | null }) =>
      !fb.google_calendar_id || !excludedCalendarIds.has(fb.google_calendar_id)
  );

  const earliestHour = prefs?.earliest_hour ?? 9;
  const latestHour = prefs?.latest_hour ?? 23;
  const minBlockMinutes = prefs?.min_block_minutes ?? 30;
  const preferMornings = prefs?.prefer_mornings ?? true;
  const preferEvenings = prefs?.prefer_evenings ?? true;
  const avoidWeekends = prefs?.avoid_weekends ?? false;
  const customRules = prefs?.custom_rules ?? [];

  // Parse custom rules into structured constraints
  const parsedRules = parseCustomRules(customRules);

  // Delete unlocked slots (they'll be regenerated)
  if (unlockedSlotIds.length > 0) {
    await supabase.from('scheduled_slots').delete().in('id', unlockedSlotIds).eq('user_id', userId);
  }

  // Filter schedulable tasks: incomplete, not parent shells (estimatedMinutes > 0), no locked slots already
  const lockedTaskIds = new Set(lockedSlots.map(s => s.task_id));
  const schedulableTasks = tasks.filter(t =>
    t.estimated_minutes > 0 && !lockedTaskIds.has(t.id)
  );

  // Calculate remaining minutes for tasks that have partial locked slots
  const lockedMinutesByTask = new Map<string, number>();
  for (const slot of lockedSlots) {
    const duration = (slot.end_hour * 60 + slot.end_minute) - (slot.start_hour * 60 + slot.start_minute);
    lockedMinutesByTask.set(slot.task_id, (lockedMinutesByTask.get(slot.task_id) || 0) + duration);
  }

  // Sort tasks by priority: deadline proximity + urgency
  // Use client timezone so "today" and "current time" are correct
  // (Vercel runs in UTC; without this, a PST user at 2pm would look like 10pm to the server)
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
  const currentTimeMinutes = localHour * 60 + localMinute;

  function taskPriority(t: { deadline: string | null; urgency: number; estimated_minutes: number }): number {
    let score = t.urgency ?? 0;
    if (t.deadline) {
      const deadlineDate = new Date(t.deadline + 'T00:00:00');
      const diffDays = Math.floor((deadlineDate.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) score += 100;
      else if (diffDays === 0) score += 80;
      else if (diffDays === 1) score += 50;
      else if (diffDays <= 7) score += 30;
      else if (diffDays <= 14) score += 10;
    }
    if (t.estimated_minutes > 0 && t.estimated_minutes <= 30) score += 5;
    return score;
  }

  schedulableTasks.sort((a, b) => taskPriority(b) - taskPriority(a));

  // Build occupied intervals per day (0-6)
  const occupiedPerDay: Map<number, Interval[]> = new Map();
  for (let d = 0; d < 7; d++) occupiedPerDay.set(d, []);

  // Add fixed blocks
  for (const fb of fixedBlocks) {
    const intervals = occupiedPerDay.get(fb.day_of_week)!;
    intervals.push({
      start: fb.start_hour * 60 + fb.start_minute,
      end: fb.end_hour * 60 + fb.end_minute,
    });
  }

  // Add locked slots
  for (const slot of lockedSlots) {
    const intervals = occupiedPerDay.get(slot.day_of_week)!;
    intervals.push({
      start: slot.start_hour * 60 + slot.start_minute,
      end: slot.end_hour * 60 + slot.end_minute,
    });
  }

  // Determine day order based on preferences, skipping past days for current week
  const todayDayOfWeek = todayMidnight.getDay(); // 0=Sun, 1=Mon, ...
  const weekOfDate = new Date(weekOf + 'T00:00:00');
  const weekOfSunday = new Date(weekOfDate);
  weekOfSunday.setDate(weekOfSunday.getDate() - weekOfSunday.getDay());
  const todaySunday = new Date(todayMidnight);
  todaySunday.setDate(todaySunday.getDate() - todaySunday.getDay());
  const isCurrentWeek = weekOfSunday.getTime() === todaySunday.getTime();

  let dayOrder: number[];
  if (avoidWeekends) {
    dayOrder = [1, 2, 3, 4, 5]; // Mon-Fri
  } else {
    dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Weekdays first, then weekend
  }

  // Remove days blocked by custom rules
  if (parsedRules.blockedDays.size > 0) {
    dayOrder = dayOrder.filter(d => !parsedRules.blockedDays.has(d));
  }

  // Only schedule on today and future days if generating for the current week
  if (isCurrentWeek) {
    // dayOrder may have Sunday (0) at the end after weekdays (1-6),
    // so compare by position in the week relative to today
    dayOrder = dayOrder.filter(d => {
      // Treat Sunday (0) as 7 for ordering when it comes after Saturday
      const dAdj = d === 0 ? 7 : d;
      const todayAdj = todayDayOfWeek === 0 ? 7 : todayDayOfWeek;
      return dAdj >= todayAdj;
    });
  }

  // Apply custom rule time overrides on top of preferences
  const dayStart = parsedRules.noScheduleBefore
    ? Math.max(earliestHour * 60, parsedRules.noScheduleBefore)
    : earliestHour * 60;
  const dayEnd = parsedRules.noScheduleAfter
    ? Math.min(latestHour * 60, parsedRules.noScheduleAfter)
    : latestHour * 60;

  // Greedily place tasks into gaps
  const newSlots: {
    user_id: string;
    task_id: string;
    day_of_week: number;
    start_hour: number;
    start_minute: number;
    end_hour: number;
    end_minute: number;
    week_of: string;
    locked: false;
  }[] = [];

  for (const task of schedulableTasks) {
    let remaining = task.estimated_minutes - (lockedMinutesByTask.get(task.id) || 0);
    if (remaining <= 0) continue;

    for (const day of dayOrder) {
      if (remaining <= 0) break;

      const occupied = occupiedPerDay.get(day) || [];
      const effectiveDayStart = (isCurrentWeek && day === todayDayOfWeek)
        ? Math.max(dayStart, Math.ceil(currentTimeMinutes / 15) * 15)
        : dayStart;
      let gaps = findGaps(occupied, effectiveDayStart, dayEnd, minBlockMinutes);

      // Apply morning/evening preference for gap ordering
      if (!preferMornings && preferEvenings) {
        gaps.reverse(); // prefer later gaps
      }

      for (const gap of gaps) {
        if (remaining <= 0) break;
        const gapDuration = gap.end - gap.start;
        const placed = Math.min(remaining, gapDuration);

        if (placed < minBlockMinutes && remaining >= minBlockMinutes) {
          continue; // skip gaps too small unless we have less remaining
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

        // Mark this interval as occupied (with gap buffer for spacing between tasks)
        const occupiedEnd = parsedRules.gapMinutes > 0
          ? Math.min(slotEnd + parsedRules.gapMinutes, dayEnd)
          : slotEnd;
        occupiedPerDay.get(day)!.push({ start: slotStart, end: occupiedEnd });
        remaining -= placed;
      }
    }
  }

  // Batch insert new slots
  if (newSlots.length > 0) {
    const { error } = await supabase.from('scheduled_slots').insert(newSlots);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    slotsCreated: newSlots.length,
    tasksScheduled: new Set(newSlots.map(s => s.task_id)).size,
    unlockedRemoved: unlockedSlotIds.length,
  });
}
