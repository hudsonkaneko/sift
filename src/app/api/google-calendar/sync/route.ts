import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

async function refreshAccessToken(supabase: ReturnType<typeof createServiceClient>, userId: string, tokenRow: { refresh_token: string }) {
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
    .eq('user_id', userId);

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

  // Get token
  const { data: tokenRow } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!tokenRow) {
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 400 });
  }

  // Refresh token if expired
  let accessToken = tokenRow.access_token;
  if (new Date(tokenRow.token_expiry) <= new Date()) {
    const refreshed = await refreshAccessToken(supabase, userId, tokenRow);
    if (!refreshed) {
      return NextResponse.json({ error: 'Failed to refresh Google token' }, { status: 401 });
    }
    accessToken = refreshed;
  }

  // Calculate week range (Sun-Sat)
  const weekStart = new Date(weekOf + 'T00:00:00Z');
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  // Fetch events from Google Calendar
  const calendarId = tokenRow.calendar_id || 'primary';
  const params = new URLSearchParams({
    timeMin: weekStart.toISOString(),
    timeMax: weekEnd.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  });

  const eventsRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!eventsRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch Google Calendar events' }, { status: 502 });
  }

  const eventsData = await eventsRes.json();
  const events = eventsData.items || [];

  // Delete existing google-synced blocks for this date range
  const weekEndDate = new Date(weekEnd);
  weekEndDate.setDate(weekEndDate.getDate() - 1);
  const weekStartStr = weekStart.toISOString().split('T')[0];
  const weekEndStr = weekEndDate.toISOString().split('T')[0];

  await supabase
    .from('fixed_blocks')
    .delete()
    .eq('user_id', userId)
    .not('google_event_id', 'is', null)
    .gte('specific_date', weekStartStr)
    .lte('specific_date', weekEndStr);

  // Convert Google events to fixed_blocks
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
    specific_date: string;
  }[] = [];

  for (const event of events as GoogleEvent[]) {
    // Skip all-day events (they have .date instead of .dateTime)
    if (!event.start.dateTime || !event.end.dateTime) continue;
    // Skip cancelled events
    if (event.status === 'cancelled') continue;

    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);

    const dayOfWeek = start.getDay();
    const specificDate = start.toISOString().split('T')[0];

    blocks.push({
      user_id: userId,
      name: event.summary || 'Google Calendar Event',
      day_of_week: dayOfWeek,
      start_hour: start.getHours(),
      start_minute: start.getMinutes(),
      end_hour: end.getHours(),
      end_minute: end.getMinutes(),
      user_created: false,
      color: null,
      recurring: false,
      google_event_id: event.id,
      specific_date: specificDate,
    });
  }

  if (blocks.length > 0) {
    const { error } = await supabase.from('fixed_blocks').insert(blocks);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ synced: blocks.length });
}
