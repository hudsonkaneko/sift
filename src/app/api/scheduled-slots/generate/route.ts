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
    const gapKeywords = /gap|buffer|break|between|padding|space|spacing/;
    if (gapKeywords.test(lower)) {
      const numMatch = lower.match(/(\d+)[\s-]*min/);
      if (numMatch) {
        parsed.gapMinutes = Math.max(parsed.gapMinutes, parseInt(numMatch[1]));
      }
    }

    // Time restrictions: "no scheduling before 10am", "don't schedule after 8pm"
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
 * Auto-generates a schedule for the given week:
 * 1. Fetches incomplete tasks, existing locked slots, fixed blocks, preferences
 * 2. Deletes unlocked slots for schedulable dates
 * 3. Builds occupied intervals per date (keyed by "YYYY-MM-DD" strings)
 * 4. Sorts tasks by priority (deadline proximity + urgency)
 * 5. Greedily places tasks into available gaps
 *
 * Key change: uses actual calendar dates (scheduled_date) instead of abstract day numbers.
 */
export async function POST(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { weekOf, timezone } = await req.json();
  if (!weekOf) {
    return NextResponse.json({ error: 'weekOf is required' }, { status: 400 });
  }

  console.log(`[generate] === START === weekOf=${weekOf}, timezone=${timezone}, serverTime=${new Date().toISOString()}`);

  const supabase = createServiceClient();

  // Generate the 7 date strings for this week (Sun through Sat)
  const weekDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekOf + 'T12:00:00Z'); // noon UTC avoids DST edge
    d.setUTCDate(d.getUTCDate() + i);
    weekDates.push(d.toISOString().split('T')[0]);
  }
  const weekEndStr = weekDates[6];
  console.log(`[generate] weekDates=[${weekDates.join(', ')}]`);
  console.log(`[generate] weekDates DOWs=[${weekDates.map(d => new Date(d + 'T12:00:00Z').getUTCDay()).join(', ')}]`);

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

  console.log(`[generate] Intl parts: year=${localYear} month=${localMonth} day=${localDay} hour=${localHour} min=${localMinute}`);
  console.log(`[generate] todayDateStr="${todayDateStr}", currentTimeMinutes=${currentTimeMinutes}`);

  // Determine if this is the current week (today falls within the week's date range)
  const isCurrentWeek = todayDateStr >= weekDates[0] && todayDateStr <= weekDates[6];
  console.log(`[generate] isCurrentWeek=${isCurrentWeek} (${todayDateStr} >= ${weekDates[0]} && ${todayDateStr} <= ${weekDates[6]})`);

  // Step 1: Delete ALL unlocked slots for this week (entire week range).
  // We always clear the full week because past-day stale slots from buggy
  // previous generations need to be cleaned up too. Only locked (user-pinned)
  // slots survive.
  console.log(`[generate] DELETE unlocked slots where scheduled_date >= "${weekDates[0]}" AND <= "${weekEndStr}"`);
  const delResult = await supabase.from('scheduled_slots').delete()
    .eq('user_id', userId).eq('locked', false)
    .gte('scheduled_date', weekDates[0])
    .lte('scheduled_date', weekEndStr)
    .select('id, scheduled_date, day_of_week');
  console.log(`[generate] deleted ${delResult.data?.length ?? 0} unlocked slots:`, delResult.data?.map((s: { id: string; scheduled_date: string; day_of_week: number }) => `${s.scheduled_date}(dow=${s.day_of_week})`));

  // Step 2: Fetch data we need (after delete to avoid race with concurrent gen)
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

  // Check for query errors
  if (blocksResult.error) {
    console.error('[generate] ERROR fetching fixed blocks:', blocksResult.error);
    return NextResponse.json({ error: 'Failed to fetch calendar events: ' + blocksResult.error.message }, { status: 500 });
  }
  if (tasksResult.error) {
    console.error('[generate] ERROR fetching tasks:', tasksResult.error);
    return NextResponse.json({ error: 'Failed to fetch tasks: ' + tasksResult.error.message }, { status: 500 });
  }

  const tasks = tasksResult.data || [];
  const completedTaskIds = new Set((completedTaskIdsResult.data || []).map((t: { id: string }) => t.id));
  const allLockedSlots = lockedSlotsResult.data || [];
  // Active locked slots block time; completed task slots get cleaned up
  const lockedSlots = allLockedSlots.filter((s: { task_id: string }) => !completedTaskIds.has(s.task_id));
  const prefs = prefsResult.data;

  // Cross-week deduction: fetch ALL slots across all weeks to prevent task duplication
  const { data: allTaskSlots } = await supabase
    .from('scheduled_slots')
    .select('task_id, start_hour, start_minute, end_hour, end_minute, scheduled_date, locked')
    .eq('user_id', userId);

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

  // Log block details for debugging overlaps
  const recurringBlocks = fixedBlocks.filter((fb: { specific_date: string | null }) => !fb.specific_date);
  const dateBlocks = fixedBlocks.filter((fb: { specific_date: string | null }) => fb.specific_date);
  console.log(`[generate] fixedBlocks: ${fixedBlocks.length} (${recurringBlocks.length} recurring, ${dateBlocks.length} date-specific, ${allBlocks.length - fixedBlocks.length} excluded)`);
  for (const fb of fixedBlocks) {
    console.log(`[generate]   block: day=${fb.day_of_week} ${fb.start_hour}:${String(fb.start_minute).padStart(2,'0')}-${fb.end_hour}:${String(fb.end_minute).padStart(2,'0')} "${fb.name}" (date=${fb.specific_date || 'recurring'}, gcal=${!!fb.google_event_id})`);
  }

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

  // Cross-week scheduled minutes: count time already committed to each task.
  // Other weeks: count ALL slots (locked + unlocked) — committed schedule.
  // Current week: count only LOCKED slots (unlocked were deleted, will be regenerated).
  const scheduledMinutesByTask = new Map<string, number>();
  for (const slot of (allTaskSlots || [])) {
    if (completedTaskIds.has(slot.task_id)) continue;
    const slotDate = slot.scheduled_date;
    const isInCurrentWeek = slotDate >= weekDates[0] && slotDate <= weekDates[6];
    // Current week: only count locked (unlocked were just deleted above)
    // Other weeks: count all slots (they represent committed schedule)
    if (isInCurrentWeek && !slot.locked) continue;
    const duration = (slot.end_hour * 60 + slot.end_minute) - (slot.start_hour * 60 + slot.start_minute);
    scheduledMinutesByTask.set(slot.task_id, (scheduledMinutesByTask.get(slot.task_id) || 0) + duration);
  }

  // Filter schedulable tasks: incomplete, not parent shells (estimatedMinutes > 0),
  // and still have remaining time to schedule
  const schedulableTasks = tasks.filter(t => {
    if (t.estimated_minutes <= 0) return false;
    const locked = scheduledMinutesByTask.get(t.id) || 0;
    return t.estimated_minutes > locked; // still has unscheduled time
  });

  // Tiered priority: deadline proximity dominates (tiers 200+ apart),
  // urgency (0-100) only differentiates within the same deadline tier.
  const todayMidnight = new Date(todayDateStr + 'T00:00:00');
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

  // For deadline-aware day placement: find the date string of the deadline
  // if it falls within this week (or null if outside this week or absent)
  function deadlineDateInWeek(t: { deadline: string | null }): string | null {
    if (!t.deadline) return null;
    if (t.deadline >= weekDates[0] && t.deadline <= weekDates[6]) {
      return t.deadline;
    }
    return null;
  }

  schedulableTasks.sort((a, b) => taskPriority(b) - taskPriority(a));

  // Build occupied intervals per date (keyed by "YYYY-MM-DD" strings)
  const occupiedPerDate: Map<string, Interval[]> = new Map();
  for (const dateStr of weekDates) {
    occupiedPerDate.set(dateStr, []);
  }

  // Add fixed blocks (calendar events + user-created blocks)
  // Google Calendar blocks get a 10-minute buffer on each side for travel/transition time
  const GCAL_BUFFER_MINUTES = 10;
  for (const fb of fixedBlocks) {
    const blockStart = fb.start_hour * 60 + fb.start_minute;
    const blockEnd = fb.end_hour * 60 + fb.end_minute;
    const interval: Interval = fb.google_event_id
      ? { start: Math.max(0, blockStart - GCAL_BUFFER_MINUTES), end: Math.min(24 * 60, blockEnd + GCAL_BUFFER_MINUTES) }
      : { start: blockStart, end: blockEnd };

    if (fb.specific_date) {
      // Date-specific blocks go into their specific date
      const dateIntervals = occupiedPerDate.get(fb.specific_date);
      if (dateIntervals) {
        dateIntervals.push(interval);
      }
    } else {
      // Recurring blocks go into all 7 dates matching their day_of_week
      for (const dateStr of weekDates) {
        const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
        if (dow === fb.day_of_week) {
          occupiedPerDate.get(dateStr)!.push({ ...interval });
        }
      }
    }
  }

  // Add locked slots by their scheduled_date
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

  // Debug: log occupied intervals per date
  for (const dateStr of weekDates) {
    const intervals = occupiedPerDate.get(dateStr)!;
    if (intervals.length > 0) {
      console.log(`[generate] ${dateStr} occupied: ${intervals.map(i => `${Math.floor(i.start/60)}:${String(i.start%60).padStart(2,'0')}-${Math.floor(i.end/60)}:${String(i.end%60).padStart(2,'0')}`).join(', ')}`);
    }
  }

  // Filter to schedulable dates
  console.log(`[generate] --- DATE FILTERING (avoidWeekends=${avoidWeekends}, blockedDays=[${[...parsedRules.blockedDays]}]) ---`);
  let schedulableDates = weekDates.filter(dateStr => {
    const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    const reasons: string[] = [];
    if (avoidWeekends && (dow === 0 || dow === 6)) reasons.push('weekend');
    if (parsedRules.blockedDays.has(dow)) reasons.push(`blockedDay(${dow})`);
    if (isCurrentWeek && dateStr < todayDateStr) reasons.push(`pastDay(${dateStr}<${todayDateStr})`);
    const keep = reasons.length === 0;
    console.log(`[generate]   ${dateStr} (dow=${dow}): ${keep ? 'KEEP' : `SKIP [${reasons.join(', ')}]`}`);
    return keep;
  });

  // Reorder: today first (current week), then weekdays Mon-Fri, then weekend
  schedulableDates.sort((a, b) => {
    // Today always comes first
    if (isCurrentWeek) {
      if (a === todayDateStr && b !== todayDateStr) return -1;
      if (b === todayDateStr && a !== todayDateStr) return 1;
    }
    const dowA = new Date(a + 'T12:00:00Z').getUTCDay();
    const dowB = new Date(b + 'T12:00:00Z').getUTCDay();
    // Map: Sun(0)→7, Mon(1)→1, ..., Sat(6)→6  — puts Sunday last
    const orderA = dowA === 0 ? 7 : dowA;
    const orderB = dowB === 0 ? 7 : dowB;
    return orderA - orderB;
  });

  console.log(`[generate] schedulableDates after sort: [${schedulableDates.map(d => `${d}(dow=${new Date(d + 'T12:00:00Z').getUTCDay()})`).join(', ')}]`);

  // Apply custom rule time overrides on top of preferences (clamp to valid range)
  // Handle latestHour < earliestHour (e.g. 9am-3am means schedule until 3am = 27:00)
  let dayStart = earliestHour * 60;
  let dayEnd = latestHour < earliestHour
    ? latestHour * 60 + 24 * 60  // wrap past midnight: 3am → 1620 (27*60)
    : latestHour * 60;
  // Cap at 24:00 (1440) since our slot model uses 0-23 hours
  dayEnd = Math.min(dayEnd, 24 * 60);
  console.log(`[generate] time window: earliestHour=${earliestHour}, latestHour=${latestHour}, dayStart=${dayStart}, dayEnd=${dayEnd}`);

  if (parsedRules.noScheduleBefore && parsedRules.noScheduleBefore > 0 && parsedRules.noScheduleBefore < 24 * 60) {
    dayStart = Math.max(dayStart, parsedRules.noScheduleBefore);
  }
  if (parsedRules.noScheduleAfter && parsedRules.noScheduleAfter > 0 && parsedRules.noScheduleAfter < 24 * 60) {
    dayEnd = Math.min(dayEnd, parsedRules.noScheduleAfter);
  }
  // Ensure dayStart < dayEnd — fallback to safe hardcoded defaults
  if (dayStart >= dayEnd) {
    console.warn(`[generate] dayStart (${dayStart}) >= dayEnd (${dayEnd}), resetting to hardcoded 9:00-23:00`);
    dayStart = 9 * 60;
    dayEnd = 23 * 60;
  }

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

  console.log(`[generate] --- TASK PLACEMENT (${schedulableTasks.length} tasks, window=${dayStart}-${dayEnd}) ---`);
  for (const task of schedulableTasks) {
    let remaining = task.estimated_minutes - (scheduledMinutesByTask.get(task.id) || 0);
    if (remaining <= 0) continue;

    console.log(`[generate] TASK "${task.name}" (${task.id.slice(0,8)}): est=${task.estimated_minutes}min, scheduled=${scheduledMinutesByTask.get(task.id) || 0}min, remaining=${remaining}min, priority=${taskPriority(task)}`);

    // Deadline-aware date ordering: prefer dates on/before the deadline
    const dlDate = deadlineDateInWeek(task);
    let taskDateOrder = schedulableDates;
    if (dlDate !== null) {
      const beforeOrOn = schedulableDates.filter(d => d <= dlDate);
      const after = schedulableDates.filter(d => d > dlDate);
      taskDateOrder = [...beforeOrOn, ...after];
      console.log(`[generate]   deadline ${dlDate} in week → reordered dates: [${taskDateOrder.join(', ')}]`);
    }

    for (const dateStr of taskDateOrder) {
      if (remaining <= 0) break;

      const occupied = occupiedPerDate.get(dateStr) || [];
      const effectiveDayStart = (isCurrentWeek && dateStr === todayDateStr)
        ? Math.max(dayStart, Math.ceil(currentTimeMinutes / 15) * 15)
        : dayStart;

      // Log occupied intervals BEFORE finding gaps
      const mergedOccupied = occupied.length > 0 ? mergeIntervals([...occupied]) : [];
      console.log(`[generate]   ${dateStr}: effectiveDayStart=${effectiveDayStart}, occupied(${occupied.length} raw, ${mergedOccupied.length} merged)=[${mergedOccupied.map(i => `${Math.floor(i.start/60)}:${String(i.start%60).padStart(2,'0')}-${Math.floor(i.end/60)}:${String(i.end%60).padStart(2,'0')}`).join(', ')}]`);

      let gaps = findGaps(occupied, effectiveDayStart, dayEnd, minBlockMinutes);
      console.log(`[generate]   ${dateStr}: ${gaps.length} gaps=[${gaps.map(g => `${Math.floor(g.start/60)}:${String(g.start%60).padStart(2,'0')}-${Math.floor(g.end/60)}:${String(g.end%60).padStart(2,'0')}(${g.end-g.start}min)`).join(', ')}]`);

      // Apply morning/evening preference for gap ordering
      if (!preferMornings && preferEvenings) {
        gaps.reverse(); // prefer later gaps
      }

      for (const gap of gaps) {
        if (remaining <= 0) break;
        const gapDuration = gap.end - gap.start;
        const placed = Math.min(remaining, gapDuration);

        if (placed < minBlockMinutes && remaining >= minBlockMinutes) {
          console.log(`[generate]   SKIP gap ${Math.floor(gap.start/60)}:${String(gap.start%60).padStart(2,'0')}-${Math.floor(gap.end/60)}:${String(gap.end%60).padStart(2,'0')} (${gapDuration}min < minBlock=${minBlockMinutes}min, remaining=${remaining}min)`);
          continue; // skip gaps too small unless we have less remaining
        }

        const slotStart = gap.start;
        const slotEnd = slotStart + placed;
        const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();

        console.log(`[generate]   >>> PLACE on ${dateStr}(dow=${dow}): ${Math.floor(slotStart/60)}:${String(slotStart%60).padStart(2,'0')}-${Math.floor(slotEnd/60)}:${String(slotEnd%60).padStart(2,'0')} (${placed}min, remaining after: ${remaining - placed}min)`);

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

        // Mark this interval as occupied (with gap buffer for spacing between tasks)
        const occupiedEnd = parsedRules.gapMinutes > 0
          ? Math.min(slotEnd + parsedRules.gapMinutes, dayEnd)
          : slotEnd;
        occupiedPerDate.get(dateStr)!.push({ start: slotStart, end: occupiedEnd });
        console.log(`[generate]   added occupied [${slotStart}-${occupiedEnd}] to ${dateStr}, total intervals now: ${occupiedPerDate.get(dateStr)!.length}`);
        remaining -= placed;
      }
    }
    console.log(`[generate]   DONE "${task.name}": remaining=${remaining}min`);
  }

  // Summary of all slots to be inserted
  console.log(`[generate] --- SLOT SUMMARY (${newSlots.length} slots) ---`);
  const slotsByDate = new Map<string, typeof newSlots>();
  for (const s of newSlots) {
    if (!slotsByDate.has(s.scheduled_date)) slotsByDate.set(s.scheduled_date, []);
    slotsByDate.get(s.scheduled_date)!.push(s);
  }
  for (const [date, slots] of [...slotsByDate.entries()].sort()) {
    console.log(`[generate]   ${date} (dow=${slots[0].day_of_week}): ${slots.length} slots`);
    for (const s of slots) {
      console.log(`[generate]     ${s.start_hour}:${String(s.start_minute).padStart(2,'0')}-${s.end_hour}:${String(s.end_minute).padStart(2,'0')} task=${s.task_id.slice(0,8)}`);
    }
  }
  // Check for overlaps within each date
  for (const [date, slots] of slotsByDate) {
    const sorted = [...slots].sort((a, b) => (a.start_hour * 60 + a.start_minute) - (b.start_hour * 60 + b.start_minute));
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i-1].end_hour * 60 + sorted[i-1].end_minute;
      const currStart = sorted[i].start_hour * 60 + sorted[i].start_minute;
      if (currStart < prevEnd) {
        console.error(`[generate]   !!! OVERLAP on ${date}: slot ${i-1} ends at ${sorted[i-1].end_hour}:${String(sorted[i-1].end_minute).padStart(2,'0')} but slot ${i} starts at ${sorted[i].start_hour}:${String(sorted[i].start_minute).padStart(2,'0')}`);
      }
    }
  }

  // Batch insert new slots
  if (newSlots.length > 0) {
    const { error } = await supabase.from('scheduled_slots').insert(newSlots);
    if (error) {
      console.error(`[generate] INSERT ERROR:`, error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // Log final occupied state for debugging overlaps
  for (const dateStr of weekDates) {
    const intervals = occupiedPerDate.get(dateStr)!;
    if (intervals.length > 0) {
      const merged = mergeIntervals([...intervals]);
      console.log(`[generate] ${dateStr} final occupied (${merged.length} merged): ${merged.map(i => `${Math.floor(i.start/60)}:${String(i.start%60).padStart(2,'0')}-${Math.floor(i.end/60)}:${String(i.end%60).padStart(2,'0')}`).join(', ')}`);
    }
  }

  return NextResponse.json({
    slotsCreated: newSlots.length,
    tasksScheduled: new Set(newSlots.map(s => s.task_id)).size,
    debug: {
      weekOf,
      weekEndStr,
      isCurrentWeek,
      todayDateStr,
      fixedBlocksTotal: allBlocks.length,
      fixedBlocksUsed: fixedBlocks.length,
      fixedBlocksByDate: Object.fromEntries(
        weekDates.map(dateStr => [dateStr, fixedBlocks.filter((fb: { specific_date: string | null; day_of_week: number }) => {
          if (fb.specific_date) return fb.specific_date === dateStr;
          return new Date(dateStr + 'T12:00:00Z').getUTCDay() === fb.day_of_week;
        }).length])
      ),
      excludedCalendars: excludedCalendarIds.size,
      lockedSlots: lockedSlots.length,
      completedSlotsRemoved: completedSlotIds.length,
      schedulableTasks: schedulableTasks.length,
      schedulableDates,
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
