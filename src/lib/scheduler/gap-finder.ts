/**
 * Calendar gap detection — finds free time intervals within a day.
 *
 * Extracted from scheduled-slots/generate/route.ts for modularity.
 */

export interface Interval {
  start: number; // minutes from midnight
  end: number;
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

export function findGaps(
  occupied: Interval[],
  dayStart: number,
  dayEnd: number,
  minBlock: number,
): Interval[] {
  const merged = mergeIntervals(occupied);
  const gaps: Interval[] = [];
  let cursor = dayStart;

  for (const interval of merged) {
    if (interval.start > cursor) {
      const gap = interval.start - cursor;
      if (gap >= minBlock) {
        gaps.push({ start: cursor, end: interval.start });
      }
    }
    cursor = Math.max(cursor, interval.end);
  }

  if (cursor < dayEnd) {
    const gap = dayEnd - cursor;
    if (gap >= minBlock) {
      gaps.push({ start: cursor, end: dayEnd });
    }
  }

  return gaps;
}
