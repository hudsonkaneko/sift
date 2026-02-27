import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

// PATCH /api/chat/sessions/[id] — rename session
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { id } = await params;
  const { name } = await req.json();
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('chat_sessions')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/chat/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { id } = await params;
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
