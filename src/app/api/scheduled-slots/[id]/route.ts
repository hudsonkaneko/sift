import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

// PATCH /api/scheduled-slots/[id] — update slot position/time
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { id } = await params;
  const body = await req.json();
  const supabase = createServiceClient();

  // Build update object from allowed fields
  const update: Record<string, unknown> = {};
  if (body.dayOfWeek !== undefined) update.day_of_week = body.dayOfWeek;
  if (body.startHour !== undefined) update.start_hour = body.startHour;
  if (body.startMinute !== undefined) update.start_minute = body.startMinute;
  if (body.endHour !== undefined) update.end_hour = body.endHour;
  if (body.endMinute !== undefined) update.end_minute = body.endMinute;
  if (body.locked !== undefined) update.locked = body.locked;
  if (body.taskId !== undefined) update.task_id = body.taskId;
  if (body.scheduledDate !== undefined) update.scheduled_date = body.scheduledDate;

  // When dayOfWeek changes, derive scheduled_date from week_of + new dayOfWeek
  if (body.dayOfWeek !== undefined && body.scheduledDate === undefined) {
    const { data: slot } = await supabase
      .from('scheduled_slots').select('week_of').eq('id', id).single();
    if (slot) {
      const base = new Date(slot.week_of + 'T12:00:00Z');
      base.setUTCDate(base.getUTCDate() + body.dayOfWeek);
      update.scheduled_date = base.toISOString().split('T')[0];
    }
  }

  // Auto-lock when position changes
  if (body.dayOfWeek !== undefined || body.startHour !== undefined || body.startMinute !== undefined) {
    update.locked = true;
  }

  const { data, error } = await supabase
    .from('scheduled_slots')
    .update(update)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/scheduled-slots/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { id } = await params;
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('scheduled_slots')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
