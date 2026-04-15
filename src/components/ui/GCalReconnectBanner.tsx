'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { GoogleCalendarAccount } from '@/lib/types/domain';

interface GCalReconnectBannerProps {
  accounts: GoogleCalendarAccount[];
}

const DISMISS_STORAGE_KEY = 'sift:gcal-reconnect-dismissed';

function getDismissed(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(DISMISS_STORAGE_KEY) || '{}');
  } catch { return {}; }
}

function setDismissed(map: Record<string, string>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(map));
  } catch { /* ignore quota */ }
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function GCalReconnectBanner({ accounts }: GCalReconnectBannerProps) {
  const [dismissedMap, setDismissedMapState] = useState<Record<string, string>>({});

  useEffect(() => {
    setDismissedMapState(getDismissed());
  }, []);

  const failing = accounts.filter(a => {
    if (!a.refreshFailedAt) return false;
    // Dismissed for today?
    return dismissedMap[a.googleEmail] !== todayStr();
  });

  if (failing.length === 0) return null;

  const handleReconnect = (email: string) => {
    window.location.href = `/api/google-calendar/auth?email=${encodeURIComponent(email)}`;
  };

  const handleDismiss = (email: string) => {
    const next = { ...dismissedMap, [email]: todayStr() };
    setDismissedMapState(next);
    setDismissed(next);
  };

  return (
    <div className="flex flex-col gap-1 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30">
      {failing.map(acc => (
        <div key={acc.id} className="flex items-center gap-3 text-xs">
          <AlertTriangle size={14} className="text-amber-500 shrink-0" />
          <span className="flex-1 text-text-primary">
            Google Calendar <strong>{acc.googleEmail}</strong> needs to reconnect (token refresh failed).
          </span>
          <button
            onClick={() => handleReconnect(acc.googleEmail)}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors"
          >
            Reconnect
          </button>
          <button
            onClick={() => handleDismiss(acc.googleEmail)}
            className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
