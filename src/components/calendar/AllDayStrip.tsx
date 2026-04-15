'use client';

import type { FixedBlock } from '@/lib/types/domain';
import { DAY_INDICES } from './constants';

interface AllDayStripProps {
  weekDates: string[];
  todayDateStr: string;
  allDayBlocks: FixedBlock[];
}

const MAX_VISIBLE_PER_DAY = 2;

export default function AllDayStrip({ weekDates, todayDateStr, allDayBlocks }: AllDayStripProps) {
  // If no all-day events anywhere in the week, don't render the strip at all
  if (allDayBlocks.length === 0) return null;

  return (
    <div className="flex border-b border-border-light bg-bg-secondary/40">
      <div className="w-14 flex-shrink-0 flex items-start justify-end pr-1 pt-1">
        <span className="text-[9px] text-text-muted uppercase tracking-wider">All day</span>
      </div>
      {DAY_INDICES.map(i => {
        const dateStr = weekDates[i];
        const isTodayCol = dateStr === todayDateStr;
        const dayEvents = allDayBlocks.filter(b =>
          b.specificDate ? b.specificDate === dateStr : b.dayOfWeek === i
        );
        const visible = dayEvents.slice(0, MAX_VISIBLE_PER_DAY);
        const overflow = dayEvents.length - visible.length;

        return (
          <div
            key={i}
            className={`flex-1 border-r border-border-light last:border-r-0 py-1 px-1 flex flex-col gap-0.5 min-h-[28px] ${
              isTodayCol ? 'bg-accent/5' : ''
            }`}
          >
            {visible.map(ev => (
              <div
                key={ev.id}
                title={ev.name}
                className="text-[10px] px-1.5 py-0.5 rounded text-white truncate"
                style={{ backgroundColor: ev.color || '#9e9eb8' }}
              >
                {ev.name}
              </div>
            ))}
            {overflow > 0 && (
              <div className="text-[10px] text-text-muted px-1">+{overflow} more</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
