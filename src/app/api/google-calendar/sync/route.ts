import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refreshAccessToken(supabase: ReturnType<typeof createServiceClient>, tokenRow: any) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: tokenRow.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  const newExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase
    .from('google_calendar_tokens')
    .update({
      access_token: data.access_token,
      token_expiry: newExpiry,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tokenRow.id);

  return data.access_token as string;
}

export async function POST(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { weekOf } = await req.json();
  if (!weekOf) {
    return NextResponse.json({ error: 'weekOf is required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Get ALL token rows for user
  const { data: tokenRows } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId);

  if (!tokenRows || tokenRows.length === 0) {
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 400 });
  }

  // Calculate week range (Sun-Sat)
  const weekStart = new Date(weekOf + 'T00:00:00Z');
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const params = new URLSearchParams({
    timeMin: weekStart.toISOString(),
    timeMax: weekEnd.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });

  const weekEndDate = new Date(weekEnd);
  weekEndDate.setDate(weekEndDate.getDate() - 1);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEndStr = weekEndDate.toISOString().split('T')[0];

  interface GoogleEvent {
    id: string;
    summary?: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
    status?: string;
  }

  const blocks: {
    user_id: string;
    name: string;
    day_of_week: number;
    start_hour: number;
    start_minute: number;
    end_hour: number;
    end_minute: number;
    user_created: boolean;
    color: string | null;
    recurring: boolean;
    google_event_id: string;
    google_calendar_id: string;
    specific_date: string;
  }[] = [];

  // Process each account
  for (const tokenRow of tokenRows) {
    // Refresh token if expired
    let accessToken = tokenRow.access_token;
    if (new Date(tokenRow.token_expiry) <= new Date()) {
      const refreshed = await refreshAccessToken(supabase, tokenRow);
      if (!refreshed) {
        console.log(`[gcal/sync] failed to refresh token for ${tokenRow.google_email}`);
        continue;
      }
      accessToken = refreshed;
    }

    // Backfill google_email if missing (pre-migration token rows)
    if (!tokenRow.google_email) {
      try {
        const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (userinfoRes.ok) {
          const userinfo = await userinfoRes.json();
          if (userinfo.email) {
            tokenRow.google_email = userinfo.email;
            await supabase
              .from('google_calendar_tokens')
              .update({ google_email: userinfo.email, updated_at: new Date().toISOString() })
              .eq('id', tokenRow.id);
            await supabase
              .from('google_calendar_sources')
              .update({ google_email: userinfo.email, updated_at: new Date().toISOString() })
              .eq('user_id', userId)
              .is('google_email', null);
            console.log(`[gcal/sync] backfilled google_email: ${userinfo.email}`);
          }
        }
      } catch (e) {
        console.log('[gcal/sync] failed to backfill google_email:', e);
      }
    }

    // Fetch enabled calendar sources for this account
    const { data: sources } = await supabase
      .from('google_calendar_sources')
      .select('*')
      .eq('user_id', userId)
      .eq('google_email', tokenRow.google_email)
      .eq('enabled', true);

    // Fall back to 'primary' if no sources exist yet (first sync before calendars fetched)
    const calendarIds = sources && sources.length > 0
      ? sources.map(s => ({ id: s.google_calendar_id, color: s.color }))
      : [{ id: 'primary', color: null }];

    // Delete existing google-synced blocks for this account's calendars in this date range
    const enabledIds = calendarIds.map(c => c.id);
    await supabase
      .from('fixed_blocks')
      .delete()
      .eq('user_id', userId)
      .not('google_event_id', 'is', null)
      .in('google_calendar_id', enabledIds)
      .gte('specific_date', weekStartStr)
      .lte('specific_date', weekEndStr);

    // Fetch events from each enabled calendar
    for (const cal of calendarIds) {
      const eventsRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!eventsRes.ok) continue;

      const eventsData = await eventsRes.json();
      const events = (eventsData.items || []) as GoogleEvent[];

      for (const event of events) {
        if (!event.start.dateTime || !event.end.dateTime) continue;
        if (event.status === 'cancelled') continue;

        const start = new Date(event.start.dateTime);
        const end = new Date(event.end.dateTime);

        blocks.push({
          user_id: userId,
          name: event.summary || 'Google Calendar Event',
          day_of_week: start.getDay(),
          start_hour: start.getHours(),
          start_minute: start.getMinutes(),
          end_hour: end.getHours(),
          end_minute: end.getMinutes(),
          user_created: false,
          color: cal.color,
          recurring: false,
          google_event_id: event.id,
          google_calendar_id: cal.id,
          specific_date: start.toISOString().split('T')[0],
        });
      }
    }
  }

  // Also clean up any old blocks with null google_calendar_id (from before multi-calendar)
  await supabase
    .from('fixed_blocks')
    .delete()
    .eq('user_id', userId)
    .not('google_event_id', 'is', null)
    .is('google_calendar_id', null)
    .gte('specific_date', weekStartStr)
    .lte('specific_date', weekEndStr);

  if (blocks.length > 0) {
    const { error } = await supabase.from('fixed_blocks').insert(blocks);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ synced: blocks.length });
}
