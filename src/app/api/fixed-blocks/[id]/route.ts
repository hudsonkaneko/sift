import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

// PATCH /api/fixed-blocks/[id]
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { id } = await params;
  const body = await req.json();
  const supabase = createServiceClient();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.dayOfWeek !== undefined) updates.day_of_week = body.dayOfWeek;
  if (body.startHour !== undefined) updates.start_hour = body.startHour;
  if (body.startMinute !== undefined) updates.start_minute = body.startMinute;
  if (body.endHour !== undefined) updates.end_hour = body.endHour;
  if (body.endMinute !== undefined) updates.end_minute = body.endMinute;
  if (body.color !== undefined) updates.color = body.color;
  if (body.recurring !== undefined) updates.recurring = body.recurring;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('fixed_blocks')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// DELETE /api/fixed-blocks/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { id } = await params;
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('fixed_blocks')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
