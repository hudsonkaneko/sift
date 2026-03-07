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

    // Gap/buffer: very permissive — if the rule mentions gap/buffer/break/between/space
    // AND contains a number followed by "min", extract the number.
    // Catches: "10 minute gaps", "10-minute buffer", "leave a 10 min gap",
    // "gaps of 10 minutes", "Keep 10 minutes between tasks", etc.
    const gapKeywords = /gap|buffer|break|between|padding|space|spacing/;
    if (gapKeywords.test(lower)) {
      const numMatch = lower.match(/(\d+)[\s-]*min/);
      if (numMatch) {
        parsed.gapMinutes = Math.max(parsed.gapMinutes, parseInt(numMatch[1]));
      }
    }

    // Time restrictions: "no scheduling before 10am", "don't schedule after 8pm",
    // "start no earlier than 9am", "nothing before 10"
    const beforeMatch = lower.match(/before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (beforeMatch && /(?:no|don'?t|never|avoid|nothing|earliest|start)/.test(lower)) {
      let hour = parseInt(beforeMatch[1]);
      const minute = beforeMatch[2] ? parseInt(beforeMatch[2]) : 0;
      if (beforeMatch[3] === 'pm' && hour < 12) hour += 12;
      if (beforeMatch[3] === 'am' && hour === 12) hour = 0;
      const mins = hour * 60 + minute;
      parsed.noScheduleBefore = parsed.noScheduleBefore ? Math.max(parsed.noScheduleBefore, mins) : mins;
    }

    const afterMatch = lower.match(/after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (afterMatch && /(?:no|don'?t|never|avoid|nothing|latest|stop|end)/.test(lower)) {
      let hour = parseInt(afterMatch[1]);
      const minute = afterMatch[2] ? parseInt(afterMatch[2]) : 0;
      if (afterMatch[3] === 'pm' && hour < 12) hour += 12;
      if (afterMatch[3] === 'am' && hour === 12) hour = 0;
      const mins = hour * 60 + minute;
      parsed.noScheduleAfter = parsed.noScheduleAfter ? Math.min(parsed.noScheduleAfter, mins) : mins;
    }

    // Day restrictions: any rule mentioning a day name with a negative keyword
    for (const [name, dayNum] of Object.entries(DAY_NAMES)) {
      if (lower.includes(name) && /(?:no|don'?t|never|avoid|skip|off)/.test(lower)) {
        parsed.blockedDays.add(dayNum);
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
  const weekEndStr = (() => { const d = new Date(weekOf + 'T00:00:00'); d.setDate(d.getDate() + 6); return d.toISOString().split('T')[0]; })();

  // Step 1: Atomic delete — remove ALL unlocked slots for this week first
  // (prevents race conditions from concurrent generation calls)
  await supabase.from('scheduled_slots').delete()
    .eq('user_id', userId).eq('week_of', weekOf).eq('locked', false);

  // Step 2: Fetch data we need (after delete to avoid race with concurrent gen)
  const [tasksResult, completedTaskIdsResult, lockedSlotsResult, blocksResult, prefsResult, excludedSourcesResult] = await Promise.all([
    supabase.from('tasks').select('*').eq('user_id', userId).eq('completed', false),
    supabase.from('tasks').select('id').eq('user_id', userId).eq('completed', true),
    supabase.from('scheduled_slots').select('*').eq('user_id', userId).eq('week_of', weekOf).eq('locked', true),
    supabase.from('fixed_blocks').select('*').eq('user_id', userId)
      .or(`specific_date.is.null,and(specific_date.gte.${weekOf},specific_date.lte.${weekEndStr})`),
    supabase.from('scheduling_preferences').select('*').eq('user_id', userId).single(),
    supabase.from('google_calendar_sources').select('google_calendar_id').eq('user_id', userId).eq('affects_scheduling', false),
  ]);

  const tasks = tasksResult.data || [];
  const completedTaskIds = new Set((completedTaskIdsResult.data || []).map((t: { id: string }) => t.id));
  const allLockedSlots = lockedSlotsResult.data || [];
  // Active locked slots block time; completed task slots get cleaned up
  const lockedSlots = allLockedSlots.filter((s: { task_id: string }) => !completedTaskIds.has(s.task_id));
  const prefs = prefsResult.data;

  // Step 3: Delete completed-task locked slots (prevent cascading overlap)
  const completedSlotIds = allLockedSlots
    .filter((s: { task_id: string }) => completedTaskIds.has(s.task_id))
    .map((s: { id: string }) => s.id);
  if (completedSlotIds.length > 0) {
    await supabase.from('scheduled_slots').delete().in('id', completedSlotIds).eq('user_id', userId);
  }

  // Filter out fixed blocks from calendars excluded from scheduling
  const excludedCalendarIds = new Set(
    (excludedSourcesResult.data || []).map((s: { google_calendar_id: string }) => s.google_calendar_id)
  );
  const allBlocks = blocksResult.data || [];
  const fixedBlocks = allBlocks.filter(
    (fb: { google_calendar_id: string | null }) =>
      !fb.google_calendar_id || !excludedCalendarIds.has(fb.google_calendar_id)
  );

  console.log(`[generate] fixedBlocks: ${fixedBlocks.length} (of ${allBlocks.length} total, ${excludedCalendarIds.size} excluded calendars)`);

  const earliestHour = prefs?.earliest_hour ?? 9;
  const latestHour = prefs?.latest_hour ?? 23;
  const minBlockMinutes = prefs?.min_block_minutes ?? 30;
  const preferMornings = prefs?.prefer_mornings ?? true;
  const preferEvenings = prefs?.prefer_evenings ?? true;
  const avoidWeekends = prefs?.avoid_weekends ?? false;
  const customRules = prefs?.custom_rules ?? [];

  // Parse custom rules into structured constraints
  const parsedRules = parseCustomRules(customRules);
  console.log(`[generate] customRules:`, customRules, `parsed:`, {
    gapMinutes: parsedRules.gapMinutes,
    blockedDays: [...parsedRules.blockedDays],
    noScheduleBefore: parsedRules.noScheduleBefore,
    noScheduleAfter: parsedRules.noScheduleAfter,
  });

  // Calculate locked minutes per task (tasks may have partial locked slots)
  const lockedMinutesByTask = new Map<string, number>();
  for (const slot of lockedSlots) {
    const duration = (slot.end_hour * 60 + slot.end_minute) - (slot.start_hour * 60 + slot.start_minute);
    lockedMinutesByTask.set(slot.task_id, (lockedMinutesByTask.get(slot.task_id) || 0) + duration);
  }

  // Filter schedulable tasks: incomplete, not parent shells (estimatedMinutes > 0),
  // and still have remaining time to schedule
  const schedulableTasks = tasks.filter(t => {
    if (t.estimated_minutes <= 0) return false;
    const locked = lockedMinutesByTask.get(t.id) || 0;
    return t.estimated_minutes > locked; // still has unscheduled time
  });

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

  // Tiered priority: deadline proximity dominates (tiers 200+ apart),
  // urgency (0-100) only differentiates within the same deadline tier.
  function taskPriority(t: { deadline: string | null; urgency: number; estimated_minutes: number }): number {
    let score = t.urgency ?? 0;
    if (t.deadline) {
      const deadlineDate = new Date(t.deadline + 'T00:00:00');
      const diffDays = Math.floor((deadlineDate.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) score += 1000;           // overdue
      else if (diffDays === 0) score += 900;      // due today
      else if (diffDays <= 2) score += 700 + (2 - diffDays) * 50;  // 1d=750, 2d=700
      else if (diffDays <= 7) score += 400 + (7 - diffDays) * 40;  // 3d=560 … 7d=400
      else if (diffDays <= 14) score += 200 + (14 - diffDays) * 20; // 8d=320 … 14d=200
      else score += 110;                          // 15+ days
    }
    return score;
  }

  // For deadline-aware day placement: compute the day-of-week the deadline falls on
  // within this week (or null if deadline is outside this week or absent)
  function deadlineDayInWeek(t: { deadline: string | null }): number | null {
    if (!t.deadline) return null;
    const deadlineDate = new Date(t.deadline + 'T00:00:00');
    const weekStart = new Date(weekOf + 'T00:00:00');
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (deadlineDate < weekStart || deadlineDate > weekEnd) return null;
    return deadlineDate.getDay();
  }

  schedulableTasks.sort((a, b) => taskPriority(b) - taskPriority(a));

  // Build occupied intervals per day (0-6)
  const occupiedPerDay: Map<number, Interval[]> = new Map();
  for (let d = 0; d < 7; d++) occupiedPerDay.set(d, []);

  // Add fixed blocks (calendar events + user-created blocks)
  // Google Calendar blocks get a 10-minute buffer on each side for travel/transition time
  const GCAL_BUFFER_MINUTES = 10;
  for (const fb of fixedBlocks) {
    const day = fb.day_of_week;
    if (day == null || day < 0 || day > 6) {
      console.warn(`[generate] skipping fixed block with invalid day_of_week:`, fb.id, day);
      continue;
    }
    const intervals = occupiedPerDay.get(day)!;
    const blockStart = fb.start_hour * 60 + fb.start_minute;
    const blockEnd = fb.end_hour * 60 + fb.end_minute;
    if (fb.google_event_id) {
      // Pad Google Calendar events with buffer for travel time
      intervals.push({
        start: Math.max(0, blockStart - GCAL_BUFFER_MINUTES),
        end: Math.min(24 * 60, blockEnd + GCAL_BUFFER_MINUTES),
      });
    } else {
      intervals.push({ start: blockStart, end: blockEnd });
    }
  }

  // Add locked slots
  for (const slot of lockedSlots) {
    const day = slot.day_of_week;
    if (day == null || day < 0 || day > 6) continue;
    const intervals = occupiedPerDay.get(day)!;
    intervals.push({
      start: slot.start_hour * 60 + slot.start_minute,
      end: slot.end_hour * 60 + slot.end_minute,
    });
  }

  // Debug: log occupied intervals per day
  for (let d = 0; d < 7; d++) {
    const intervals = occupiedPerDay.get(d)!;
    if (intervals.length > 0) {
      console.log(`[generate] day ${d} occupied: ${intervals.map(i => `${Math.floor(i.start/60)}:${String(i.start%60).padStart(2,'0')}-${Math.floor(i.end/60)}:${String(i.end%60).padStart(2,'0')}`).join(', ')}`);
    }
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

  // Apply custom rule time overrides on top of preferences (clamp to valid range)
  let dayStart = earliestHour * 60;
  if (parsedRules.noScheduleBefore && parsedRules.noScheduleBefore > 0 && parsedRules.noScheduleBefore < 24 * 60) {
    dayStart = Math.max(dayStart, parsedRules.noScheduleBefore);
  }
  let dayEnd = latestHour * 60;
  if (parsedRules.noScheduleAfter && parsedRules.noScheduleAfter > 0 && parsedRules.noScheduleAfter < 24 * 60) {
    dayEnd = Math.min(dayEnd, parsedRules.noScheduleAfter);
  }
  // Ensure dayStart < dayEnd
  if (dayStart >= dayEnd) {
    console.warn(`[generate] dayStart (${dayStart}) >= dayEnd (${dayEnd}), resetting to preference defaults`);
    dayStart = earliestHour * 60;
    dayEnd = latestHour * 60;
  }

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

    // Deadline-aware day ordering: prefer days on/before the deadline
    const dlDay = deadlineDayInWeek(task);
    let taskDayOrder = dayOrder;
    if (dlDay !== null) {
      // Put days up to the deadline first (sorted ascending), then days after
      const beforeOrOn = dayOrder.filter(d => {
        const dAdj = d === 0 ? 7 : d;
        const dlAdj = dlDay === 0 ? 7 : dlDay;
        return dAdj <= dlAdj;
      });
      const after = dayOrder.filter(d => {
        const dAdj = d === 0 ? 7 : d;
        const dlAdj = dlDay === 0 ? 7 : dlDay;
        return dAdj > dlAdj;
      });
      taskDayOrder = [...beforeOrOn, ...after];
    }

    for (const day of taskDayOrder) {
      if (remaining <= 0) break;

      const occupied = occupiedPerDay.get(day) || [];
      const effectiveDayStart = (isCurrentWeek && day === todayDayOfWeek)
        ? Math.max(dayStart, Math.ceil(currentTimeMinutes / 15) * 15)
        : dayStart;
      let gaps = findGaps(occupied, effectiveDayStart, dayEnd, minBlockMinutes);
      console.log(`[generate] task "${task.name}" day ${day}: ${gaps.length} gaps found (occupied: ${occupied.length} intervals, window: ${effectiveDayStart}-${dayEnd})`);

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

  // Log final occupied state for debugging overlaps
  for (let d = 0; d < 7; d++) {
    const intervals = occupiedPerDay.get(d)!;
    if (intervals.length > 0) {
      const merged = mergeIntervals([...intervals]);
      console.log(`[generate] day ${d} final occupied (${merged.length} merged): ${merged.map(i => `${Math.floor(i.start/60)}:${String(i.start%60).padStart(2,'0')}-${Math.floor(i.end/60)}:${String(i.end%60).padStart(2,'0')}`).join(', ')}`);
    }
  }

  return NextResponse.json({
    slotsCreated: newSlots.length,
    tasksScheduled: new Set(newSlots.map(s => s.task_id)).size,
    debug: {
      fixedBlocksTotal: allBlocks.length,
      fixedBlocksUsed: fixedBlocks.length,
      excludedCalendars: excludedCalendarIds.size,
      lockedSlots: lockedSlots.length,
      completedSlotsRemoved: completedSlotIds.length,
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
  });
}
