import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * POST /api/scheduled-slots/merge-move
 *
 * When a split task (multiple sibling slots) is dragged, this endpoint:
 * 1. Collects all sibling slots for the same task
 * 2. Calculates total combined duration
 * 3. Deletes all siblings except the dragged slot
 * 4. Places the primary slot at the target location
 * 5. Creates spillover slots in available gaps if needed
 */
export async function POST(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { slotId, targetDay, targetStartHour, targetStartMinute, weekOf } = await req.json();

  if (slotId == null || targetDay == null || targetStartHour == null || targetStartMinute == null || !weekOf) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 1. Find the dragged slot to get taskId
  const { data: draggedSlot, error: slotErr } = await supabase
    .from('scheduled_slots')
    .select('*')
    .eq('id', slotId)
    .eq('user_id', userId)
    .single();

  if (slotErr || !draggedSlot) {
    return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
  }

  const taskId = draggedSlot.task_id;

  // 2. Fetch ALL sibling slots for that taskId in this week
  const { data: siblingSlots } = await supabase
    .from('scheduled_slots')
    .select('*')
    .eq('user_id', userId)
    .eq('task_id', taskId)
    .eq('week_of', weekOf);

  const siblings = siblingSlots || [];

  // Calculate total combined duration
  let totalMinutes = 0;
  for (const s of siblings) {
    totalMinutes += (s.end_hour * 60 + s.end_minute) - (s.start_hour * 60 + s.start_minute);
  }

  const dropStart = targetStartHour * 60 + targetStartMinute;

  // Early exit: if only 1 slot, just move it normally
  if (siblings.length <= 1) {
    const endMin = dropStart + totalMinutes;
    const clampedEnd = Math.min(endMin, 23 * 60);
    const { data, error } = await supabase
      .from('scheduled_slots')
      .update({
        day_of_week: targetDay,
        start_hour: Math.floor(dropStart / 60),
        start_minute: dropStart % 60,
        end_hour: Math.floor(clampedEnd / 60),
        end_minute: clampedEnd % 60,
        locked: true,
      })
      .eq('id', slotId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ slots: [data] });
  }

  // 3. Delete all siblings except the primary
  const siblingIds = siblings.filter(s => s.id !== slotId).map(s => s.id);
  if (siblingIds.length > 0) {
    await supabase
      .from('scheduled_slots')
      .delete()
      .in('id', siblingIds)
      .eq('user_id', userId);
  }

  // 4. Find occupied intervals on target day
  const occupied: { start: number; end: number }[] = [];

  // Fixed blocks on target day
  const { data: fixedBlocks } = await supabase
    .from('fixed_blocks')
    .select('*')
    .eq('user_id', userId)
    .eq('day_of_week', targetDay);

  for (const fb of fixedBlocks || []) {
    occupied.push({
      start: fb.start_hour * 60 + fb.start_minute,
      end: fb.end_hour * 60 + fb.end_minute,
    });
  }

  // Other slots on target day (excluding our primary)
  const { data: otherSlots } = await supabase
    .from('scheduled_slots')
    .select('*')
    .eq('user_id', userId)
    .eq('week_of', weekOf)
    .eq('day_of_week', targetDay)
    .neq('id', slotId);

  for (const s of otherSlots || []) {
    occupied.push({
      start: s.start_hour * 60 + s.start_minute,
      end: s.end_hour * 60 + s.end_minute,
    });
  }

  occupied.sort((a, b) => a.start - b.start);

  // Find first obstacle
  let desiredEnd = Math.min(dropStart + totalMinutes, 23 * 60);
  let availableEnd = desiredEnd;
  for (const occ of occupied) {
    if (occ.start > dropStart && occ.start < desiredEnd) {
      availableEnd = occ.start;
      break;
    }
  }

  // 5. Place primary slot
  const primaryEnd = Math.min(availableEnd, desiredEnd);
  const primaryMinutes = primaryEnd - dropStart;

  const { data: updatedPrimary, error: updateErr } = await supabase
    .from('scheduled_slots')
    .update({
      day_of_week: targetDay,
      start_hour: Math.floor(dropStart / 60),
      start_minute: dropStart % 60,
      end_hour: Math.floor(primaryEnd / 60),
      end_minute: primaryEnd % 60,
      locked: true,
    })
    .eq('id', slotId)
    .eq('user_id', userId)
    .select()
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  const resultSlots = [updatedPrimary];

  // 6. Handle spillover
  let leftover = totalMinutes - primaryMinutes;
  if (leftover > 0) {
    // Rebuild occupied with primary slot included
    const allOccupied = [...occupied, { start: dropStart, end: primaryEnd }];
    allOccupied.sort((a, b) => a.start - b.start);

    // Merge overlapping intervals
    const merged: { start: number; end: number }[] = [];
    for (const interval of allOccupied) {
      if (merged.length > 0 && interval.start <= merged[merged.length - 1].end) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, interval.end);
      } else {
        merged.push({ ...interval });
      }
    }

    const dayEnd = 23 * 60;
    let cursor = primaryEnd;

    // Fill gaps with spillover slots
    for (const interval of merged) {
      if (leftover <= 0) break;
      if (interval.start > cursor) {
        const gapEnd = Math.min(interval.start, dayEnd);
        const gapDuration = gapEnd - cursor;
        if (gapDuration > 0) {
          const placed = Math.min(leftover, gapDuration);
          const { data: spillSlot } = await supabase
            .from('scheduled_slots')
            .insert({
              user_id: userId,
              task_id: taskId,
              day_of_week: targetDay,
              start_hour: Math.floor(cursor / 60),
              start_minute: cursor % 60,
              end_hour: Math.floor((cursor + placed) / 60),
              end_minute: (cursor + placed) % 60,
              week_of: weekOf,
              locked: true,
            })
            .select()
            .single();

          if (spillSlot) resultSlots.push(spillSlot);
          leftover -= placed;
        }
      }
      cursor = Math.max(cursor, interval.end);
    }

    // Check gap at end of day
    if (leftover > 0 && cursor < dayEnd) {
      const placed = Math.min(leftover, dayEnd - cursor);
      if (placed > 0) {
        const { data: spillSlot } = await supabase
          .from('scheduled_slots')
          .insert({
            user_id: userId,
            task_id: taskId,
            day_of_week: targetDay,
            start_hour: Math.floor(cursor / 60),
            start_minute: cursor % 60,
            end_hour: Math.floor((cursor + placed) / 60),
            end_minute: (cursor + placed) % 60,
            week_of: weekOf,
            locked: true,
          })
          .select()
          .single();

        if (spillSlot) resultSlots.push(spillSlot);
      }
    }
  }

  return NextResponse.json({ slots: resultSlots });
}
