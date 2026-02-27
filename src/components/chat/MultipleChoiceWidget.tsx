'use client';

import { useState } from 'react';
import { Pencil, ArrowRight } from 'lucide-react';

interface Props {
  question: string;
  options: string[];
  onSelect: (answer: string) => void;
  disabled?: boolean;
}

export default function MultipleChoiceWidget({ question, options, onSelect, disabled }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [customText, setCustomText] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleOptionClick = (index: number) => {
    if (submitted || disabled) return;
    setSelected(index);
    setShowCustom(false);
    setSubmitted(true);
    onSelect(options[index]);
  };

  const handleCustomClick = () => {
    if (submitted || disabled) return;
    setSelected(null);
    setShowCustom(true);
  };

  const handleCustomSubmit = () => {
    if (!customText.trim() || submitted || disabled) return;
    setSubmitted(true);
    onSelect(customText.trim());
  };

  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm font-medium text-text-primary">{question}</p>

      <div className="space-y-1.5">
        {options.map((option, i) => {
          const isSelected = selected === i && submitted;
          return (
            <button
              key={i}
              onClick={() => handleOptionClick(i)}
              disabled={submitted || disabled}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all text-left ${
                isSelected
                  ? 'bg-accent-light border border-accent text-accent font-medium'
                  : submitted
                  ? 'bg-bg-secondary border border-border text-text-muted cursor-default opacity-50'
                  : 'bg-bg-secondary border border-border text-text-primary hover:bg-bg-tertiary hover:border-accent/30 cursor-pointer'
              }`}
            >
              <span
                className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
                  isSelected ? 'bg-accent text-white' : 'bg-accent/10 text-accent'
                }`}
              >
                {i + 1}
              </span>
              <span className="flex-1">{option}</span>
              {isSelected && <ArrowRight size={14} className="text-accent flex-shrink-0" />}
            </button>
          );
        })}
      </div>

      <div className="border-t border-border my-2" />

      {!showCustom ? (
        <button
          onClick={handleCustomClick}
          disabled={submitted || disabled}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all text-left ${
            submitted
              ? 'bg-bg-secondary border border-border text-text-muted cursor-default opacity-50'
              : 'bg-bg-secondary border border-border text-text-secondary hover:bg-bg-tertiary hover:border-accent/30 cursor-pointer'
          }`}
        >
          <span className="w-6 h-6 rounded-lg flex items-center justify-center bg-bg-tertiary flex-shrink-0">
            <Pencil size={12} className="text-text-muted" />
          </span>
          <span>Something else</span>
        </button>
      ) : (
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 bg-bg-secondary border border-accent/40 rounded-xl px-3 py-2">
            <Pencil size={12} className="text-text-muted flex-shrink-0" />
            <input
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCustomSubmit();
                if (e.key === 'Escape') { setShowCustom(false); setCustomText(''); }
              }}
              placeholder="Type your answer..."
              autoFocus
              disabled={submitted || disabled}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder-text-muted outline-none"
            />
          </div>
          <button
            onClick={handleCustomSubmit}
            disabled={!customText.trim() || submitted || disabled}
            className="px-3 py-2 text-sm font-medium rounded-xl bg-accent hover:bg-accent-dim text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
