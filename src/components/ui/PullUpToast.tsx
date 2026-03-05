'use client';

import { useEffect, useState, useRef } from 'react';

interface PullUpToastProps {
  taskName: string;
  onPullUp: () => void;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 8000;
const TICK_MS = 50;

export default function PullUpToast({ taskName, onPullUp, onDismiss }: PullUpToastProps) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const elapsed = useRef(0);

  // Slide-in on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-dismiss countdown
  useEffect(() => {
    elapsed.current = 0;
    const interval = setInterval(() => {
      elapsed.current += TICK_MS;
      const remaining = Math.max(0, 100 - (elapsed.current / AUTO_DISMISS_MS) * 100);
      setProgress(remaining);
      if (elapsed.current >= AUTO_DISMISS_MS) {
        clearInterval(interval);
        onDismiss();
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, [onDismiss]);

  return (
    <div
      className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
    >
      <div className="bg-bg-primary border border-border shadow-lg rounded-2xl px-4 py-3 flex items-center gap-3 min-w-[340px] max-w-[480px] overflow-hidden relative">
        {/* Progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-border/30 rounded-b-2xl overflow-hidden">
          <div
            className="h-full bg-accent/50 transition-[width] duration-[50ms] linear"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Clock icon */}
        <svg className="w-5 h-5 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
        </svg>

        {/* Message */}
        <span className="text-sm text-text-primary truncate">
          Finished early! Pull up <strong className="font-semibold">{taskName}</strong>?
        </span>

        {/* Pull up button */}
        <button
          onClick={onPullUp}
          className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors"
        >
          Pull up
        </button>

        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          className="shrink-0 p-1 text-text-secondary hover:text-text-primary transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
