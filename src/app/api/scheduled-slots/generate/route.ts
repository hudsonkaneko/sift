import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { generateSchedule } from '@/lib/scheduler/scheduler';

/**
 * POST /api/scheduled-slots/generate
 *
 * Auto-generates a schedule for the requested week.
 * Delegates all scheduling logic to src/lib/scheduler/.
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

  // Filter out fixed blocks from excluded calendars
  const excludedCalendarIds = new Set(
    (excludedSourcesResult.data || []).map((s: { google_calendar_id: string }) => s.google_calendar_id)
  );
  const allBlocks = blocksResult.data || [];
  const fixedBlocks = allBlocks.filter(
    (fb: { google_calendar_id: string | null }) =>
      !fb.google_calendar_id || !excludedCalendarIds.has(fb.google_calendar_id)
  );

  console.log(`[SCHEDULER] fixedBlocks: ${fixedBlocks.length} (of ${allBlocks.length} total, ${excludedCalendarIds.size} excluded calendars)`);

  // Delete unlocked slots (they'll be regenerated)
  if (unlockedSlotIds.length > 0) {
    await supabase.from('scheduled_slots').delete().in('id', unlockedSlotIds).eq('user_id', userId);
  }

  // Run the scheduler
  const result = generateSchedule({
    userId,
    weekOf,
    timezone: timezone || 'UTC',
    tasks,
    lockedSlots,
    fixedBlocks,
    preferences: {
      earliestHour: prefs?.earliest_hour ?? 9,
      latestHour: prefs?.latest_hour ?? 23,
      minBlockMinutes: prefs?.min_block_minutes ?? 30,
      preferMornings: prefs?.prefer_mornings ?? true,
      preferEvenings: prefs?.prefer_evenings ?? true,
      avoidWeekends: prefs?.avoid_weekends ?? false,
      customRules: prefs?.custom_rules ?? [],
    },
  });

  // Batch insert new slots
  if (result.slots.length > 0) {
    const { error } = await supabase.from('scheduled_slots').insert(result.slots);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    slotsCreated: result.slots.length,
    tasksScheduled: new Set(result.slots.map(s => s.task_id)).size,
    unlockedRemoved: unlockedSlotIds.length,
    debug: {
      fixedBlocksTotal: allBlocks.length,
      fixedBlocksUsed: fixedBlocks.length,
      excludedCalendars: excludedCalendarIds.size,
      lockedSlots: lockedSlots.length,
      ...result.debug,
    },
  });
}
