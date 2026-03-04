'use client';

import { useState, useMemo } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import type { GoogleCalendarSource } from '@/lib/types/domain';
import type { CalendarVisibility } from '@/hooks/useCalendarSources';

interface Props {
  sources: GoogleCalendarSource[];
  visibility: CalendarVisibility;
  onToggleFixedBlocks: () => void;
  onToggleGoogleCalendar: (googleCalendarId: string) => void;
  hasGoogleCalendar: boolean;
}

export default function CalendarSourcesSidebar({
  sources,
  visibility,
  onToggleFixedBlocks,
  onToggleGoogleCalendar,
  hasGoogleCalendar,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div className="w-8 border-l border-border-light bg-bg-primary flex flex-col items-center pt-3">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1 rounded hover:bg-bg-tertiary text-text-muted"
          title="Expand calendars"
        >
          <ChevronLeft size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-[200px] border-l border-border-light bg-bg-primary flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-light">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          Calendars
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="p-0.5 rounded hover:bg-bg-tertiary text-text-muted"
          title="Collapse"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-2 space-y-1">
        {/* Fixed Blocks toggle */}
        <SourceRow
          name="Fixed Blocks"
          color="var(--color-accent)"
          visible={visibility.fixedBlocks}
          onToggle={onToggleFixedBlocks}
        />

        {/* Google Calendar sections grouped by account */}
        {hasGoogleCalendar && sources.length > 0 && (
          <GroupedSources
            sources={sources}
            visibility={visibility}
            onToggleGoogleCalendar={onToggleGoogleCalendar}
          />
        )}
      </div>
    </div>
  );
}

function GroupedSources({
  sources,
  visibility,
  onToggleGoogleCalendar,
}: {
  sources: GoogleCalendarSource[];
  visibility: CalendarVisibility;
  onToggleGoogleCalendar: (googleCalendarId: string) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, GoogleCalendarSource[]>();
    for (const source of sources) {
      const key = source.googleEmail || 'Google Calendar';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(source);
    }
    return Array.from(map.entries());
  }, [sources]);

  return (
    <>
      {grouped.map(([email, emailSources]) => (
        <div key={email}>
          <div className="px-2 pt-3 pb-1">
            <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider truncate block" title={email}>
              {email}
            </span>
          </div>
          {emailSources.map(source => (
            <SourceRow
              key={source.id}
              name={source.name}
              color={source.color || '#9ca3af'}
              visible={visibility.googleCalendars[source.googleCalendarId] ?? true}
              onToggle={() => onToggleGoogleCalendar(source.googleCalendarId)}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function SourceRow({
  name,
  color,
  visible,
  onToggle,
}: {
  name: string;
  color: string;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors hover:bg-bg-tertiary ${
        visible ? 'text-text-primary' : 'text-text-muted line-through opacity-50'
      }`}
    >
      <span
        className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
        style={{
          backgroundColor: visible ? color : 'transparent',
          border: visible ? 'none' : `1.5px solid ${color}`,
        }}
      />
      <span className="truncate">{name}</span>
    </button>
  );
}
