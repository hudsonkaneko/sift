/**
 * Get the Sunday (start of week) for a given Date object.
 * Returns YYYY-MM-DD string using local date parts.
 */
export function getSunday(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the Sunday (start of week) for a YYYY-MM-DD date string.
 * Uses UTC to avoid timezone shifts.
 */
export function getSundayForDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().split('T')[0];
}
