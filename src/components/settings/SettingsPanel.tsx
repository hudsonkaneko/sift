'use client';

import { useState } from 'react';
import type { SchedulingPreferences } from '@/lib/types/domain';

interface Props {
  preferences: SchedulingPreferences;
  onUpdate: (prefs: Partial<SchedulingPreferences>) => Promise<SchedulingPreferences>;
  onClose: () => void;
  gcal?: {
    isConnected: boolean;
    syncing: boolean;
    onSync: () => void;
    onDisconnect: () => void;
  };
}

export default function SettingsPanel({ preferences, onUpdate, onClose, gcal }: Props) {
  const [prefs, setPrefs] = useState<SchedulingPreferences>({ ...preferences });
  const [newRule, setNewRule] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(prefs);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const addRule = () => {
    if (newRule.trim()) {
      setPrefs(p => ({ ...p, customRules: [...p.customRules, newRule.trim()] }));
      setNewRule('');
    }
  };

  const removeRule = (index: number) => {
    setPrefs(p => ({ ...p, customRules: p.customRules.filter((_, i) => i !== index) }));
  };

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-bg-primary border border-border rounded-2xl shadow-xl w-[480px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Scheduling Preferences</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1l12 12M13 1L1 13" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-5">
          {/* Google Calendar */}
          {gcal && (
            <div>
              <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">Google Calendar</label>
              <div className="mt-2">
                {gcal.isConnected ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-green-500">Connected</span>
                    <button
                      onClick={gcal.onSync}
                      disabled={gcal.syncing}
                      className="px-3 py-1.5 text-sm rounded-md bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-40 transition-colors"
                    >
                      {gcal.syncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                    <button
                      onClick={gcal.onDisconnect}
                      className="px-3 py-1.5 text-sm rounded-md text-red-400 hover:text-red-300 hover:bg-bg-hover transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <a
                    href="/api/google-calendar/auth"
                    className="inline-block px-3 py-1.5 text-sm rounded-md bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                  >
                    Connect Google Calendar
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Time Window */}
          <div>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">Scheduling Window</label>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[11px] text-text-muted mb-1 block">Earliest</label>
                <select
                  value={prefs.earliestHour}
                  onChange={e => setPrefs(p => ({ ...p, earliestHour: parseInt(e.target.value) }))}
                  className="w-full bg-bg-secondary border border-border rounded-xl px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>
                      {i === 0 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`}
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-text-muted mt-4">to</span>
              <div className="flex-1">
                <label className="text-[11px] text-text-muted mb-1 block">Latest</label>
                <select
                  value={prefs.latestHour}
                  onChange={e => setPrefs(p => ({ ...p, latestHour: parseInt(e.target.value) }))}
                  className="w-full bg-bg-secondary border border-border rounded-xl px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
                >
                  {Array.from({ length: 24 }, (_, i) => i + 1).map(i => (
                    <option key={i} value={i}>
                      {i === 24 ? '12:00 AM' : i < 12 ? `${i}:00 AM` : i === 12 ? '12:00 PM' : `${i - 12}:00 PM`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Min Block Size */}
          <div>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">Minimum Block Size</label>
            <div className="mt-2">
              <select
                value={prefs.minBlockMinutes}
                onChange={e => setPrefs(p => ({ ...p, minBlockMinutes: parseInt(e.target.value) }))}
                className="w-full bg-bg-secondary border border-border rounded-xl px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
              >
                <option value={15}>15 minutes</option>
                <option value={20}>20 minutes</option>
                <option value={25}>25 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </div>
          </div>

          {/* Toggle Preferences */}
          <div>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">Deep Work Preferences</label>
            <div className="mt-2 space-y-2">
              <ToggleRow label="Prefer mornings for deep work" checked={prefs.preferMornings} onChange={v => setPrefs(p => ({ ...p, preferMornings: v }))} />
              <ToggleRow label="Prefer evenings for deep work" checked={prefs.preferEvenings} onChange={v => setPrefs(p => ({ ...p, preferEvenings: v }))} />
              <ToggleRow label="Avoid scheduling on weekends" checked={prefs.avoidWeekends} onChange={v => setPrefs(p => ({ ...p, avoidWeekends: v }))} />
            </div>
          </div>

          {/* Custom Rules */}
          <div>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">Custom Rules</label>
            <p className="text-[11px] text-text-muted mt-1">
              Rules set via chat (e.g. &ldquo;don&apos;t schedule before 10&rdquo;) appear here. You can also add them manually.
            </p>
            <div className="mt-2 space-y-1.5">
              {prefs.customRules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2 bg-bg-secondary border border-border rounded-xl px-3 py-1.5 text-sm">
                  <span className="flex-1 text-text-primary">{rule}</span>
                  <button
                    onClick={() => removeRule(i)}
                    className="text-text-muted hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
                      <path d="M1 1l10 10M11 1L1 11" />
                    </svg>
                  </button>
                </div>
              ))}
              <div className="flex gap-2 mt-2">
                <input
                  value={newRule}
                  onChange={e => setNewRule(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addRule(); }}
                  placeholder="Add a custom rule..."
                  className="flex-1 bg-bg-secondary border border-border rounded-xl px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
                <button
                  onClick={addRule}
                  disabled={!newRule.trim()}
                  className="px-3 py-1.5 text-sm rounded-md bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-40 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm font-medium rounded-xl bg-accent hover:bg-accent-dim text-white disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div
        onClick={() => onChange(!checked)}
        className={`w-8 h-[18px] rounded-full relative transition-colors cursor-pointer ${
          checked ? 'bg-accent' : 'bg-bg-tertiary border border-border'
        }`}
      >
        <div
          className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-transform shadow-sm ${
            checked ? 'translate-x-[16px]' : 'translate-x-[2px]'
          }`}
        />
      </div>
      <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">{label}</span>
    </label>
  );
}
