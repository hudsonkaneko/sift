import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { mapGoogleCalendarSource } from '@/lib/utils/db';

export async function GET() {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  console.log(`[gcal/calendars] === START === userId=${userId}`);

  const supabase = createServiceClient();

  // Get ALL token rows for this user
  const { data: tokenRows, error: tokenError } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId);

  if (tokenError) {
    console.error('[gcal/calendars] ERROR fetching tokens:', tokenError);
  }

  if (!tokenRows || tokenRows.length === 0) {
    console.log('[gcal/calendars] no token rows found');
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 400 });
  }

  console.log(`[gcal/calendars] found ${tokenRows.length} token row(s):`, tokenRows.map(t => ({
    id: t.id,
    google_email: t.google_email,
    token_expiry: t.token_expiry,
  })));

  const now = new Date().toISOString();

  interface GCalListEntry {
    id: string;
    summary?: string;
    backgroundColor?: string;
    selected?: boolean;
    accessRole?: string;
    primary?: boolean;
  }

  // Process each account
  for (const tokenRow of tokenRows) {
    console.log(`[gcal/calendars] --- processing account: ${tokenRow.google_email ?? 'NULL email'}`);

    // Refresh token if expired
    let accessToken = tokenRow.access_token;
    const isExpired = new Date(tokenRow.token_expiry) <= new Date();
    if (isExpired) {
      console.log('[gcal/calendars] token expired, refreshing...');
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
        const errBody = await res.text();
        console.error(`[gcal/calendars] SKIP account — token refresh failed (${res.status}):`, errBody);
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
      console.log('[gcal/calendars] token refreshed successfully');
    }

    // Fetch calendar list from Google FIRST (needed for both backfill and upsert)
    console.log('[gcal/calendars] fetching calendarList from Google...');
    const listRes = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!listRes.ok) {
      const errBody = await listRes.text();
      console.error(`[gcal/calendars] SKIP account — calendarList failed (${listRes.status}):`, errBody);
      continue;
    }

    const listData = await listRes.json();
    const calendars = (listData.items || []) as GCalListEntry[];
    console.log(`[gcal/calendars] got ${calendars.length} calendar(s):`, calendars.map(c => ({
      id: c.id,
      summary: c.summary,
      primary: c.primary,
      accessRole: c.accessRole,
    })));

    // Backfill google_email if missing — extract from primary calendar ID
    if (!tokenRow.google_email) {
      const primaryCal = calendars.find(c => c.primary);
      const primaryEmail = primaryCal?.id;
      console.log('[gcal/calendars] google_email is NULL, primary calendar:', primaryCal ? { id: primaryCal.id, summary: primaryCal.summary } : 'NOT FOUND');

      if (primaryEmail) {
        tokenRow.google_email = primaryEmail;
        await supabase
          .from('google_calendar_tokens')
          .update({ google_email: primaryEmail, updated_at: now })
          .eq('id', tokenRow.id);
        // Backfill existing sources that have null google_email
        await supabase
          .from('google_calendar_sources')
          .update({ google_email: primaryEmail, updated_at: now })
          .eq('user_id', userId)
          .is('google_email', null);
        console.log(`[gcal/calendars] backfilled google_email: ${primaryEmail}`);
      } else {
        // Can't determine email — clean up orphan sources and skip this account
        await supabase
          .from('google_calendar_sources')
          .delete()
          .eq('user_id', userId)
          .is('google_email', null);
        console.error('[gcal/calendars] SKIP account — no primary calendar found');
        continue;
      }
    }

    // Delete any remaining NULL-email orphan sources for this user
    await supabase
      .from('google_calendar_sources')
      .delete()
      .eq('user_id', userId)
      .is('google_email', null);

    // Upsert each calendar into google_calendar_sources (email is guaranteed non-null)
    console.log(`[gcal/calendars] upserting ${calendars.length} sources for ${tokenRow.google_email}`);
    for (const cal of calendars) {
      const { error: upsertError } = await supabase
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
      if (upsertError) {
        console.error(`[gcal/calendars] ERROR upserting source ${cal.id}:`, upsertError);
      }
    }
  }

  // Return all sources for this user
  const { data: sources, error: sourcesError } = await supabase
    .from('google_calendar_sources')
    .select('*')
    .eq('user_id', userId)
    .order('google_email')
    .order('name');

  if (sourcesError) {
    console.error('[gcal/calendars] ERROR fetching final sources:', sourcesError);
  }

  console.log(`[gcal/calendars] === DONE === returning ${sources?.length ?? 0} source(s)`);
  return NextResponse.json((sources || []).map(mapGoogleCalendarSource));
}
