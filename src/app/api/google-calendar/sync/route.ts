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

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`[gcal/sync] token refresh failed (${res.status}):`, errBody);
    return null;
  }

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

  console.log(`[gcal/sync] === START === userId=${userId}, weekOf=${weekOf}`);

  const supabase = createServiceClient();

  // Get ALL token rows for user
  const { data: tokenRows, error: tokenError } = await supabase
    .from('google_calendar_tokens')
    .select('*')
    .eq('user_id', userId);

  if (tokenError) {
    console.error('[gcal/sync] ERROR fetching tokens:', tokenError);
    return NextResponse.json({ error: tokenError.message }, { status: 500 });
  }

  if (!tokenRows || tokenRows.length === 0) {
    console.log('[gcal/sync] no token rows found for user');
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 400 });
  }

  console.log(`[gcal/sync] found ${tokenRows.length} token row(s):`, tokenRows.map(t => ({
    id: t.id,
    google_email: t.google_email,
    token_expiry: t.token_expiry,
    has_refresh_token: !!t.refresh_token,
  })));

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

  console.log(`[gcal/sync] week range: ${weekStartStr} to ${weekEndStr}`);

  // Preserve user-customized colors before deleting old blocks
  const { data: existingBlocks } = await supabase
    .from('fixed_blocks')
    .select('google_event_id, google_calendar_id, color')
    .eq('user_id', userId)
    .not('google_event_id', 'is', null)
    .gte('specific_date', weekStartStr)
    .lte('specific_date', weekEndStr);

  const preservedColors = new Map<string, string>();
  if (existingBlocks) {
    for (const b of existingBlocks) {
      if (b.color && b.google_event_id && b.google_calendar_id) {
        preservedColors.set(`${b.google_event_id}::${b.google_calendar_id}`, b.color);
      }
    }
  }
  console.log(`[gcal/sync] preserved ${preservedColors.size} user-customized color(s)`);

  // Delete ALL google-synced blocks for this user in this week range upfront
  // (prevents duplicate key errors when multiple accounts share calendars)
  const { error: deleteAllError, count: deleteAllCount } = await supabase
    .from('fixed_blocks')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .not('google_event_id', 'is', null)
    .gte('specific_date', weekStartStr)
    .lte('specific_date', weekEndStr);

  if (deleteAllError) {
    console.error('[gcal/sync] ERROR deleting old blocks:', deleteAllError);
  } else {
    console.log(`[gcal/sync] deleted ${deleteAllCount ?? '?'} old google blocks for week`);
  }

  interface GoogleEvent {
    id: string;
    summary?: string;
    start: { dateTime?: string; date?: string };
    end: { dateTime?: string; date?: string };
    status?: string;
  }

  const blocksMap = new Map<string, {
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
  }>();

  // Process each account
  for (const tokenRow of tokenRows) {
    console.log(`[gcal/sync] --- processing account: ${tokenRow.google_email ?? 'NULL email'} (token id: ${tokenRow.id})`);

    // Refresh token if expired
    let accessToken = tokenRow.access_token;
    const isExpired = new Date(tokenRow.token_expiry) <= new Date();
    console.log(`[gcal/sync] token expired? ${isExpired} (expiry: ${tokenRow.token_expiry})`);

    if (isExpired) {
      const refreshed = await refreshAccessToken(supabase, tokenRow);
      if (!refreshed) {
        console.error(`[gcal/sync] SKIP account — token refresh failed for ${tokenRow.google_email ?? 'NULL'}`);
        continue;
      }
      accessToken = refreshed;
      console.log('[gcal/sync] token refreshed successfully');
    }

    // Backfill google_email if missing — extract from primary calendar ID
    if (!tokenRow.google_email) {
      console.log('[gcal/sync] google_email is NULL, attempting backfill from calendarList...');
      try {
        const calListRes = await fetch(
          'https://www.googleapis.com/calendar/v3/users/me/calendarList',
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (calListRes.ok) {
          const calListData = await calListRes.json();
          const items = calListData.items || [];
          console.log(`[gcal/sync] calendarList returned ${items.length} calendars`);
          const primaryCal = items.find((c: { primary?: boolean }) => c.primary);
          console.log('[gcal/sync] primary calendar:', primaryCal ? { id: primaryCal.id, summary: primaryCal.summary } : 'NOT FOUND');
          const primaryEmail = primaryCal?.id;
          if (primaryEmail) {
            tokenRow.google_email = primaryEmail;
            await supabase
              .from('google_calendar_tokens')
              .update({ google_email: primaryEmail, updated_at: new Date().toISOString() })
              .eq('id', tokenRow.id);
            await supabase
              .from('google_calendar_sources')
              .update({ google_email: primaryEmail, updated_at: new Date().toISOString() })
              .eq('user_id', userId)
              .is('google_email', null);
            // Delete any remaining NULL-email orphan sources
            await supabase
              .from('google_calendar_sources')
              .delete()
              .eq('user_id', userId)
              .is('google_email', null);
            console.log(`[gcal/sync] backfilled google_email: ${primaryEmail}`);
          } else {
            console.error('[gcal/sync] SKIP account — no primary calendar found, cannot determine email');
            continue;
          }
        } else {
          const errBody = await calListRes.text();
          console.error(`[gcal/sync] SKIP account — calendarList failed (${calListRes.status}):`, errBody);
          continue;
        }
      } catch (e) {
        console.error('[gcal/sync] SKIP account — calendarList exception:', e);
        continue;
      }
    }

    // Fetch enabled calendar sources for this account
    const sourceQuery = supabase
      .from('google_calendar_sources')
      .select('*')
      .eq('user_id', userId)
      .eq('enabled', true);

    // Use .is() for null (PostgREST .eq() never matches NULL)
    const { data: sources, error: sourcesError } = tokenRow.google_email
      ? await sourceQuery.eq('google_email', tokenRow.google_email)
      : await sourceQuery.is('google_email', null);

    if (sourcesError) {
      console.error('[gcal/sync] ERROR fetching sources:', sourcesError);
    }

    console.log(`[gcal/sync] found ${sources?.length ?? 0} enabled source(s) for ${tokenRow.google_email}:`,
      (sources || []).map(s => ({ id: s.google_calendar_id, name: s.name, enabled: s.enabled })));

    // Fall back to 'primary' if no sources exist yet (first sync before calendars fetched)
    const calendarIds = sources && sources.length > 0
      ? sources.map(s => ({ id: s.google_calendar_id, color: s.color }))
      : [{ id: 'primary', color: null }];

    if (!sources || sources.length === 0) {
      console.log('[gcal/sync] no sources found — falling back to "primary" calendar');
    }

    // Fetch events from each enabled calendar
    for (const cal of calendarIds) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`;
      console.log(`[gcal/sync] fetching events from calendar: ${cal.id}`);

      const eventsRes = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!eventsRes.ok) {
        const errBody = await eventsRes.text();
        console.error(`[gcal/sync] SKIP calendar ${cal.id} — events fetch failed (${eventsRes.status}):`, errBody);
        continue;
      }

      const eventsData = await eventsRes.json();
      const events = (eventsData.items || []) as GoogleEvent[];
      console.log(`[gcal/sync] calendar ${cal.id}: ${events.length} raw event(s)`);

      let skippedAllDay = 0;
      let skippedCancelled = 0;

      for (const event of events) {
        if (!event.start.dateTime || !event.end.dateTime) {
          skippedAllDay++;
          continue;
        }
        if (event.status === 'cancelled') {
          skippedCancelled++;
          continue;
        }

        // Parse local time directly from the ISO string to avoid
        // server timezone conversion (Vercel runs in UTC)
        // Format: "2026-03-04T10:00:00-08:00" → extract hours/minutes from T portion
        const startMatch = event.start.dateTime.match(/T(\d{2}):(\d{2})/);
        const endMatch = event.end.dateTime.match(/T(\d{2}):(\d{2})/);
        if (!startMatch || !endMatch) continue;

        const startHour = parseInt(startMatch[1]);
        const startMinute = parseInt(startMatch[2]);
        const endHour = parseInt(endMatch[1]);
        const endMinute = parseInt(endMatch[2]);
        // Extract local date (YYYY-MM-DD) before the T
        const specificDate = event.start.dateTime.split('T')[0];
        // Day of week from local date
        const [y, m, d] = specificDate.split('-').map(Number);
        const dayOfWeek = new Date(y, m - 1, d).getDay();

        // Deduplicate by (google_event_id, google_calendar_id) — same event
        // can appear via multiple accounts if they share a calendar
        const dedupeKey = `${event.id}::${cal.id}`;
        blocksMap.set(dedupeKey, {
          user_id: userId,
          name: event.summary || 'Google Calendar Event',
          day_of_week: dayOfWeek,
          start_hour: startHour,
          start_minute: startMinute,
          end_hour: endHour,
          end_minute: endMinute,
          user_created: false,
          color: cal.color,
          recurring: false,
          google_event_id: event.id,
          google_calendar_id: cal.id,
          specific_date: specificDate,
        });
      }

      console.log(`[gcal/sync] calendar ${cal.id}: added ${events.length - skippedAllDay - skippedCancelled} blocks (skipped ${skippedAllDay} all-day, ${skippedCancelled} cancelled)`);
    }
  }

  // Restore user-customized colors
  for (const [key, block] of blocksMap) {
    const savedColor = preservedColors.get(key);
    if (savedColor && savedColor !== block.color) {
      block.color = savedColor;
    }
  }

  const blocks = Array.from(blocksMap.values());
  console.log(`[gcal/sync] total blocks to insert: ${blocks.length} (deduped from ${blocksMap.size} unique keys)`);

  if (blocks.length > 0) {
    const { error } = await supabase.from('fixed_blocks').upsert(blocks, {
      onConflict: 'user_id,google_event_id,google_calendar_id',
    });
    if (error) {
      console.error('[gcal/sync] ERROR inserting blocks:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.log(`[gcal/sync] inserted ${blocks.length} blocks`);
  } else {
    console.log('[gcal/sync] no blocks to insert — check: are there timed events this week?');
  }

  console.log(`[gcal/sync] === DONE === synced ${blocks.length} events`);
  return NextResponse.json({ synced: blocks.length });
}
