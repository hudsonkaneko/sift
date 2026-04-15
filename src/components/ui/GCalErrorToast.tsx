'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface GCalErrorToastProps {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 8000;
const TICK_MS = 50;

export default function GCalErrorToast({ message, onRetry, onDismiss }: GCalErrorToastProps) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const elapsed = useRef(0);
  const paused = useRef(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    elapsed.current = 0;
    const interval = setInterval(() => {
      if (paused.current) return;
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

  const handleMouseEnter = useCallback(() => { paused.current = true; }, []);
  const handleMouseLeave = useCallback(() => { paused.current = false; }, []);

  const handleRetry = useCallback(() => {
    onRetry();
    onDismiss();
  }, [onRetry, onDismiss]);

  return (
    <div
      className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="bg-bg-primary border border-border shadow-lg rounded-2xl px-4 py-3 flex items-center gap-3 min-w-[340px] max-w-[480px] overflow-hidden relative">
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-border/30 rounded-b-2xl overflow-hidden">
          <div className="h-full bg-red-400/50 transition-[width] duration-[50ms] linear" style={{ width: `${progress}%` }} />
        </div>

        <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="text-sm text-text-primary font-medium">Google Calendar sync failed</div>
          <div className="text-xs text-text-muted truncate">{message}</div>
        </div>

        <button
          onClick={handleRetry}
          className="shrink-0 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-bg-tertiary hover:bg-border text-text-primary transition-colors flex items-center gap-1"
        >
          <RefreshCw size={12} />
          Retry
        </button>

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
