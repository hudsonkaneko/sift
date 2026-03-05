import type { Task } from '@/lib/types/domain';

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';

export const PRIORITY_COLORS: Record<PriorityLevel, string> = {
  critical: 'border-l-red-500',
  high: 'border-l-amber-500',
  medium: 'border-l-yellow-400',
  low: 'border-l-blue-400',
  none: 'border-l-transparent',
};

export function calculatePriority(task: Task): number {
  let score = task.urgency ?? 0;

  if (task.deadline) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const deadlineDate = new Date(task.deadline + 'T00:00:00');
    const diffDays = Math.floor((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) score += 1000;           // overdue
    else if (diffDays === 0) score += 900;      // due today
    else if (diffDays <= 2) score += 700 + (2 - diffDays) * 50;  // 1d=750, 2d=700
    else if (diffDays <= 7) score += 400 + (7 - diffDays) * 40;  // 3d=560 … 7d=400
    else if (diffDays <= 14) score += 200 + (14 - diffDays) * 20; // 8d=320 … 14d=200
    else score += 110;                          // 15+ days
  }

  return score;
}

export function getPriorityLevel(score: number): PriorityLevel {
  if (score >= 900) return 'critical';  // overdue or due today
  if (score >= 700) return 'high';      // 1-2 days
  if (score >= 400) return 'medium';    // 3-7 days
  if (score >= 110) return 'low';       // 8+ days with deadline
  return 'none';
}
