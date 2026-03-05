import type { Task } from '@/lib/types/domain';

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

export const PRIORITY_COLORS: Record<PriorityLevel, string> = {
  critical: 'border-l-red-500',
  high: 'border-l-amber-500',
  medium: 'border-l-yellow-400',
  low: 'border-l-blue-400',
  none: 'border-l-transparent',
};

/**
 * Core priority scoring — single source of truth.
 *
 * Accepts raw field values so both the UI (Task objects) and the scheduler
 * (raw DB rows) can call it without mapping.
 *
 * Scoring factors:
 *   1. Deadline proximity (overdue → 2 weeks out)
 *   2. Urgency score (0-100, set by Claude)
 *   3. Duration bonus (shorter tasks get a small bump — "quick wins")
 *   4. Overdue penalty amplifier (overdue tasks that are also long get extra weight)
 */
export function calculatePriorityFromRaw(
  deadline: string | null,
  urgency: number,
  estimatedMinutes: number,
  referenceDate?: Date,
): number {
  let score = urgency ?? 0;

  if (deadline) {
    const ref = referenceDate ?? new Date();
    const refMidnight = new Date(ref);
    refMidnight.setHours(0, 0, 0, 0);
    const deadlineDate = new Date(deadline + 'T00:00:00');
    const diffDays = Math.floor((deadlineDate.getTime() - refMidnight.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      // Overdue: base 100 + amplifier for longer tasks (harder to recover)
      score += 100 + Math.min(20, Math.floor(estimatedMinutes / 30) * 5);
    } else if (diffDays === 0) {
      score += 80; // due today
    } else if (diffDays === 1) {
      score += 50; // tomorrow
    } else if (diffDays <= 3) {
      score += 35; // next few days
    } else if (diffDays <= 7) {
      score += 25; // this week
    } else if (diffDays <= 14) {
      score += 10; // 2 weeks
    }
  }

  // Quick win bonus: shorter tasks get a bump to encourage momentum
  if (estimatedMinutes > 0 && estimatedMinutes <= 20) {
    score += 8;
  } else if (estimatedMinutes > 0 && estimatedMinutes <= 45) {
    score += 4;
  }

  return score;
}

/**
 * Convenience wrapper for Task objects (used by UI components).
 */
export function calculatePriority(task: Task): number {
  return calculatePriorityFromRaw(task.deadline, task.urgency, task.estimatedMinutes);
}

export function getPriorityLevel(score: number): PriorityLevel {
  if (score >= 80) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 30) return 'medium';
  if (score >= 10) return 'low';
  return 'none';
}
