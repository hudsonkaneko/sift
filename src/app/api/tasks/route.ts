import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { randomColor } from '@/lib/utils/format';

// GET /api/tasks — fetch all tasks for the authenticated user
export async function GET() {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST /api/tasks — create a new task
export async function POST(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const body = await req.json();
  const supabase = createServiceClient();

  // Determine color: explicit > inherit from parent > random for top-level
  let color: string | null = body.color || null;
  if (!color && body.parentId) {
    const { data: parent } = await supabase
      .from('tasks')
      .select('color')
      .eq('id', body.parentId)
      .single();
    color = parent?.color ?? null;
  }
  if (!color && !body.parentId) {
    color = randomColor();
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
      color,
      parent_id: body.parentId || null,
      urgency: body.urgency || 0,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
