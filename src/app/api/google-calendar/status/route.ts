import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { mapGoogleCalendarAccount } from '@/lib/utils/db';

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
    .select('id, user_id, google_email, refresh_failed_at, created_at, updated_at')
    .eq('user_id', userId);

  console.log('[gcal/status] query result:', { count: data?.length ?? 0, error: error?.message ?? null });

  const accounts = (data || []).map(mapGoogleCalendarAccount);
  return NextResponse.json({ accounts });
}
