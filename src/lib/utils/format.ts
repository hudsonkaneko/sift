import type { TaskCategory, ColorPaletteConfig } from '@/lib/types/domain';

export const CATEGORY_HEX: Record<TaskCategory, string> = {
  School: '#4ea8de',
  Startup: '#f97316',
  Collab: '#a78bfa',
  Personal: '#34d399',
};

export const CATEGORY_BADGES: Record<TaskCategory, string> = {
  School: 'bg-school/15 text-school',
  Startup: 'bg-startup/15 text-startup',
  Collab: 'bg-collab/15 text-collab',
  Personal: 'bg-personal/15 text-personal',
};

export const COLOR_PALETTE = [
  { hex: '#4ea8de', name: 'Blue' },
  { hex: '#f97316', name: 'Orange' },
  { hex: '#a78bfa', name: 'Purple' },
  { hex: '#34d399', name: 'Green' },
  { hex: '#f87171', name: 'Red' },
  { hex: '#facc15', name: 'Yellow' },
  { hex: '#f472b6', name: 'Pink' },
  { hex: '#2dd4bf', name: 'Teal' },
];

export const ALL_CATEGORIES: TaskCategory[] = ['School', 'Startup', 'Collab', 'Personal'];

export const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatDeadline(deadline: string | null): string {
  if (!deadline) return 'No deadline';
  const d = new Date(deadline + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'Overdue';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff <= 7) return `${diff} days`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getActiveColors(config: ColorPaletteConfig | null): string[] {
  if (!config) return COLOR_PALETTE.map(c => c.hex);
  const active = config.themes.find(t => t.id === config.activeThemeId);
  const colors = active?.colors;
  return colors?.length ? colors : COLOR_PALETTE.map(c => c.hex);
}

export function randomColor(palette?: ColorPaletteConfig | null): string {
  const colors = getActiveColors(palette ?? null);
  return colors[Math.floor(Math.random() * colors.length)];
}

export function formatTime(hour: number, minute: number): string {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? 'a' : 'p';
  const m = minute > 0 ? `:${String(minute).padStart(2, '0')}` : '';
  return `${h}${m}${ampm}`;
}
