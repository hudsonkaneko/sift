import type { TaskCategory } from '@/lib/types/domain';

export const HOUR_HEIGHT = 56;
export const SNAP_MINUTES = 15;
export const START_HOUR = 0;
export const END_HOUR = 24;
export const GRID_PAD_TOP = 8;
export const MIN_BLOCK_PX = 14;
export const DAY_INDICES = [0, 1, 2, 3, 4, 5, 6];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const CATEGORY_COLORS: Record<TaskCategory, string> = {
  School: 'bg-school/15 border-school/30 text-school',
  Startup: 'bg-startup/15 border-startup/30 text-startup',
  Collab: 'bg-collab/15 border-collab/30 text-collab',
  Personal: 'bg-personal/15 border-personal/30 text-personal',
};

export const CATEGORY_DOT_COLORS: Record<TaskCategory, string> = {
  School: 'bg-school',
  Startup: 'bg-startup',
  Collab: 'bg-collab',
  Personal: 'bg-personal',
};

export const CATEGORY_DRAG_BORDER: Record<TaskCategory, string> = {
  School: '#4ea8de',
  Startup: '#f97316',
  Collab: '#a78bfa',
  Personal: '#34d399',
};

export function hexStyles(hex: string) {
  return {
    backgroundColor: `${hex}22`,
    borderColor: `${hex}44`,
    color: hex,
  };
}

export function snapMinutes(totalMinutes: number): number {
  return Math.round(totalMinutes / SNAP_MINUTES) * SNAP_MINUTES;
}

export function pxToTime(px: number): { hour: number; minute: number } {
  const totalMinutes = ((px - GRID_PAD_TOP) / HOUR_HEIGHT) * 60 + START_HOUR * 60;
  const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, totalMinutes));
  const snapped = snapMinutes(clamped);
  return { hour: Math.floor(snapped / 60), minute: snapped % 60 };
}

export function getBlockStyle(startHour: number, startMinute: number, endHour: number, endMinute: number) {
  const top = ((startHour - START_HOUR) + startMinute / 60) * HOUR_HEIGHT + GRID_PAD_TOP;
  const height = Math.max(((endHour - startHour) + (endMinute - startMinute) / 60) * HOUR_HEIGHT, 20);
  return { top, height };
}

export function getWeekDates(weekOf: string): string[] {
  return DAY_INDICES.map(i => {
    const d = new Date(weekOf + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split('T')[0];
  });
}

export function dateToDayOfMonth(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00Z').getUTCDate();
}

export function dateToDayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay();
}

export function formatWeekLabel(weekOf: string): string {
  const sun = new Date(weekOf + 'T00:00:00');
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);

  const sameMonth = sun.getMonth() === sat.getMonth();
  const sameYear = sun.getFullYear() === sat.getFullYear();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (sameMonth) {
    return `${months[sun.getMonth()]} ${sun.getDate()}–${sat.getDate()}, ${sun.getFullYear()}`;
  }
  if (sameYear) {
    return `${months[sun.getMonth()]} ${sun.getDate()} – ${months[sat.getMonth()]} ${sat.getDate()}, ${sun.getFullYear()}`;
  }
  return `${months[sun.getMonth()]} ${sun.getDate()}, ${sun.getFullYear()} – ${months[sat.getMonth()]} ${sat.getDate()}, ${sat.getFullYear()}`;
}
