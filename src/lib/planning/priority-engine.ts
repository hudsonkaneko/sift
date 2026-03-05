/**
 * Priority Engine — centralized task scoring for the planning layer.
 *
 * Re-exports and extends the core priority calculation from utils/priority.ts.
 * Adds planning-specific scoring that considers the full task landscape.
 */

import { calculatePriorityFromRaw, type PriorityLevel, getPriorityLevel } from '@/lib/utils/priority';
import { inferTaskEnergy, type EnergyLevel } from './energy-model';

export { calculatePriorityFromRaw, getPriorityLevel, type PriorityLevel };

export interface ScoredTask {
  id: string;
  name: string;
  estimatedMinutes: number;
  deadline: string | null;
  urgency: number;
  priorityScore: number;
  priorityLevel: PriorityLevel;
  energy: EnergyLevel;
}

/**
 * Score and rank a list of tasks with full planning context.
 * Returns tasks sorted by priority (highest first) with energy levels inferred.
 */
export function scoreAndRankTasks(
  tasks: {
    id: string;
    name: string;
    estimated_minutes: number;
    deadline: string | null;
    urgency: number;
    completed: boolean;
  }[],
  referenceDate?: Date,
): ScoredTask[] {
  const ref = referenceDate ?? new Date();

  return tasks
    .filter(t => !t.completed && t.estimated_minutes > 0)
    .map(t => {
      const priorityScore = calculatePriorityFromRaw(t.deadline, t.urgency, t.estimated_minutes, ref);
      return {
        id: t.id,
        name: t.name,
        estimatedMinutes: t.estimated_minutes,
        deadline: t.deadline,
        urgency: t.urgency,
        priorityScore,
        priorityLevel: getPriorityLevel(priorityScore),
        energy: inferTaskEnergy(t.name),
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);
}
