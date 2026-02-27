'use client';

import { UserButton } from '@clerk/nextjs';
import { Settings } from 'lucide-react';

interface TopBarProps {
  onSettingsClick: () => void;
}

export default function TopBar({ onSettingsClick }: TopBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-primary">
      <div className="flex items-center gap-2">
        <span className="text-lg font-semibold text-accent">Sift</span>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={onSettingsClick}
          className="p-1.5 rounded-lg hover:bg-bg-hover text-text-secondary transition-colors"
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
        <UserButton afterSignOutUrl="/" />
      </div>
    </div>
  );
}
