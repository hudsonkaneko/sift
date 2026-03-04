import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { mapGoogleCalendarSource } from '@/lib/utils/db';

export async function GET() {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

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
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to refresh token' }, { status: 401 });
    }
    const data = await res.json();
    accessToken = data.access_token;
    await supabase
      .from('google_calendar_tokens')
      .update({
        access_token: data.access_token,
        token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
  }

  // Fetch calendar list from Google
  const listRes = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!listRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch calendar list' }, { status: 502 });
  }

  const listData = await listRes.json();

  interface GCalListEntry {
    id: string;
    summary?: string;
    backgroundColor?: string;
    selected?: boolean;
    accessRole?: string;
  }

  const calendars = (listData.items || []) as GCalListEntry[];

  // Upsert each calendar into google_calendar_sources (preserve existing enabled state)
  const now = new Date().toISOString();
  for (const cal of calendars) {
    await supabase
      .from('google_calendar_sources')
      .upsert(
        {
          user_id: userId,
          google_calendar_id: cal.id,
          name: cal.summary || cal.id,
          color: cal.backgroundColor || null,
          updated_at: now,
        },
        { onConflict: 'user_id,google_calendar_id', ignoreDuplicates: false },
      );
  }

  // Return all sources for this user
  const { data: sources } = await supabase
    .from('google_calendar_sources')
    .select('*')
    .eq('user_id', userId)
    .order('name');

  return NextResponse.json((sources || []).map(mapGoogleCalendarSource));
}
