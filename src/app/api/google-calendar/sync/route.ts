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
    // Mark the account as needing reconnection so the UI can prompt the user.
    await supabase
      .from('google_calendar_tokens')
      .update({ refresh_failed_at: new Date().toISOString() })
      .eq('id', tokenRow.id);
    return null;
  }

  const data = await res.json();
  const newExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase
    .from('google_calendar_tokens')
    .update({
      access_token: data.access_token,
      token_expiry: newExpiry,
      refresh_failed_at: null, // successful refresh clears any prior failure
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

  // Universal orphan cleanup: remove any sources with NULL google_email before
  // processing. These are legacy artifacts from earlier code paths where sources
  // could be created without an email. They can't be matched to a token and
  // cause "enabled=true but nothing syncs" mystery states.
  {
    const { count: orphanCount } = await supabase
      .from('google_calendar_sources')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .is('google_email', null);
    if (orphanCount && orphanCount > 0) {
      console.log(`[gcal/sync] cleaned up ${orphanCount} orphan NULL-email source(s)`);
    }
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

  // Track which calendars we actually refetched this run. We only overwrite
  // existing events for calendars whose fetch succeeded — a failed fetch
  // (auth error, network blip, Google outage) must never wipe the user's view.
  const successfulCalendarIds = new Set<string>();
  const failedCalendars: Array<{ id: string; status: number; error: string }> = [];
  const accountFailures: Array<{ email: string; reason: string }> = [];

  // One-time cleanup: remove any stale 'primary'-keyed blocks anywhere in the
  // DB. These are legacy artifacts from the old first-sync race where events
  // were inserted with google_calendar_id='primary' before real sources existed.
  // They never get refreshed (re-syncs use real calendar IDs and only delete
  // within the current week range), so they'd accumulate as orphans.
  const { count: staleCount } = await supabase
    .from('fixed_blocks')
    .delete({ count: 'exact' })
    .eq('user_id', userId)
    .eq('google_calendar_id', 'primary');
  if (staleCount && staleCount > 0) {
    console.log(`[gcal/sync] cleaned up ${staleCount} stale 'primary'-keyed block(s)`);
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
    is_all_day: boolean;
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
        accountFailures.push({ email: tokenRow.google_email ?? 'unknown', reason: 'refresh_failed' });
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
            console.log(`[gcal/sync] backfilled google_email: ${primaryEmail}`);
          } else {
            console.error('[gcal/sync] SKIP account — no primary calendar found, cannot determine email');
            accountFailures.push({ email: 'unknown', reason: 'no_primary_calendar' });
            continue;
          }
        } else {
          const errBody = await calListRes.text();
          console.error(`[gcal/sync] SKIP account — calendarList failed (${calListRes.status}):`, errBody);
          accountFailures.push({ email: 'unknown', reason: `calendarlist_${calListRes.status}` });
          continue;
        }
      } catch (e) {
        console.error('[gcal/sync] SKIP account — calendarList exception:', e);
        accountFailures.push({ email: 'unknown', reason: 'calendarlist_exception' });
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
    let { data: sources, error: sourcesError } = tokenRow.google_email
      ? await sourceQuery.eq('google_email', tokenRow.google_email)
      : await sourceQuery.is('google_email', null);

    if (sourcesError) {
      console.error('[gcal/sync] ERROR fetching sources:', sourcesError);
    }

    // Bootstrap sources on first sync: if none exist, fetch calendar list from
    // Google and create source rows with real calendar IDs. This avoids the
    // 'primary' fallback that causes an id mismatch between blocks and sources.
    if (!sources || sources.length === 0) {
      console.log('[gcal/sync] no sources yet — bootstrapping from calendarList');
      try {
        const bootRes = await fetch(
          'https://www.googleapis.com/calendar/v3/users/me/calendarList',
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (bootRes.ok) {
          const bootData = await bootRes.json();
          const bootCals = (bootData.items || []) as { id: string; summary?: string; backgroundColor?: string }[];
          console.log(`[gcal/sync] bootstrap got ${bootCals.length} calendar(s)`);
          for (const cal of bootCals) {
            const { error: upsertErr } = await supabase
              .from('google_calendar_sources')
              .upsert({
                user_id: userId,
                google_calendar_id: cal.id,
                google_email: tokenRow.google_email,
                name: cal.summary || cal.id,
                color: cal.backgroundColor || null,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'user_id,google_calendar_id,google_email', ignoreDuplicates: false });
            if (upsertErr) console.error(`[gcal/sync] bootstrap upsert failed for ${cal.id}:`, upsertErr);
          }
          // Re-query sources now that we've created them
          const rereadQuery = supabase
            .from('google_calendar_sources')
            .select('*')
            .eq('user_id', userId)
            .eq('enabled', true);
          const rereadResult = tokenRow.google_email
            ? await rereadQuery.eq('google_email', tokenRow.google_email)
            : await rereadQuery.is('google_email', null);
          sources = rereadResult.data;
          console.log(`[gcal/sync] bootstrap complete: ${sources?.length ?? 0} source(s) now available`);
        } else {
          const errBody = await bootRes.text();
          console.error(`[gcal/sync] bootstrap calendarList failed (${bootRes.status}):`, errBody);
        }
      } catch (e) {
        console.error('[gcal/sync] bootstrap exception:', e);
      }
    }

    console.log(`[gcal/sync] found ${sources?.length ?? 0} enabled source(s) for ${tokenRow.google_email}:`,
      (sources || []).map(s => ({ id: s.google_calendar_id, name: s.name, enabled: s.enabled })));

    // Still fall back to 'primary' if bootstrap failed entirely (e.g., network blip)
    const calendarIds = sources && sources.length > 0
      ? sources.map(s => ({ id: s.google_calendar_id, color: s.color }))
      : [{ id: 'primary', color: null }];

    if (!sources || sources.length === 0) {
      console.log('[gcal/sync] bootstrap failed — falling back to "primary" calendar');
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
        failedCalendars.push({ id: cal.id, status: eventsRes.status, error: errBody.slice(0, 200) });
        continue;
      }

      const eventsData = await eventsRes.json();
      const events = (eventsData.items || []) as GoogleEvent[];
      console.log(`[gcal/sync] calendar ${cal.id}: ${events.length} raw event(s)`);

      let skippedMultiDay = 0;
      let skippedCancelled = 0;
      let allDayAdded = 0;
      let timedAdded = 0;

      for (const event of events) {
        if (event.status === 'cancelled') {
          skippedCancelled++;
          continue;
        }

        // All-day event: has start.date and end.date (no dateTime).
        // Google's end.date is exclusive (the day AFTER the last day).
        if (!event.start.dateTime && event.start.date) {
          const startDate = event.start.date; // YYYY-MM-DD
          // For v1, only support single-day all-day events.
          // Multi-day (end.date > start.date + 1) would need expansion per day.
          const endDate = event.end?.date;
          if (endDate) {
            const s = new Date(startDate + 'T00:00:00Z');
            const e = new Date(endDate + 'T00:00:00Z');
            const dayDiff = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
            if (dayDiff > 1) {
              skippedMultiDay++;
              continue;
            }
          }
          const [y, m, d] = startDate.split('-').map(Number);
          const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
          const dedupeKey = `${event.id}::${cal.id}`;
          blocksMap.set(dedupeKey, {
            user_id: userId,
            name: event.summary || 'All-day event',
            day_of_week: dayOfWeek,
            start_hour: 0,
            start_minute: 0,
            end_hour: 0,
            end_minute: 0,
            user_created: false,
            color: cal.color,
            recurring: false,
            google_event_id: event.id,
            google_calendar_id: cal.id,
            specific_date: startDate,
            is_all_day: true,
          });
          allDayAdded++;
          continue;
        }

        if (!event.start.dateTime || !event.end.dateTime) continue;

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
        // Day of week from local date (use UTC to avoid server timezone drift)
        const [y, m, d] = specificDate.split('-').map(Number);
        const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();

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
          is_all_day: false,
        });
        timedAdded++;
      }

      console.log(`[gcal/sync] calendar ${cal.id}: ${timedAdded} timed + ${allDayAdded} all-day (skipped ${skippedCancelled} cancelled, ${skippedMultiDay} multi-day)`);
      successfulCalendarIds.add(cal.id);
    }
  }

  // If every fetch failed, leave the DB untouched and surface an error so the
  // UI shows a reconnect/retry toast instead of silently emptying the calendar.
  if (successfulCalendarIds.size === 0 && (failedCalendars.length > 0 || accountFailures.length > 0)) {
    console.error('[gcal/sync] ALL fetches failed — preserving existing events', { failedCalendars, accountFailures });
    const firstReason = accountFailures[0]?.reason ?? failedCalendars[0]?.status;
    return NextResponse.json({
      error: `Google Calendar unreachable (${firstReason}). Existing events kept — try again or reconnect.`,
      failedCalendars: failedCalendars.map(f => f.id),
      accountFailures,
    }, { status: 502 });
  }

  // Scoped delete: only wipe the week's events for calendars we actually
  // refetched. Calendars whose fetch failed keep their prior state so the
  // user sees stale data rather than an empty week.
  if (successfulCalendarIds.size > 0) {
    const { error: deleteErr, count: deletedCount } = await supabase
      .from('fixed_blocks')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
      .in('google_calendar_id', Array.from(successfulCalendarIds))
      .not('google_event_id', 'is', null)
      .gte('specific_date', weekStartStr)
      .lte('specific_date', weekEndStr);
    if (deleteErr) {
      console.error('[gcal/sync] ERROR deleting old blocks:', deleteErr);
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }
    console.log(`[gcal/sync] deleted ${deletedCount ?? '?'} old block(s) across ${successfulCalendarIds.size} calendar(s)`);
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

  console.log(`[gcal/sync] === DONE === synced ${blocks.length} events (failed calendars: ${failedCalendars.length}, account failures: ${accountFailures.length})`);
  return NextResponse.json({
    synced: blocks.length,
    failedCalendars: failedCalendars.length > 0 ? failedCalendars.map(f => f.id) : undefined,
    accountFailures: accountFailures.length > 0 ? accountFailures : undefined,
  });
}
