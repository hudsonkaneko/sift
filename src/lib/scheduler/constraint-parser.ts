/**
 * Parses free-text custom scheduling rules into structured constraints.
 *
 * Extracted from scheduled-slots/generate/route.ts for modularity.
 */

export interface ParsedRules {
  gapMinutes: number;
  blockedDays: Set<number>;
  noScheduleBefore: number | null; // minutes from midnight
  noScheduleAfter: number | null;  // minutes from midnight
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

export function parseCustomRules(rules: string[]): ParsedRules {
  const parsed: ParsedRules = {
    gapMinutes: 0,
    blockedDays: new Set(),
    noScheduleBefore: null,
    noScheduleAfter: null,
  };

  for (const rule of rules) {
    const lower = rule.toLowerCase();

    // Gap/buffer: matches keywords + number-min pattern
    const gapKeywords = /gap|buffer|break|between|padding|space|spacing/;
    if (gapKeywords.test(lower)) {
      const numMatch = lower.match(/(\d+)[\s-]*min/);
      if (numMatch) {
        parsed.gapMinutes = Math.max(parsed.gapMinutes, parseInt(numMatch[1]));
      }
    }

    // Time restrictions: "no scheduling before 10am"
    const beforeMatch = lower.match(/before\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (beforeMatch && /(?:no|don'?t|never|avoid|nothing|earliest|start)/.test(lower)) {
      let hour = parseInt(beforeMatch[1]);
      const minute = beforeMatch[2] ? parseInt(beforeMatch[2]) : 0;
      if (beforeMatch[3] === 'pm' && hour < 12) hour += 12;
      if (beforeMatch[3] === 'am' && hour === 12) hour = 0;
      const mins = hour * 60 + minute;
      parsed.noScheduleBefore = parsed.noScheduleBefore ? Math.max(parsed.noScheduleBefore, mins) : mins;
    }

    const afterMatch = lower.match(/after\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
    if (afterMatch && /(?:no|don'?t|never|avoid|nothing|latest|stop|end)/.test(lower)) {
      let hour = parseInt(afterMatch[1]);
      const minute = afterMatch[2] ? parseInt(afterMatch[2]) : 0;
      if (afterMatch[3] === 'pm' && hour < 12) hour += 12;
      if (afterMatch[3] === 'am' && hour === 12) hour = 0;
      const mins = hour * 60 + minute;
      parsed.noScheduleAfter = parsed.noScheduleAfter ? Math.min(parsed.noScheduleAfter, mins) : mins;
    }

    // Day restrictions: day name + negative keyword
    for (const [name, dayNum] of Object.entries(DAY_NAMES)) {
      if (lower.includes(name) && /(?:no|don'?t|never|avoid|skip|off)/.test(lower)) {
        parsed.blockedDays.add(dayNum);
      }
    }
  }

  return parsed;
}
