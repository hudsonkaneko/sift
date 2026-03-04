import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { id } = await params;
  const { enabled } = await req.json();

  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('google_calendar_sources')
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
