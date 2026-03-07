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

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtMin(m: number): string {
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

function parseCustomRules(rules: string[]): ParsedRules {
  const parsed: ParsedRules = {
    gapMinutes: 0,
    blockedDays: new Set(),
    noScheduleBefore: null,
    noScheduleAfter: null,
  };

  for (const rule of rules) {
    const lower = rule.toLowerCase();

    const gapKeywords = /gap|buffer|break|between|padding|space|spacing/;
    if (gapKeywords.test(lower)) {
      const numMatch = lower.match(/(\d+)[\s-]*min/);
      if (numMatch) {
        parsed.gapMinutes = Math.max(parsed.gapMinutes, parseInt(numMatch[1]));
      }
    }

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

export async function POST(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { weekOf, timezone } = await req.json();
  if (!weekOf) {
    return NextResponse.json({ error: 'weekOf is required' }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const debug: Record<string, any> = {};

  const supabase = createServiceClient();

  // Generate the 7 date strings for this week (Sun through Sat)
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekOf + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    weekDates.push(d.toISOString().split('T')[0]);
  }
  const weekEndStr = weekDates[6];

  // Compute today's local date string using timezone-aware formatting
  const tz = timezone || 'UTC';
  const now = new Date();
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
  const todayDateStr = `${localYear}-${String(localMonth).padStart(2, '0')}-${String(localDay).padStart(2, '0')}`;
  const currentTimeMinutes = localHour * 60 + localMinute;
  const todayDow = new Date(todayDateStr + 'T12:00:00Z').getUTCDay();

  const isCurrentWeek = todayDateStr >= weekDates[0] && todayDateStr <= weekDates[6];

  debug.input = {
    weekOf,
    timezone: tz,
    serverTime: now.toISOString(),
    weekDates: weekDates.map(d => `${d} (${DOW_LABELS[new Date(d + 'T12:00:00Z').getUTCDay()]})`),
    todayDateStr,
    todayDow: `${todayDow} (${DOW_LABELS[todayDow]})`,
    todayInWeek: weekDates.includes(todayDateStr),
    currentTimeMinutes: `${currentTimeMinutes} (${fmtMin(currentTimeMinutes)})`,
    isCurrentWeek,
  };

  // Step 1: Delete unlocked slots for this week
  const delResult = await supabase.from('scheduled_slots').delete()
    .eq('user_id', userId).eq('locked', false)
    .gte('scheduled_date', weekDates[0])
    .lte('scheduled_date', weekEndStr)
    .select('id, scheduled_date, day_of_week');

  debug.deletedSlots = delResult.data?.length ?? 0;

  // Step 2: Fetch data
  const [tasksResult, completedTaskIdsResult, lockedSlotsResult, blocksResult, prefsResult, excludedSourcesResult] = await Promise.all([
    supabase.from('tasks').select('*').eq('user_id', userId).eq('completed', false),
    supabase.from('tasks').select('id').eq('user_id', userId).eq('completed', true),
    supabase.from('scheduled_slots').select('*').eq('user_id', userId)
      .gte('scheduled_date', weekDates[0]).lte('scheduled_date', weekEndStr).eq('locked', true),
    supabase.from('fixed_blocks').select('*').eq('user_id', userId)
      .or(`specific_date.is.null,and(specific_date.gte.${weekDates[0]},specific_date.lte.${weekEndStr})`),
    supabase.from('scheduling_preferences').select('*').eq('user_id', userId).single(),
    supabase.from('google_calendar_sources').select('google_calendar_id').eq('user_id', userId).eq('affects_scheduling', false),
  ]);

  if (blocksResult.error) {
    return NextResponse.json({ error: 'Failed to fetch calendar events: ' + blocksResult.error.message }, { status: 500 });
  }
  if (tasksResult.error) {
    return NextResponse.json({ error: 'Failed to fetch tasks: ' + tasksResult.error.message }, { status: 500 });
  }

  const tasks = tasksResult.data || [];
  const completedTaskIds = new Set((completedTaskIdsResult.data || []).map((t: { id: string }) => t.id));
  const allLockedSlots = lockedSlotsResult.data || [];
  const lockedSlots = allLockedSlots.filter((s: { task_id: string }) => !completedTaskIds.has(s.task_id));
  const prefs = prefsResult.data;

  // Cross-week deduction
  const { data: allTaskSlots } = await supabase
    .from('scheduled_slots')
    .select('task_id, start_hour, start_minute, end_hour, end_minute, scheduled_date, locked')
    .eq('user_id', userId);

  // Delete completed-task locked slots
  const completedSlotIds = allLockedSlots
    .filter((s: { task_id: string }) => completedTaskIds.has(s.task_id))
    .map((s: { id: string }) => s.id);
  if (completedSlotIds.length > 0) {
    await supabase.from('scheduled_slots').delete().in('id', completedSlotIds).eq('user_id', userId);
  }

  // Filter out excluded calendar blocks
  const excludedCalendarIds = new Set(
    (excludedSourcesResult.data || []).map((s: { google_calendar_id: string }) => s.google_calendar_id)
  );
  const allBlocks = blocksResult.data || [];
  const fixedBlocks = allBlocks.filter(
    (fb: { google_calendar_id: string | null }) =>
      !fb.google_calendar_id || !excludedCalendarIds.has(fb.google_calendar_id)
  );

  const earliestHour = prefs?.earliest_hour ?? 9;
  const latestHour = prefs?.latest_hour ?? 23;
  const minBlockMinutes = prefs?.min_block_minutes ?? 30;
  const preferMornings = prefs?.prefer_mornings ?? true;
  const preferEvenings = prefs?.prefer_evenings ?? true;
  const avoidWeekends = false; // FORCED OFF for debugging
  const customRules = prefs?.custom_rules ?? [];

  const parsedRules = parseCustomRules(customRules);

  debug.preferences = {
    earliestHour,
    latestHour,
    minBlockMinutes,
    preferMornings,
    preferEvenings,
    avoidWeekends,
    avoidWeekendsFromDB: prefs?.avoid_weekends ?? 'no prefs row',
    customRules,
    parsedRules: {
      gapMinutes: parsedRules.gapMinutes,
      blockedDays: [...parsedRules.blockedDays].map(d => `${d} (${DOW_LABELS[d]})`),
      noScheduleBefore: parsedRules.noScheduleBefore,
      noScheduleAfter: parsedRules.noScheduleAfter,
    },
  };

  // Cross-week scheduled minutes
  const scheduledMinutesByTask = new Map<string, number>();
  for (const slot of (allTaskSlots || [])) {
    if (completedTaskIds.has(slot.task_id)) continue;
    const slotDate = slot.scheduled_date;
    const isInCurrentWeek = slotDate >= weekDates[0] && slotDate <= weekDates[6];
    if (isInCurrentWeek && !slot.locked) continue;
    const duration = (slot.end_hour * 60 + slot.end_minute) - (slot.start_hour * 60 + slot.start_minute);
    scheduledMinutesByTask.set(slot.task_id, (scheduledMinutesByTask.get(slot.task_id) || 0) + duration);
  }

  // Debug: show ALL incomplete tasks and why each is included/excluded
  debug.allIncompleteTasks = tasks.map(t => {
    const alreadyScheduled = scheduledMinutesByTask.get(t.id) || 0;
    let filterReason = null;
    if (t.estimated_minutes <= 0) filterReason = 'estimated_minutes=0 (parent shell)';
    else if (t.estimated_minutes <= alreadyScheduled) filterReason = `fully scheduled (${alreadyScheduled}/${t.estimated_minutes}min in other weeks)`;
    return {
      name: t.name,
      id: t.id.slice(0, 8),
      estimatedMinutes: t.estimated_minutes,
      alreadyScheduledInOtherWeeks: alreadyScheduled,
      parentId: t.parent_id ? t.parent_id.slice(0, 8) : null,
      schedulable: !filterReason,
      filterReason,
    };
  });

  // Debug: show cross-week slots that are eating up task time
  const crossWeekSlots = (allTaskSlots || []).filter(s => {
    const slotDate = s.scheduled_date;
    const isInCurrentWeek = slotDate >= weekDates[0] && slotDate <= weekDates[6];
    return !isInCurrentWeek && !completedTaskIds.has(s.task_id);
  });
  debug.crossWeekSlots = {
    count: crossWeekSlots.length,
    byWeek: Object.fromEntries(
      [...new Set(crossWeekSlots.map(s => s.scheduled_date))].sort().map(date => [
        date,
        crossWeekSlots.filter(s => s.scheduled_date === date).map(s => ({
          taskId: s.task_id.slice(0, 8),
          time: `${fmtMin(s.start_hour * 60 + s.start_minute)}-${fmtMin(s.end_hour * 60 + s.end_minute)}`,
          locked: s.locked,
        })),
      ])
    ),
  };

  const schedulableTasks = tasks.filter(t => {
    if (t.estimated_minutes <= 0) return false;
    const locked = scheduledMinutesByTask.get(t.id) || 0;
    return t.estimated_minutes > locked;
  });

  const todayMidnight = new Date(todayDateStr + 'T00:00:00');
  function taskPriority(t: { deadline: string | null; urgency: number; estimated_minutes: number }): number {
    let score = t.urgency ?? 0;
    if (t.deadline) {
      const deadlineDate = new Date(t.deadline + 'T00:00:00');
      const diffDays = Math.floor((deadlineDate.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) score += 1000;
      else if (diffDays === 0) score += 900;
      else if (diffDays <= 2) score += 700 + (2 - diffDays) * 50;
      else if (diffDays <= 7) score += 400 + (7 - diffDays) * 40;
      else if (diffDays <= 14) score += 200 + (14 - diffDays) * 20;
      else score += 110;
    }
    return score;
  }

  function deadlineDateInWeek(t: { deadline: string | null }): string | null {
    if (!t.deadline) return null;
    if (t.deadline >= weekDates[0] && t.deadline <= weekDates[6]) {
      return t.deadline;
    }
    return null;
  }

  schedulableTasks.sort((a, b) => taskPriority(b) - taskPriority(a));

  debug.tasks = schedulableTasks.map(t => ({
    name: t.name,
    id: t.id.slice(0, 8),
    estimatedMinutes: t.estimated_minutes,
    alreadyScheduled: scheduledMinutesByTask.get(t.id) || 0,
    remaining: t.estimated_minutes - (scheduledMinutesByTask.get(t.id) || 0),
    deadline: t.deadline || 'none',
    urgency: t.urgency,
    priority: taskPriority(t),
  }));

  // Build occupied intervals per date
  const occupiedPerDate: Map<string, Interval[]> = new Map();
  for (const dateStr of weekDates) {
    occupiedPerDate.set(dateStr, []);
  }

  const GCAL_BUFFER_MINUTES = 10;
  for (const fb of fixedBlocks) {
    const blockStart = fb.start_hour * 60 + fb.start_minute;
    const blockEnd = fb.end_hour * 60 + fb.end_minute;
    const interval: Interval = fb.google_event_id
      ? { start: Math.max(0, blockStart - GCAL_BUFFER_MINUTES), end: Math.min(24 * 60, blockEnd + GCAL_BUFFER_MINUTES) }
      : { start: blockStart, end: blockEnd };

    if (fb.specific_date) {
      const dateIntervals = occupiedPerDate.get(fb.specific_date);
      if (dateIntervals) {
        dateIntervals.push(interval);
      }
    } else {
      for (const dateStr of weekDates) {
        const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
        if (dow === fb.day_of_week) {
          occupiedPerDate.get(dateStr)!.push({ ...interval });
        }
      }
    }
  }

  for (const slot of lockedSlots) {
    const dateStr = slot.scheduled_date;
    const dateIntervals = occupiedPerDate.get(dateStr);
    if (dateIntervals) {
      dateIntervals.push({
        start: slot.start_hour * 60 + slot.start_minute,
        end: slot.end_hour * 60 + slot.end_minute,
      });
    }
  }

  // Filter to schedulable dates
  const dateFilterLog: { date: string; dow: string; result: string; reasons: string[] }[] = [];
  let schedulableDates = weekDates.filter(dateStr => {
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    const reasons: string[] = [];
    if (avoidWeekends && (dow === 0 || dow === 6) && dateStr !== todayDateStr) reasons.push('weekend');
    if (parsedRules.blockedDays.has(dow)) reasons.push(`blockedDay(${DOW_LABELS[dow]})`);
    if (dateStr < todayDateStr) reasons.push('past');
    const keep = reasons.length === 0;
    dateFilterLog.push({
      date: dateStr,
      dow: DOW_LABELS[dow],
      result: keep ? 'KEEP' : 'SKIP',
      reasons,
    });
    return keep;
  });

  debug.dateFiltering = dateFilterLog;

  // Reorder: today first, then weekdays, then weekend
  schedulableDates.sort((a, b) => {
    if (a === todayDateStr && b !== todayDateStr) return -1;
    if (b === todayDateStr && a !== todayDateStr) return 1;
    const dowA = new Date(a + 'T12:00:00Z').getUTCDay();
    const dowB = new Date(b + 'T12:00:00Z').getUTCDay();
    const orderA = dowA === 0 ? 7 : dowA;
    const orderB = dowB === 0 ? 7 : dowB;
    return orderA - orderB;
  });

  debug.schedulableDatesOrdered = schedulableDates.map(d => {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    return `${d} (${DOW_LABELS[dow]})${d === todayDateStr ? ' ← TODAY' : ''}`;
  });

  // Time window
  let dayStart = earliestHour * 60;
  let dayEnd = latestHour < earliestHour
    ? latestHour * 60 + 24 * 60
    : latestHour * 60;
  dayEnd = Math.min(dayEnd, 24 * 60);

  if (parsedRules.noScheduleBefore && parsedRules.noScheduleBefore > 0 && parsedRules.noScheduleBefore < 24 * 60) {
    dayStart = Math.max(dayStart, parsedRules.noScheduleBefore);
  }
  if (parsedRules.noScheduleAfter && parsedRules.noScheduleAfter > 0 && parsedRules.noScheduleAfter < 24 * 60) {
    dayEnd = Math.min(dayEnd, parsedRules.noScheduleAfter);
  }
  if (dayStart >= dayEnd) {
    dayStart = 9 * 60;
    dayEnd = 23 * 60;
  }

  debug.timeWindow = {
    dayStart: `${dayStart} (${fmtMin(dayStart)})`,
    dayEnd: `${dayEnd} (${fmtMin(dayEnd)})`,
  };

  // Greedily place tasks into gaps
  const newSlots: {
    user_id: string;
    task_id: string;
    day_of_week: number;
    scheduled_date: string;
    start_hour: number;
    start_minute: number;
    end_hour: number;
    end_minute: number;
    week_of: string;
    locked: false;
  }[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const placementLog: any[] = [];

  for (const task of schedulableTasks) {
    let remaining = task.estimated_minutes - (scheduledMinutesByTask.get(task.id) || 0);
    if (remaining <= 0) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const taskLog: any = {
      task: task.name,
      id: task.id.slice(0, 8),
      remaining,
      placements: [],
    };

    const dlDate = deadlineDateInWeek(task);
    let taskDateOrder = schedulableDates;
    if (dlDate !== null) {
      const beforeOrOn = schedulableDates.filter(d => d <= dlDate);
      const after = schedulableDates.filter(d => d > dlDate);
      taskDateOrder = [...beforeOrOn, ...after];
      taskLog.deadlineReorder = dlDate;
    }

    for (const dateStr of taskDateOrder) {
      if (remaining <= 0) break;

      const occupied = occupiedPerDate.get(dateStr) || [];
      const effectiveDayStart = (dateStr === todayDateStr)
        ? Math.max(dayStart, Math.ceil(currentTimeMinutes / 15) * 15)
        : dayStart;

      const gaps = findGaps(occupied, effectiveDayStart, dayEnd, minBlockMinutes);

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
        const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();

        taskLog.placements.push({
          date: `${dateStr} (${DOW_LABELS[dow]})`,
          time: `${fmtMin(slotStart)}-${fmtMin(slotEnd)}`,
          minutes: placed,
        });

        newSlots.push({
          user_id: userId,
          task_id: task.id,
          day_of_week: dow,
          scheduled_date: dateStr,
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
        occupiedPerDate.get(dateStr)!.push({ start: slotStart, end: occupiedEnd });
        remaining -= placed;
      }
    }

    taskLog.remainingAfter = remaining;
    placementLog.push(taskLog);
  }

  debug.placements = placementLog;

  // Summary by date
  const slotsByDate = new Map<string, typeof newSlots>();
  for (const s of newSlots) {
    if (!slotsByDate.has(s.scheduled_date)) slotsByDate.set(s.scheduled_date, []);
    slotsByDate.get(s.scheduled_date)!.push(s);
  }
  debug.slotSummary = Object.fromEntries(
    [...slotsByDate.entries()].sort().map(([date, slots]) => [
      `${date} (${DOW_LABELS[slots[0].day_of_week]})`,
      slots.map(s => `${fmtMin(s.start_hour * 60 + s.start_minute)}-${fmtMin(s.end_hour * 60 + s.end_minute)} [${s.task_id.slice(0, 8)}]`),
    ])
  );

  debug.totals = {
    slotsCreated: newSlots.length,
    tasksScheduled: new Set(newSlots.map(s => s.task_id)).size,
    lockedSlots: lockedSlots.length,
    fixedBlocks: fixedBlocks.length,
  };

  // Batch insert new slots
  if (newSlots.length > 0) {
    const { error } = await supabase.from('scheduled_slots').insert(newSlots);
    if (error) {
      return NextResponse.json({ error: error.message, debug }, { status: 500 });
    }
  }

  return NextResponse.json({
    slotsCreated: newSlots.length,
    tasksScheduled: new Set(newSlots.map(s => s.task_id)).size,
    debug,
  });
}
