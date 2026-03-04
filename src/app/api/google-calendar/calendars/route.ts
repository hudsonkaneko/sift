import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { mapGoogleCalendarSource } from '@/lib/utils/db';

export async function GET() {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const supabase = createServiceClient();

  // Get ALL token rows for this user
  const { data: tokenRows } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId);

  if (!tokenRows || tokenRows.length === 0) {
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 400 });
  }

  const now = new Date().toISOString();

  interface GCalListEntry {
    id: string;
    summary?: string;
    backgroundColor?: string;
    selected?: boolean;
    accessRole?: string;
  }

  // Process each account
  for (const tokenRow of tokenRows) {
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
        console.log(`[gcal/calendars] failed to refresh token for ${tokenRow.google_email}`);
        continue;
      }
      const data = await res.json();
      accessToken = data.access_token;
      await supabase
        .from('google_calendar_tokens')
        .update({
          access_token: data.access_token,
          token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
          updated_at: now,
        })
        .eq('id', tokenRow.id);
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
              .update({ google_email: userinfo.email, updated_at: now })
              .eq('id', tokenRow.id);
            // Also backfill any existing sources that have null google_email
            await supabase
              .from('google_calendar_sources')
              .update({ google_email: userinfo.email, updated_at: now })
              .eq('user_id', userId)
              .is('google_email', null);
            console.log(`[gcal/calendars] backfilled google_email: ${userinfo.email}`);
          }
        }
      } catch (e) {
        console.log('[gcal/calendars] failed to backfill google_email:', e);
      }
    }

    // Fetch calendar list from Google
    const listRes = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!listRes.ok) {
      console.log(`[gcal/calendars] failed to fetch calendar list for ${tokenRow.google_email}`);
      continue;
    }

    const listData = await listRes.json();
    const calendars = (listData.items || []) as GCalListEntry[];

    // Upsert each calendar into google_calendar_sources with google_email
    for (const cal of calendars) {
      await supabase
        .from('google_calendar_sources')
        .upsert(
          {
            user_id: userId,
            google_calendar_id: cal.id,
            google_email: tokenRow.google_email,
            name: cal.summary || cal.id,
            color: cal.backgroundColor || null,
            updated_at: now,
          },
          { onConflict: 'user_id,google_calendar_id,google_email', ignoreDuplicates: false },
        );
    }
  }

  // Return all sources for this user
  const { data: sources } = await supabase
    .from('google_calendar_sources')
    .select('*')
    .eq('user_id', userId)
    .order('google_email')
    .order('name');

  return NextResponse.json((sources || []).map(mapGoogleCalendarSource));
}
