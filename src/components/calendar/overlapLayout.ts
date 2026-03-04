import type { FixedBlock, ScheduledSlotWithTask } from '@/lib/types/domain';

interface TimeRange {
  id: string;
  startMin: number;
  endMin: number;
}

export interface OverlapInfo {
  column: number;
  totalColumns: number;
}

export function toTimeRanges(
  blocks: FixedBlock[],
  slots: ScheduledSlotWithTask[],
): TimeRange[] {
  const ranges: TimeRange[] = [];
  for (const b of blocks) {
    ranges.push({ id: b.id, startMin: b.startHour * 60 + b.startMinute, endMin: b.endHour * 60 + b.endMinute });
  }
  for (const s of slots) {
    ranges.push({ id: s.id, startMin: s.startHour * 60 + s.startMinute, endMin: s.endHour * 60 + s.endMinute });
  }
  return ranges;
}

export function computeOverlapLayout(items: TimeRange[]): Map<string, OverlapInfo> {
  if (items.length === 0) return new Map();

  // Sort by start time, then longer events first
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || (b.endMin - b.startMin) - (a.endMin - a.startMin));

  const result = new Map<string, OverlapInfo>();

  // Build collision groups — transitive overlap
  let groupStart = 0;
  let groupEnd = sorted[0].endMin;

  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i].startMin < groupEnd) {
      // Joins the current group
      groupEnd = Math.max(groupEnd, sorted[i].endMin);
    } else {
      // Process the group [groupStart..i)
      const group = sorted.slice(groupStart, i);
      const columnEnds: number[] = []; // tracks end time of each column

      for (const item of group) {
        let col = 0;
        while (col < columnEnds.length && columnEnds[col] > item.startMin) {
          col++;
        }
        if (col === columnEnds.length) {
          columnEnds.push(item.endMin);
        } else {
          columnEnds[col] = item.endMin;
        }
        result.set(item.id, { column: col, totalColumns: 0 });
      }

      const total = columnEnds.length;
      for (const item of group) {
        result.get(item.id)!.totalColumns = total;
      }

      // Start new group
      if (i < sorted.length) {
        groupStart = i;
        groupEnd = sorted[i].endMin;
      }
    }
  }

  return result;
}
