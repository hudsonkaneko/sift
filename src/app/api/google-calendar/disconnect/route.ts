import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST() {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const supabase = createServiceClient();

  // Delete all google-synced fixed blocks
  await supabase
    .from('fixed_blocks')
    .delete()
    .eq('user_id', userId)
    .not('google_event_id', 'is', null);

  // Delete calendar sources
  await supabase
    .from('google_calendar_sources')
    .delete()
    .eq('user_id', userId);

  // Delete token
  await supabase
    .from('google_calendar_tokens')
    .delete()
    .eq('user_id', userId);

  return NextResponse.json({ disconnected: true });
}
