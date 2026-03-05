/**
 * Energy-Aware Scheduling — maps tasks to energy levels
 * and matches them with time-of-day energy windows.
 *
 * Energy levels:
 *   high   — deep work (writing, coding, complex problem-solving)
 *   medium — moderate focus (reading, studying, research)
 *   low    — routine/admin (email, organizing, simple tasks)
 *
 * Default time-of-day energy map (customizable via preferences):
 *   Morning   (earliest–12:00)  → high
 *   Afternoon (12:00–17:00)     → medium
 *   Evening   (17:00–latest)    → low
 */

export type EnergyLevel = 'high' | 'medium' | 'low';

export interface EnergyWindow {
  startMinute: number; // minutes from midnight
  endMinute: number;
  energy: EnergyLevel;
}

export interface TaskWithEnergy {
  id: string;
  name: string;
  estimated_minutes: number;
  energy: EnergyLevel;
  [key: string]: unknown;
}

// Keywords that suggest energy level by task name/category
const HIGH_ENERGY_KEYWORDS = [
  'write', 'writing', 'draft', 'essay', 'paper', 'code', 'coding', 'program',
  'develop', 'design', 'create', 'build', 'implement', 'solve', 'analyze',
  'thesis', 'dissertation', 'compose', 'architect',
];

const MEDIUM_ENERGY_KEYWORDS = [
  'read', 'reading', 'study', 'studying', 'research', 'review', 'learn',
  'practice', 'prepare', 'outline', 'plan', 'brainstorm', 'edit', 'revise',
  'homework', 'problem set', 'pset',
];

const LOW_ENERGY_KEYWORDS = [
  'email', 'emails', 'reply', 'respond', 'organize', 'clean', 'file',
  'admin', 'submit', 'upload', 'download', 'update', 'check', 'review pr',
  'meeting notes', 'schedule', 'laundry', 'grocery', 'errands',
];

/**
 * Infer energy level from task name using keyword matching.
 */
export function inferTaskEnergy(taskName: string): EnergyLevel {
  const lower = taskName.toLowerCase();

  for (const keyword of HIGH_ENERGY_KEYWORDS) {
    if (lower.includes(keyword)) return 'high';
  }
  for (const keyword of LOW_ENERGY_KEYWORDS) {
    if (lower.includes(keyword)) return 'low';
  }
  for (const keyword of MEDIUM_ENERGY_KEYWORDS) {
    if (lower.includes(keyword)) return 'medium';
  }

  // Default: medium energy
  return 'medium';
}

/**
 * Build energy windows for a day based on scheduling preferences.
 *
 * Splits the schedulable window into 3 zones:
 *   morning → high, afternoon → medium, evening → low
 *
 * Respects preferMornings/preferEvenings to shift the map.
 */
export function buildEnergyWindows(
  earliestHour: number,
  latestHour: number,
  preferMornings: boolean,
  preferEvenings: boolean,
): EnergyWindow[] {
  const start = earliestHour * 60;
  const end = latestHour * 60;
  const noon = 12 * 60;
  const afternoon = 17 * 60;

  const windows: EnergyWindow[] = [];

  if (preferMornings && !preferEvenings) {
    // Morning person: high focus early, taper off
    if (start < noon) {
      windows.push({ startMinute: start, endMinute: Math.min(noon, end), energy: 'high' });
    }
    if (noon < end) {
      windows.push({ startMinute: Math.max(noon, start), endMinute: Math.min(afternoon, end), energy: 'medium' });
    }
    if (afternoon < end) {
      windows.push({ startMinute: Math.max(afternoon, start), endMinute: end, energy: 'low' });
    }
  } else if (!preferMornings && preferEvenings) {
    // Night owl: low energy early, peaks later
    if (start < noon) {
      windows.push({ startMinute: start, endMinute: Math.min(noon, end), energy: 'low' });
    }
    if (noon < end) {
      windows.push({ startMinute: Math.max(noon, start), endMinute: Math.min(afternoon, end), energy: 'medium' });
    }
    if (afternoon < end) {
      windows.push({ startMinute: Math.max(afternoon, start), endMinute: end, energy: 'high' });
    }
  } else {
    // Balanced or both — standard distribution
    if (start < noon) {
      windows.push({ startMinute: start, endMinute: Math.min(noon, end), energy: 'high' });
    }
    if (noon < end) {
      windows.push({ startMinute: Math.max(noon, start), endMinute: Math.min(afternoon, end), energy: 'medium' });
    }
    if (afternoon < end) {
      windows.push({ startMinute: Math.max(afternoon, start), endMinute: end, energy: 'low' });
    }
  }

  // Filter out zero-length windows
  return windows.filter(w => w.endMinute > w.startMinute);
}

/**
 * Get the energy level for a specific time of day.
 */
export function getEnergyAtTime(windows: EnergyWindow[], minuteOfDay: number): EnergyLevel {
  for (const w of windows) {
    if (minuteOfDay >= w.startMinute && minuteOfDay < w.endMinute) {
      return w.energy;
    }
  }
  return 'medium'; // fallback
}

/**
 * Score how well a task's energy matches a time slot's energy.
 *
 * Returns 0-2:
 *   2 = perfect match
 *   1 = adjacent (high↔medium or medium↔low)
 *   0 = mismatch (high task in low energy window)
 */
export function energyMatchScore(taskEnergy: EnergyLevel, slotEnergy: EnergyLevel): number {
  if (taskEnergy === slotEnergy) return 2;

  const levels: EnergyLevel[] = ['high', 'medium', 'low'];
  const diff = Math.abs(levels.indexOf(taskEnergy) - levels.indexOf(slotEnergy));
  return diff === 1 ? 1 : 0;
}
