'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { COLOR_PALETTE, DAYS_SHORT } from '@/lib/utils/format';
import { START_HOUR, END_HOUR, SNAP_MINUTES } from './constants';

export interface EventFormState {
  mode: 'create' | 'edit';
  blockId?: string;
  name: string;
  color: string | null;
  dayOfWeek: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

interface Props {
  form: EventFormState;
  onClose: () => void;
  onSave: (form: EventFormState) => void;
}

export default function EventFormModal({ form, onClose, onSave }: Props) {
  const [name, setName] = useState(form.name);
  const [color, setColor] = useState<string | null>(form.color);
  const [dayOfWeek, setDayOfWeek] = useState(form.dayOfWeek);
  const [startHour, setStartHour] = useState(form.startHour);
  const [startMinute, setStartMinute] = useState(form.startMinute);
  const [endHour, setEndHour] = useState(form.endHour);
  const [endMinute, setEndMinute] = useState(form.endMinute);

  useEffect(() => {
    setName(form.name);
    setColor(form.color);
    setDayOfWeek(form.dayOfWeek);
    setStartHour(form.startHour);
    setStartMinute(form.startMinute);
    setEndHour(form.endHour);
    setEndMinute(form.endMinute);
  }, [form]);

  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;
  const isValid = name.trim().length > 0 && endTotal > startTotal;

  const handleSave = () => {
    if (!isValid) return;
    onSave({
      ...form,
      name: name.trim(),
      color,
      dayOfWeek,
      startHour,
      startMinute,
      endHour,
      endMinute,
    });
  };

  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const minutes = Array.from({ length: 60 / SNAP_MINUTES }, (_, i) => i * SNAP_MINUTES);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-bg-primary border border-border rounded-2xl shadow-lg w-[360px] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">
            {form.mode === 'create' ? 'New Event' : 'Edit Event'}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-bg-tertiary text-text-muted">
            <X size={16} />
          </button>
        </div>

        {/* Name */}
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
          placeholder="Event name"
          autoFocus
          className="w-full px-3 py-2 rounded-xl border border-border bg-bg-secondary text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent mb-3"
        />

        {/* Day */}
        <div className="mb-3">
          <p className="text-xs text-text-muted mb-1.5">Day</p>
          <div className="flex gap-1">
            {DAYS_SHORT.map((day, i) => (
              <button
                key={i}
                onClick={() => setDayOfWeek(i)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  i === dayOfWeek
                    ? 'bg-accent text-white'
                    : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        {/* Color */}
        <div className="mb-3">
          <p className="text-xs text-text-muted mb-1.5">Color</p>
          <div className="flex items-center gap-1.5">
            {COLOR_PALETTE.map(c => (
              <button
                key={c.hex}
                onClick={() => setColor(color === c.hex ? null : c.hex)}
                className={`w-6 h-6 rounded-full border-2 transition-colors ${
                  color === c.hex ? 'border-text-primary scale-110' : 'border-transparent hover:border-border'
                }`}
                style={{ backgroundColor: c.hex }}
                title={c.name}
              />
            ))}
            {color && (
              <button
                onClick={() => setColor(null)}
                className="text-xs text-text-muted hover:text-text-secondary ml-1"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Time */}
        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <p className="text-xs text-text-muted mb-1.5">Start</p>
            <div className="flex gap-1">
              <select
                value={startHour}
                onChange={e => setStartHour(Number(e.target.value))}
                className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-bg-secondary text-sm text-text-primary outline-none"
              >
                {hours.map(h => (
                  <option key={h} value={h}>{h > 12 ? h - 12 : h}{h < 12 ? 'am' : 'pm'}</option>
                ))}
              </select>
              <select
                value={startMinute}
                onChange={e => setStartMinute(Number(e.target.value))}
                className="w-16 px-2 py-1.5 rounded-lg border border-border bg-bg-secondary text-sm text-text-primary outline-none"
              >
                {minutes.map(m => (
                  <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex-1">
            <p className="text-xs text-text-muted mb-1.5">End</p>
            <div className="flex gap-1">
              <select
                value={endHour}
                onChange={e => setEndHour(Number(e.target.value))}
                className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-bg-secondary text-sm text-text-primary outline-none"
              >
                {hours.map(h => (
                  <option key={h} value={h}>{h > 12 ? h - 12 : h}{h < 12 ? 'am' : 'pm'}</option>
                ))}
              </select>
              <select
                value={endMinute}
                onChange={e => setEndMinute(Number(e.target.value))}
                className="w-16 px-2 py-1.5 rounded-lg border border-border bg-bg-secondary text-sm text-text-primary outline-none"
              >
                {minutes.map(m => (
                  <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-text-secondary hover:bg-bg-tertiary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-accent hover:bg-accent-dim text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {form.mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
