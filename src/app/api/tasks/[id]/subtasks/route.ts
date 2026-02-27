import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

// POST /api/tasks/[id]/subtasks — create a subtask under a parent
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { id: parentId } = await params;
  const body = await req.json();
  const supabase = createServiceClient();

  // Verify parent exists and belongs to user
  const { data: parent, error: parentError } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', parentId)
    .eq('user_id', userId)
    .single();

  if (parentError || !parent) {
    return NextResponse.json({ error: 'Parent task not found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      name: body.name,
      category: body.category || 'Personal',
      estimated_minutes: body.estimatedMinutes || 30,
      deadline: body.deadline || null,
      recurrence: body.recurrence || 'none',
      completed: false,
      color: body.color || null,
      parent_id: parentId,
      urgency: body.urgency || 0,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
