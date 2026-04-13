'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import type { ScheduleWarning, ScheduleSummary } from '@/lib/types/domain';

interface ScheduleWarningsProps {
  warnings: ScheduleWarning[];
  summary: ScheduleSummary;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 15000;
const TICK_MS = 50;
const MAX_VISIBLE = 4;

const severityDot: Record<string, string> = {
  critical: 'bg-red-400',
  warning: 'bg-amber-400',
  info: 'bg-accent',
};

const severityIcon: Record<string, string> = {
  critical: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-accent',
};

export default function ScheduleWarnings({ warnings, summary, onDismiss }: ScheduleWarningsProps) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const [expanded, setExpanded] = useState(false);
  const elapsed = useRef(0);
  const paused = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Slide-in on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-dismiss countdown (pauses on hover)
  useEffect(() => {
    elapsed.current = 0;
    intervalRef.current = setInterval(() => {
      if (paused.current) return;
      elapsed.current += TICK_MS;
      const remaining = Math.max(0, 100 - (elapsed.current / AUTO_DISMISS_MS) * 100);
      setProgress(remaining);
      if (elapsed.current >= AUTO_DISMISS_MS) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        onDismiss();
      }
    }, TICK_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [onDismiss]);

  const handleMouseEnter = useCallback(() => { paused.current = true; }, []);
  const handleMouseLeave = useCallback(() => { paused.current = false; }, []);

  const visibleWarnings = expanded ? warnings : warnings.slice(0, MAX_VISIBLE);
  const hasMore = warnings.length > MAX_VISIBLE;

  // Pick header icon based on worst severity
  const worstSeverity = warnings.some(w => w.severity === 'critical')
    ? 'critical'
    : warnings.some(w => w.severity === 'warning')
      ? 'warning'
      : 'info';

  const HeaderIcon = worstSeverity === 'info' ? Info : AlertTriangle;

  return (
    <div
      className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="bg-bg-primary border border-border shadow-lg rounded-2xl px-4 py-3 min-w-[380px] max-w-[520px] overflow-hidden relative">
        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-border/30 rounded-b-2xl overflow-hidden">
          <div
            className="h-full bg-accent/50 transition-[width] duration-[50ms] linear"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <HeaderIcon size={16} className={severityIcon[worstSeverity]} />
            <span className="text-sm font-medium text-text-primary">Schedule Insights</span>
          </div>
          <button
            onClick={onDismiss}
            className="p-1 text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Warning list */}
        <div className="space-y-1.5 mb-2">
          {visibleWarnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${severityDot[w.severity]}`} />
              <span className="text-xs text-text-secondary leading-relaxed">{w.message}</span>
            </div>
          ))}
        </div>

        {/* Expand/collapse */}
        {hasMore && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors mb-2"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? 'Show less' : `${warnings.length - MAX_VISIBLE} more`}
          </button>
        )}

        {/* Summary footer */}
        <div className="pt-2 border-t border-border-light">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>
              {formatHours(summary.totalTaskMinutes)} needed / {formatHours(summary.totalAvailableMinutes)} available
            </span>
            <span className={
              summary.utilizationPercent > 100
                ? 'text-red-400 font-medium'
                : summary.utilizationPercent > 85
                  ? 'text-amber-400 font-medium'
                  : 'text-text-muted'
            }>
              {summary.utilizationPercent}% utilization
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
