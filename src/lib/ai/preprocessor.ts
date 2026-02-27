// Direct port from existing preprocessor.ts — pure logic, no Electron deps

import nlp from 'compromise';
import * as chrono from 'chrono-node';

export interface ExtractedDate {
  original: string;
  normalized: string;
  iso: string;
}

export interface PreprocessedInput {
  cleaned: string;
  dates: ExtractedDate[];
  wasModified: boolean;
}

const FILLER_PATTERNS: RegExp[] = [
  /\b(um+|uh+|er+|ah+|hmm+)\b/gi,
  /\b(you know),?\s*/gi,
  /\b(i mean),?\s*/gi,
  /\b(basically)\s+/gi,
  /\b(literally)\s+/gi,
  /\b(sort of|kind of)\s+/gi,
  /\b(i think maybe|i think like)\s+/gi,
  /\b(ok so|okay so)\s+/gi,
  /\b(so yeah)\s*/gi,
  /\b(and uh|and um)\s+/gi,
  /\b(like uh|like um)\s+/gi,
  /\b(and like|but like|so like)\s+/gi,
  /^like\s+/i,
  /\bfor like\s+/gi,
];

function removeFiller(text: string): string {
  let result = text;
  for (let pass = 0; pass < 3; pass++) {
    const before = result;
    for (const pattern of FILLER_PATTERNS) {
      result = result.replace(pattern, (match) => {
        if (/^for like\s/i.test(match)) return 'for ';
        const conjMatch = match.match(/^(and|but|so)\s/i);
        return conjMatch ? conjMatch[1] + ' ' : '';
      });
    }
    result = result.replace(/[ \t]+/g, ' ').trim();
    if (result === before) break;
  }
  return result;
}

function deduplicateRepeatedWords(text: string): string {
  return text.replace(/\b(\w+)\s+\1\b/gi, '$1');
}

function fixWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ +([.,!?])/g, '$1')
    .replace(/([.,!?])([A-Za-z])/g, '$1 $2')
    .trim();
}

const DURATION_PATTERN = /^(for\s+)?\d+\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)$/i;

function extractAndNormalizeDates(text: string): { text: string; dates: ExtractedDate[] } {
  const results = chrono.parse(text, new Date(), { forwardDate: true });
  const dates: ExtractedDate[] = [];

  if (results.length === 0) return { text, dates };

  const dateResults = results.filter(r => !DURATION_PATTERN.test(r.text.trim()));
  if (dateResults.length === 0) return { text, dates };

  let modified = text;
  for (let i = dateResults.length - 1; i >= 0; i--) {
    const r = dateResults[i];
    const parsed = r.start.date();
    const dayName = parsed.toLocaleDateString('en-US', { weekday: 'long' });
    const monthDay = parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const iso = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;

    const normalized = `${dayName}, ${monthDay}`;
    dates.unshift({ original: r.text, normalized, iso });
    modified = modified.slice(0, r.index) + normalized + modified.slice(r.index + r.text.length);
  }

  return { text: modified, dates };
}

function segmentSentences(text: string): string {
  const doc = nlp(text);
  const sentences: string[] = doc.sentences().out('array') as string[];
  if (sentences.length === 0) return text;

  return sentences
    .map((s: string) => {
      let trimmed = s.trim();
      if (!trimmed) return '';
      trimmed = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
      if (!/[.!?]$/.test(trimmed)) trimmed += '.';
      return trimmed;
    })
    .filter(Boolean)
    .join(' ');
}

export function preprocessBraindump(rawText: string): PreprocessedInput {
  if (!rawText || rawText.length < 10) {
    return { cleaned: rawText || '', dates: [], wasModified: false };
  }

  let text = rawText;
  text = removeFiller(text);
  text = deduplicateRepeatedWords(text);
  text = fixWhitespace(text);
  const { text: datedText, dates } = extractAndNormalizeDates(text);
  text = datedText;
  text = segmentSentences(text);
  text = fixWhitespace(text);

  return { cleaned: text, dates, wasModified: text !== rawText.trim() };
}

export function buildEnhancedMessage(raw: string, preprocessed: PreprocessedInput): string {
  if (!preprocessed.wasModified) return raw;

  let message = preprocessed.cleaned;
  if (preprocessed.dates.length > 0) {
    const dateSummary = preprocessed.dates
      .map(d => `  "${d.original}" = ${d.normalized} (${d.iso})`)
      .join('\n');
    message += `\n\n[Extracted dates:\n${dateSummary}]`;
  }

  return message;
}
