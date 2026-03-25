'use client';

import { useState, useRef } from 'react';
import type { SchedulingPreferences, GoogleCalendarAccount, ColorPaletteConfig, ColorTheme } from '@/lib/types/domain';
import { COLOR_PALETTE } from '@/lib/utils/format';

interface Props {
  preferences: SchedulingPreferences;
  onUpdate: (prefs: Partial<SchedulingPreferences>) => Promise<SchedulingPreferences>;
  onClose: () => void;
  gcal?: {
    accounts: GoogleCalendarAccount[];
    syncing: boolean;
    connectionError: boolean;
    onDismissError: () => void;
    onSync: () => void;
    onDisconnect: (googleEmail: string) => void;
  };
}

export default function SettingsPanel({ preferences, onUpdate, onClose, gcal }: Props) {
  const [prefs, setPrefs] = useState<SchedulingPreferences>({ ...preferences });
  const [newRule, setNewRule] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingThemeName, setEditingThemeName] = useState<string | null>(null);
  const [editingColorIndex, setEditingColorIndex] = useState<number | null>(null);
  const colorPickerRef = useRef<HTMLInputElement>(null);

  const activeTheme = prefs.colorPalette
    ? prefs.colorPalette.themes.find(t => t.id === prefs.colorPalette!.activeThemeId) ?? prefs.colorPalette.themes[0]
    : null;

  const updateActiveTheme = (updater: (theme: ColorTheme) => ColorTheme) => {
    setPrefs(p => {
      if (!p.colorPalette || !activeTheme) return p;
      return {
        ...p,
        colorPalette: {
          ...p.colorPalette,
          themes: p.colorPalette.themes.map(t =>
            t.id === activeTheme.id ? updater(t) : t
          ),
        },
      };
    });
  };

  const makeDefaultConfig = (): ColorPaletteConfig => {
    const id = crypto.randomUUID();
    return {
      activeThemeId: id,
      themes: [{ id, name: 'My Palette', colors: COLOR_PALETTE.map(c => c.hex) }],
    };
  };

  const addTheme = () => {
    const id = crypto.randomUUID();
    const newTheme: ColorTheme = { id, name: 'New Palette', colors: COLOR_PALETTE.map(c => c.hex) };
    setPrefs(p => {
      if (!p.colorPalette) return p;
      return {
        ...p,
        colorPalette: {
          activeThemeId: id,
          themes: [...p.colorPalette.themes, newTheme],
        },
      };
    });
  };

  const deleteTheme = (themeId: string) => {
    setPrefs(p => {
      if (!p.colorPalette || p.colorPalette.themes.length <= 1) return p;
      const remaining = p.colorPalette.themes.filter(t => t.id !== themeId);
      return {
        ...p,
        colorPalette: {
          activeThemeId: p.colorPalette.activeThemeId === themeId ? remaining[0].id : p.colorPalette.activeThemeId,
          themes: remaining,
        },
      };
    });
  };

  const openPickerForIndex = (index: number) => {
    setEditingColorIndex(index);
    setTimeout(() => colorPickerRef.current?.click(), 0);
  };

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
                {gcal.connectionError && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                    <span>Google Calendar connection failed. Check that the OAuth redirect URI is registered in Google Cloud Console.</span>
                    <button onClick={gcal.onDismissError} className="ml-auto text-red-400/60 hover:text-red-400 flex-shrink-0">&times;</button>
                  </div>
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
                  onClick={() => setPrefs(p => ({ ...p, colorPalette: makeDefaultConfig() }))}
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

                {/* Theme selector */}
                <div className="mt-2 flex items-center gap-2">
                  <select
                    value={prefs.colorPalette.activeThemeId}
                    onChange={e => setPrefs(p => ({
                      ...p,
                      colorPalette: { ...p.colorPalette!, activeThemeId: e.target.value },
                    }))}
                    className="flex-1 bg-bg-secondary border border-border rounded-xl px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
                  >
                    {prefs.colorPalette.themes.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={addTheme}
                    title="Add new theme"
                    className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5">
                      <path d="M7 1v12M1 7h12" />
                    </svg>
                  </button>
                  <button
                    onClick={() => deleteTheme(prefs.colorPalette!.activeThemeId)}
                    disabled={prefs.colorPalette.themes.length <= 1}
                    title="Delete theme"
                    className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" fill="none">
                      <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M3 4l.5 8.5a1 1 0 001 .5h5a1 1 0 001-.5L11 4" />
                    </svg>
                  </button>
                </div>

                {/* Editable theme name */}
                {activeTheme && (
                  <div className="mt-1.5">
                    {editingThemeName === activeTheme.id ? (
                      <input
                        autoFocus
                        value={activeTheme.name}
                        onChange={e => {
                          const val = e.target.value;
                          updateActiveTheme(t => ({ ...t, name: val }));
                        }}
                        onBlur={() => setEditingThemeName(null)}
                        onKeyDown={e => { if (e.key === 'Enter') setEditingThemeName(null); }}
                        className="bg-bg-secondary border border-border rounded-md px-2 py-0.5 text-xs text-text-primary focus:outline-none focus:border-accent w-full"
                      />
                    ) : (
                      <button
                        onClick={() => setEditingThemeName(activeTheme.id)}
                        className="text-[11px] text-text-muted hover:text-text-primary transition-colors"
                        title="Click to rename"
                      >
                        {activeTheme.name} (click to rename)
                      </button>
                    )}
                  </div>
                )}

                {/* Preset swatches */}
                {activeTheme && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {COLOR_PALETTE.map(({ hex, name }) => {
                      const selected = activeTheme.colors.includes(hex);
                      const isLast = selected && activeTheme.colors.length === 1;
                      return (
                        <button
                          key={hex}
                          title={isLast ? `${name} (at least 1 required)` : name}
                          onClick={() => {
                            if (isLast) return;
                            updateActiveTheme(t => ({
                              ...t,
                              colors: selected
                                ? t.colors.filter(c => c !== hex)
                                : [...t.colors, hex],
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
                )}

                {/* Custom colors row */}
                {activeTheme && (
                  <>
                    <div className="mt-3">
                      <label className="text-[11px] text-text-muted">Custom colors:</label>
                      <div className="mt-1 flex flex-wrap gap-2 items-center">
                        {activeTheme.colors
                          .map((hex, idx) => ({ hex, idx }))
                          .filter(({ hex }) => !COLOR_PALETTE.some(p => p.hex === hex))
                          .map(({ hex, idx }) => (
                            <div key={`${hex}-${idx}`} className="relative group">
                              <button
                                onClick={() => openPickerForIndex(idx)}
                                className="w-8 h-8 rounded-full cursor-pointer transition-all"
                                style={{
                                  backgroundColor: hex,
                                  boxShadow: `0 0 0 2px var(--color-bg-primary), 0 0 0 4px ${hex}`,
                                }}
                                title={`Edit ${hex}`}
                              />
                              <button
                                onClick={() => {
                                  if (activeTheme.colors.length <= 1) return;
                                  updateActiveTheme(t => ({
                                    ...t,
                                    colors: t.colors.filter((_, i) => i !== idx),
                                  }));
                                }}
                                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-bg-primary border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Remove"
                              >
                                <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.5">
                                  <path d="M1 1l6 6M7 1L1 7" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        {/* Add custom color button */}
                        <button
                          onClick={() => {
                            const newColor = '#808080';
                            updateActiveTheme(t => ({ ...t, colors: [...t.colors, newColor] }));
                            // Open picker for the newly added color after state update
                            setTimeout(() => {
                              setEditingColorIndex(activeTheme.colors.length);
                              setTimeout(() => colorPickerRef.current?.click(), 0);
                            }, 0);
                          }}
                          className="w-8 h-8 rounded-full border-2 border-dashed border-border flex items-center justify-center text-text-muted hover:text-text-primary hover:border-text-muted transition-colors cursor-pointer"
                          title="Add custom color"
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5">
                            <path d="M6 1v10M1 6h10" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {/* Hidden color picker — edits in place */}
                    <input
                      ref={colorPickerRef}
                      type="color"
                      value={editingColorIndex !== null && activeTheme.colors[editingColorIndex] ? activeTheme.colors[editingColorIndex] : '#808080'}
                      onChange={e => {
                        if (editingColorIndex === null) return;
                        const hex = e.target.value;
                        updateActiveTheme(t => ({
                          ...t,
                          colors: t.colors.map((c, i) => i === editingColorIndex ? hex : c),
                        }));
                      }}
                      className="sr-only"
                    />
                  </>
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
