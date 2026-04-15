import type { ScheduledSlot, FixedBlock, SchedulingPreferences } from '@/lib/types/domain';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LOOKAHEAD = 7;
const TOTAL_RANGE_DAYS = 14;

interface Interval {
  start: number;
  end: number;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  intervals.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [{ ...intervals[0] }];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    if (intervals[i].start <= last.end) {
      last.end = Math.max(last.end, intervals[i].end);
    } else {
      merged.push({ ...intervals[i] });
    }
  }
  return merged;
}

function formatHours(minutes: number): string {
  const h = minutes / 60;
  if (h >= 10) return `${Math.round(h)}h`;
  return `${h.toFixed(1)}h`;
}

function formatTime(hour: number, minute: number): string {
  const h12 = hour % 12 || 12;
  const ampm = hour < 12 ? 'am' : 'pm';
  return minute === 0 ? `${h12}${ampm}` : `${h12}:${String(minute).padStart(2, '0')}${ampm}`;
}

/**
 * Builds a compact schedule summary string for injection into the AI system prompt.
 * Gives Claude awareness of the user's current capacity, commitments, and load so it
 * can make realistic suggestions and flag infeasibility.
 */
export function buildScheduleContext(
  slots: ScheduledSlot[],
  fixedBlocks: FixedBlock[],
  prefs: SchedulingPreferences,
  timezone: string,
): string {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = new Date();

  // Compute today in user's timezone
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const year = parseInt(parts.find(p => p.type === 'year')!.value);
  const month = parseInt(parts.find(p => p.type === 'month')!.value);
  const day = parseInt(parts.find(p => p.type === 'day')!.value);
  const currentHour = parseInt(parts.find(p => p.type === 'hour')!.value);
  const currentMinute = parseInt(parts.find(p => p.type === 'minute')!.value);
  const todayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const currentTimeMinutes = currentHour * 60 + currentMinute;

  // Build date list for lookahead range
  const dates: string[] = [];
  for (let i = 0; i < TOTAL_RANGE_DAYS; i++) {
    const d = new Date(todayStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }

  const dayStart = prefs.earliestHour * 60;
  const dayEnd = Math.min(prefs.latestHour * 60, 24 * 60);

  // Compute occupied intervals per date from fixed blocks + slots
  const occupiedPerDate = new Map<string, Interval[]>();
  for (const date of dates) occupiedPerDate.set(date, []);

  for (const fb of fixedBlocks) {
    if (fb.isAllDay) continue; // all-day events don't consume any time slot
    const start = fb.startHour * 60 + fb.startMinute;
    const end = fb.endHour * 60 + fb.endMinute;
    if (fb.specificDate) {
      const iv = occupiedPerDate.get(fb.specificDate);
      if (iv) iv.push({ start, end });
    } else {
      for (const date of dates) {
        const dow = new Date(date + 'T12:00:00Z').getUTCDay();
        if (dow === fb.dayOfWeek) {
          occupiedPerDate.get(date)!.push({ start, end });
        }
      }
    }
  }

  const slotsPerDate = new Map<string, ScheduledSlot[]>();
  for (const slot of slots) {
    if (!slotsPerDate.has(slot.scheduledDate)) slotsPerDate.set(slot.scheduledDate, []);
    slotsPerDate.get(slot.scheduledDate)!.push(slot);
    const iv = occupiedPerDate.get(slot.scheduledDate);
    if (iv) {
      iv.push({
        start: slot.startHour * 60 + slot.startMinute,
        end: slot.endHour * 60 + slot.endMinute,
      });
    }
  }

  // Per-day availability
  const perDayAvailable: { date: string; dow: number; availMin: number; committedMin: number; isBlocked: boolean }[] = [];
  let totalAvailable = 0;
  let totalCommitted = 0;

  for (const date of dates) {
    const dow = new Date(date + 'T12:00:00Z').getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    const isBlocked = prefs.avoidWeekends && isWeekend && date !== todayStr;

    const effectiveStart = (date === todayStr)
      ? Math.max(dayStart, Math.ceil(currentTimeMinutes / 15) * 15)
      : dayStart;
    const baseAvailable = Math.max(0, dayEnd - effectiveStart);

    const merged = mergeIntervals([...(occupiedPerDate.get(date) || [])]);
    let occupiedMinutes = 0;
    for (const iv of merged) {
      const clampedStart = Math.max(iv.start, effectiveStart);
      const clampedEnd = Math.min(iv.end, dayEnd);
      if (clampedEnd > clampedStart) occupiedMinutes += clampedEnd - clampedStart;
    }

    const availMin = isBlocked ? 0 : Math.max(0, baseAvailable - occupiedMinutes);
    const committedMin = (slotsPerDate.get(date) || []).reduce((sum, s) => {
      return sum + (s.endHour * 60 + s.endMinute) - (s.startHour * 60 + s.startMinute);
    }, 0);

    perDayAvailable.push({ date, dow, availMin, committedMin, isBlocked });
    totalAvailable += availMin;
    totalCommitted += committedMin;
  }

  // Format the 7-day breakdown
  const perDayLines = perDayAvailable.slice(0, DAYS_LOOKAHEAD).map(d => {
    const md = d.date.slice(5); // MM-DD
    const label = `${DAY_LABELS[d.dow]} ${md}`;
    if (d.isBlocked) return `- ${label}: blocked (weekend)`;
    const todayTag = d.date === todayStr ? ' (today)' : '';
    if (d.availMin === 0) return `- ${label}${todayTag}: full`;
    const committedTag = d.committedMin > 0 ? `, ${formatHours(d.committedMin)} committed` : '';
    return `- ${label}${todayTag}: ${formatHours(d.availMin)} free${committedTag}`;
  });

  // Format upcoming fixed commitments (next 3 days)
  const upcomingLines: string[] = [];
  for (let i = 0; i < 3 && i < dates.length; i++) {
    const date = dates[i];
    const dow = new Date(date + 'T12:00:00Z').getUTCDay();
    const dayBlocks: { start: number; end: number; name: string }[] = [];
    for (const fb of fixedBlocks) {
      if (fb.isAllDay) continue;
      if (fb.specificDate) {
        if (fb.specificDate === date) {
          dayBlocks.push({ start: fb.startHour * 60 + fb.startMinute, end: fb.endHour * 60 + fb.endMinute, name: fb.name });
        }
      } else if (fb.dayOfWeek === dow) {
        dayBlocks.push({ start: fb.startHour * 60 + fb.startMinute, end: fb.endHour * 60 + fb.endMinute, name: fb.name });
      }
    }
    dayBlocks.sort((a, b) => a.start - b.start);
    if (dayBlocks.length === 0) continue;
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAY_LABELS[dow];
    const blockStrs = dayBlocks.slice(0, 4).map(b =>
      `${formatTime(Math.floor(b.start / 60), b.start % 60)}-${formatTime(Math.floor(b.end / 60), b.end % 60)} ${b.name}`
    );
    upcomingLines.push(`  ${label}: ${blockStrs.join('; ')}${dayBlocks.length > 4 ? ` (+${dayBlocks.length - 4} more)` : ''}`);
  }

  const utilization = totalAvailable > 0
    ? Math.round((totalCommitted / totalAvailable) * 100)
    : 0;

  const sections = [
    `CURRENT SCHEDULE AWARENESS (next ${DAYS_LOOKAHEAD} days):`,
    ...perDayLines,
    ``,
    `14-day capacity: ${formatHours(totalAvailable)} free, ${formatHours(totalCommitted)} already scheduled (${utilization}% utilized)`,
  ];

  if (upcomingLines.length > 0) {
    sections.push('', 'Upcoming fixed commitments:', ...upcomingLines);
  }

  return sections.join('\n');
}
