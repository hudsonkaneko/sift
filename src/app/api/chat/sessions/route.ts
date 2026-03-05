import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { mapChatSession } from '@/lib/utils/db';

// GET /api/chat/sessions
export async function GET(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { searchParams } = new URL(req.url);
  const supabase = createServiceClient();

  if (searchParams.has('taskId')) {
    const taskId = searchParams.get('taskId');
    let query = supabase
      .from('chat_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (taskId) {
      // Project-scoped: only sessions for this task
      query = query.eq('task_id', taskId);
    } else {
      // General: only sessions with no task
      query = query.is('task_id', null);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json((data || []).map(mapChatSession));
  }

  // No taskId param → return all sessions with task names joined
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('*, tasks(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data || []).map(mapChatSession));
}

// POST /api/chat/sessions — create a new session
export async function POST(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const body = await req.json().catch(() => ({}));
  const supabase = createServiceClient();

  const insert: Record<string, unknown> = {
    user_id: userId,
    name: body.name || 'New Chat',
  };
  if (body.taskId) {
    insert.task_id = body.taskId;
  }

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert(insert)
    .select('*, tasks(name)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(mapChatSession(data), { status: 201 });
}
