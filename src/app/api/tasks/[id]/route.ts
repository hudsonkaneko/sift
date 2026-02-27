import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

// PATCH /api/tasks/[id] — update a task
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
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.category !== undefined) updates.category = body.category;
  if (body.estimatedMinutes !== undefined) updates.estimated_minutes = body.estimatedMinutes;
  if (body.deadline !== undefined) updates.deadline = body.deadline;
  if (body.recurrence !== undefined) updates.recurrence = body.recurrence;
  if (body.completed !== undefined) updates.completed = body.completed;
  if (body.color !== undefined) updates.color = body.color;
  if (body.urgency !== undefined) updates.urgency = body.urgency;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('tasks')
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

// DELETE /api/tasks/[id] — delete a task (cascading via FK will delete subtasks)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { id } = await params;
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
