import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('google_calendar_tokens')
    .select('user_id')
    .eq('user_id', userId)
    .single();

  return NextResponse.json({ connected: !!data });
}
