/**
 * Task sorting for the scheduler — orders tasks by priority score.
 *
 * Extracted from scheduled-slots/generate/route.ts for modularity.
 * Uses the canonical priority calculation from priority.ts.
 */

import { calculatePriorityFromRaw } from '@/lib/utils/priority';

interface SchedulableTask {
  id: string;
  name: string;
  deadline: string | null;
  urgency: number;
  estimated_minutes: number;
  [key: string]: unknown;
}

export function sortTasksByPriority(
  tasks: SchedulableTask[],
  referenceDate: Date,
): SchedulableTask[] {
  const sorted = [...tasks];
  sorted.sort((a, b) => {
    const scoreA = calculatePriorityFromRaw(a.deadline, a.urgency, a.estimated_minutes, referenceDate);
    const scoreB = calculatePriorityFromRaw(b.deadline, b.urgency, b.estimated_minutes, referenceDate);
    return scoreB - scoreA;
  });
  return sorted;
}
