import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) {
    console.log('[gcal/status] NOT AUTHENTICATED');
    return errorResponse!;
  }

  console.log('[gcal/status] checking for userId:', userId);

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('google_calendar_tokens')
    .select('user_id')
    .eq('user_id', userId)
    .single();

  console.log('[gcal/status] query result:', { found: !!data, error: error?.message ?? null });

  return NextResponse.json({ connected: !!data });
}
