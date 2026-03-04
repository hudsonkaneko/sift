import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

interface Interval {
  start: number; // minutes from midnight
  end: number;
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

  const { weekOf } = await req.json();
  if (!weekOf) {
    return NextResponse.json({ error: 'weekOf is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Fetch all needed data in parallel
  const [tasksResult, lockedSlotsResult, allSlotsResult, blocksResult, prefsResult] = await Promise.all([
    supabase.from('tasks').select('*').eq('user_id', userId).eq('completed', false),
    supabase.from('scheduled_slots').select('*').eq('user_id', userId).eq('week_of', weekOf).eq('locked', true),
    supabase.from('scheduled_slots').select('id').eq('user_id', userId).eq('week_of', weekOf).eq('locked', false),
    supabase.from('fixed_blocks').select('*').eq('user_id', userId),
    supabase.from('scheduling_preferences').select('*').eq('user_id', userId).single(),
  ]);

  const tasks = tasksResult.data || [];
  const lockedSlots = lockedSlotsResult.data || [];
  const unlockedSlotIds = (allSlotsResult.data || []).map(s => s.id);
  const fixedBlocks = blocksResult.data || [];
  const prefs = prefsResult.data;

  const earliestHour = prefs?.earliest_hour ?? 9;
  const latestHour = prefs?.latest_hour ?? 23;
  const minBlockMinutes = prefs?.min_block_minutes ?? 30;
  const preferMornings = prefs?.prefer_mornings ?? true;
  const preferEvenings = prefs?.prefer_evenings ?? true;
  const avoidWeekends = prefs?.avoid_weekends ?? false;

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
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  function taskPriority(t: { deadline: string | null; urgency: number; estimated_minutes: number }): number {
    let score = t.urgency ?? 0;
    if (t.deadline) {
      const deadlineDate = new Date(t.deadline + 'T00:00:00');
      const diffDays = Math.floor((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
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
  const todayDayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  const weekOfDate = new Date(weekOf + 'T00:00:00');
  const weekOfSunday = new Date(weekOfDate);
  weekOfSunday.setDate(weekOfSunday.getDate() - weekOfSunday.getDay());
  const todaySunday = new Date(now);
  todaySunday.setDate(todaySunday.getDate() - todaySunday.getDay());
  const isCurrentWeek = weekOfSunday.getTime() === todaySunday.getTime();

  let dayOrder: number[];
  if (avoidWeekends) {
    dayOrder = [1, 2, 3, 4, 5]; // Mon-Fri
  } else {
    dayOrder = [1, 2, 3, 4, 5, 6, 0]; // Weekdays first, then weekend
  }

  // Only schedule on today and future days if generating for the current week
  if (isCurrentWeek) {
    dayOrder = dayOrder.filter(d => d >= todayDayOfWeek);
  }

  const dayStart = earliestHour * 60;
  const dayEnd = latestHour * 60;

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
      let gaps = findGaps(occupied, dayStart, dayEnd, minBlockMinutes);

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

        // Mark this interval as occupied
        occupiedPerDay.get(day)!.push({ start: slotStart, end: slotEnd });
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
