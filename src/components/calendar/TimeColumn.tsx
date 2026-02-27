'use client';

import { HOUR_HEIGHT, START_HOUR, END_HOUR, GRID_PAD_TOP } from './constants';
import { formatTime } from '@/lib/utils/format';

interface Props {
  now: Date;
  isCurrentWeek: boolean;
  todayDayOfWeek: number;
}

export default function TimeColumn({ now, isCurrentWeek, todayDayOfWeek }: Props) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

  // Current time position
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const showCurrentTime = isCurrentWeek && currentHour >= START_HOUR && currentHour < END_HOUR;
  const currentTimePx = showCurrentTime
    ? ((currentHour - START_HOUR) + currentMinute / 60) * HOUR_HEIGHT + GRID_PAD_TOP
    : -1;

  return (
    <div className="relative w-14 flex-shrink-0 border-r border-border-light" style={{ paddingTop: GRID_PAD_TOP }}>
      {hours.map(hour => (
        <div
          key={hour}
          className="relative text-right pr-2"
          style={{ height: HOUR_HEIGHT }}
        >
          <span className="text-[10px] text-text-muted leading-none -translate-y-1/2 inline-block">
            {formatTime(hour, 0)}
          </span>
        </div>
      ))}

      {/* Current time label */}
      {showCurrentTime && (
        <div
          className="absolute right-0 pr-1 z-10"
          style={{ top: currentTimePx, transform: 'translateY(-50%)' }}
        >
          <span className="text-[10px] font-semibold text-accent bg-bg-primary px-1 rounded">
            {formatTime(currentHour, currentMinute)}
          </span>
        </div>
      )}
    </div>
  );
}
