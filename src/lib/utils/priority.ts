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

    if (diffDays < 0) {
      score += 100; // overdue
    } else if (diffDays === 0) {
      score += 80; // due today
    } else if (diffDays === 1) {
      score += 50; // tomorrow
    } else if (diffDays <= 7) {
      score += 30; // this week
    } else if (diffDays <= 14) {
      score += 10; // 2 weeks
    }
  }

  // Quick win bonus
  if (task.estimatedMinutes > 0 && task.estimatedMinutes <= 30) {
    score += 5;
  }

  return score;
}

export function getPriorityLevel(score: number): PriorityLevel {
  if (score >= 80) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 30) return 'medium';
  if (score >= 10) return 'low';
  return 'none';
}
