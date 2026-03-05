'use client';

import { useState } from 'react';
import type { SchedulingPreferences, GoogleCalendarAccount } from '@/lib/types/domain';
import { COLOR_PALETTE } from '@/lib/utils/format';

interface Props {
  preferences: SchedulingPreferences;
  onUpdate: (prefs: Partial<SchedulingPreferences>) => Promise<SchedulingPreferences>;
  onClose: () => void;
  gcal?: {
    accounts: GoogleCalendarAccount[];
    syncing: boolean;
    onSync: () => void;
    onDisconnect: (googleEmail: string) => void;
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
              <div className="mt-2 space-y-2">
                {gcal.accounts.map(account => (
                  <div key={account.id} className="flex items-center gap-2">
                    <span className="text-sm text-text-primary truncate flex-1" title={account.googleEmail || 'Unknown account'}>
                      {account.googleEmail || 'Unknown account'}
                    </span>
                    <button
                      onClick={() => gcal.onDisconnect(account.googleEmail)}
                      className="px-2 py-1 text-xs rounded-md text-red-400 hover:text-red-300 hover:bg-bg-hover transition-colors flex-shrink-0"
                    >
                      Disconnect
                    </button>
                  </div>
                ))}
                {gcal.accounts.length > 0 && (
                  <button
                    onClick={gcal.onSync}
                    disabled={gcal.syncing}
                    className="px-3 py-1.5 text-sm rounded-md bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-40 transition-colors"
                  >
                    {gcal.syncing ? 'Syncing...' : 'Sync Now'}
                  </button>
                )}
                <a
                  href="/api/google-calendar/auth"
                  className="inline-block px-3 py-1.5 text-sm rounded-md bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  {gcal.accounts.length > 0 ? 'Add Google Account' : 'Connect Google Calendar'}
                </a>
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

          {/* Color Palette */}
          <div>
            <label className="text-xs font-medium text-text-secondary uppercase tracking-wide">Task Color Palette</label>
            {prefs.colorPalette === null ? (
              <p className="text-[11px] text-text-muted mt-1">
                All colors active.{' '}
                <button
                  onClick={() => setPrefs(p => ({ ...p, colorPalette: COLOR_PALETTE.map(c => c.hex) }))}
                  className="text-accent hover:underline"
                >
                  Click to customize
                </button>
              </p>
            ) : (
              <>
                <p className="text-[11px] text-text-muted mt-1">
                  New tasks will use only the selected colors.{' '}
                  <button
                    onClick={() => setPrefs(p => ({ ...p, colorPalette: null }))}
                    className="text-accent hover:underline"
                  >
                    Reset to defaults
                  </button>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {COLOR_PALETTE.map(({ hex, name }) => {
                    const selected = prefs.colorPalette!.includes(hex);
                    const isLast = selected && prefs.colorPalette!.length === 1;
                    return (
                      <button
                        key={hex}
                        title={isLast ? `${name} (at least 1 required)` : name}
                        onClick={() => {
                          if (isLast) return;
                          setPrefs(p => ({
                            ...p,
                            colorPalette: selected
                              ? p.colorPalette!.filter(c => c !== hex)
                              : [...p.colorPalette!, hex],
                          }));
                        }}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                          isLast ? 'cursor-not-allowed' : 'cursor-pointer'
                        }`}
                        style={{
                          backgroundColor: hex,
                          boxShadow: selected ? `0 0 0 2px var(--color-bg-primary), 0 0 0 4px ${hex}` : 'none',
                          opacity: selected ? 1 : 0.35,
                        }}
                      >
                        {selected && (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 7l3.5 3.5L12 4" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <label className="text-[11px] text-text-muted">Custom:</label>
                  <input
                    type="color"
                    onChange={e => {
                      const hex = e.target.value;
                      if (!prefs.colorPalette!.includes(hex)) {
                        setPrefs(p => ({ ...p, colorPalette: [...p.colorPalette!, hex] }));
                      }
                    }}
                    className="w-7 h-7 rounded-md border border-border cursor-pointer bg-transparent"
                  />
                </div>
                {prefs.colorPalette.filter(c => !COLOR_PALETTE.some(p => p.hex === c)).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {prefs.colorPalette.filter(c => !COLOR_PALETTE.some(p => p.hex === c)).map(hex => (
                      <button
                        key={hex}
                        title={`Remove ${hex}`}
                        onClick={() => {
                          if (prefs.colorPalette!.length === 1) return;
                          setPrefs(p => ({ ...p, colorPalette: p.colorPalette!.filter(c => c !== hex) }));
                        }}
                        className="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-all"
                        style={{
                          backgroundColor: hex,
                          boxShadow: `0 0 0 2px var(--color-bg-primary), 0 0 0 4px ${hex}`,
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" stroke="white" strokeWidth="1.5">
                          <path d="M1 1l8 8M9 1L1 9" />
                        </svg>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
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
