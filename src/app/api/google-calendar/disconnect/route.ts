import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const supabase = createServiceClient();

  let googleEmail: string | null = null;
  try {
    const body = await req.json();
    googleEmail = body.googleEmail || null;
  } catch {
    // No body — disconnect all
  }

  if (googleEmail) {
    // Per-account disconnect: only remove that account's data

    // Get calendar IDs for this account to scope block deletion
    const { data: sources } = await supabase
      .from('google_calendar_sources')
      .select('google_calendar_id')
      .eq('user_id', userId)
      .eq('google_email', googleEmail);

    const calIds = (sources || []).map(s => s.google_calendar_id);

    if (calIds.length > 0) {
      // Delete google-synced blocks for this account's calendars
      await supabase
        .from('fixed_blocks')
        .delete()
        .eq('user_id', userId)
        .not('google_event_id', 'is', null)
        .in('google_calendar_id', calIds);
    }

    // Delete this account's calendar sources
    await supabase
      .from('google_calendar_sources')
      .delete()
      .eq('user_id', userId)
      .eq('google_email', googleEmail);

    // Delete this account's token row
    await supabase
      .from('google_calendar_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('google_email', googleEmail);
  } else {
    // Disconnect all accounts (backward compat)
    await supabase
      .from('fixed_blocks')
      .delete()
      .eq('user_id', userId)
      .not('google_event_id', 'is', null);

    await supabase
      .from('google_calendar_sources')
      .delete()
      .eq('user_id', userId);

    await supabase
      .from('google_calendar_tokens')
      .delete()
      .eq('user_id', userId);
  }

  return NextResponse.json({ disconnected: true });
}
