import Anthropic from '@anthropic-ai/sdk';
import type { Task, SchedulingPreferences, ChatMessage, ParsedTaskData, FixedBlock, UserTone } from '@/lib/types/domain';
import { buildSystemPrompt } from './system-prompts';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';
const MAX_HISTORY_MESSAGES = 20;

export interface ProjectContext {
  task: Task;
  subtasks: Task[];
  memory: ChatMessage[];
}

interface MessagePair {
  role: 'user' | 'assistant';
  content: string;
}

export interface TaskUpdate {
  taskName: string;
  updates: {
    name?: string;
    category?: string;
    estimatedMinutes?: number;
    deadline?: string | null;
    recurrence?: string;
    completed?: boolean;
  };
}

export interface FollowUpQuestion {
  question: string;
  options: string[];
}

export interface ChatProcessResult {
  message: string;
  newTasks: ParsedTaskData[];
  taskUpdates: TaskUpdate[];
  newBlocks: Omit<FixedBlock, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[];
  preferenceUpdates: Partial<SchedulingPreferences> | null;
  followUpQuestion: FollowUpQuestion | null;
  sessionName: string | null;
}

const EMPTY_RESULT: ChatProcessResult = {
  message: '',
  newTasks: [],
  taskUpdates: [],
  newBlocks: [],
  preferenceUpdates: null,
  followUpQuestion: null,
  sessionName: null,
};

function buildHistory(chatHistory: ChatMessage[]): MessagePair[] {
  return chatHistory.slice(-MAX_HISTORY_MESSAGES).map(m => ({
    role: m.role,
    content: m.content,
  }));
}

function validateCategory(cat: string): ParsedTaskData['category'] {
  const valid = ['School', 'Startup', 'Collab', 'Personal'];
  if (valid.includes(cat)) return cat as ParsedTaskData['category'];
  if (cat?.toLowerCase().includes('axion') || cat?.toLowerCase().includes('startup')) return 'Startup';
  if (cat?.toLowerCase().includes('play') || cat?.toLowerCase().includes('collab')) return 'Collab';
  if (cat?.toLowerCase().includes('school') || cat?.toLowerCase().includes('class')) return 'School';
  return 'Personal';
}

function validateRecurrence(rec: string): ParsedTaskData['recurrence'] {
  const valid = ['none', 'daily', 'weekdays', 'weekly'];
  if (valid.includes(rec)) return rec as ParsedTaskData['recurrence'];
  return 'none';
}

/**
 * Extract JSON from Claude's response text.
 *
 * Handles:
 *   1. Raw JSON (no wrapping)
 *   2. Markdown-fenced JSON (```json ... ``` or ``` ... ```)
 *   3. JSON embedded in prose text
 *
 * Returns null if no valid JSON object is found.
 */
function extractJSON(text: string): Record<string, unknown> | null {
  // 1. Try markdown-fenced JSON first (```json ... ``` or ``` ... ```)
  const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fencedMatch) {
    try {
      const parsed = JSON.parse(fencedMatch[1].trim());
      if (typeof parsed === 'object' && parsed !== null) {
        console.log('[AI] Extracted JSON from markdown fence');
        return parsed;
      }
    } catch {
      console.warn('[AI] Markdown-fenced block was not valid JSON, falling through');
    }
  }

  // 2. Try the full text as raw JSON
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    } catch {
      // Fall through to regex extraction
    }
  }

  // 3. Greedy regex: find the outermost { ... } block
  //    Use bracket counting for robustness instead of simple greedy regex
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let lastBrace = -1;

  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        lastBrace = i;
        break;
      }
    }
  }

  if (lastBrace === -1) {
    console.warn('[AI] Found opening brace but no matching closing brace');
    return null;
  }

  const candidate = text.slice(firstBrace, lastBrace + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed;
    }
  } catch (err) {
    console.warn('[AI] Bracket-matched block was not valid JSON:', (err as Error).message);
  }

  return null;
}

/**
 * Validate that a parsed JSON response has the expected shape.
 * Returns a safe result even if some fields are missing or malformed.
 */
function validateAndNormalize(parsed: Record<string, unknown>): {
  message: string;
  newTasks: Record<string, unknown>[];
  taskUpdates: Record<string, unknown>[];
  newBlocks: Record<string, unknown>[];
  preferenceUpdates: Record<string, unknown> | null;
  followUpQuestion: Record<string, unknown> | null;
  sessionName: string | null;
} {
  const message = typeof parsed.message === 'string' ? parsed.message : 'Processed.';

  const newTasks = Array.isArray(parsed.newTasks)
    ? parsed.newTasks.filter((t): t is Record<string, unknown> =>
        typeof t === 'object' && t !== null && typeof (t as Record<string, unknown>).name === 'string')
    : [];

  const taskUpdates = Array.isArray(parsed.taskUpdates)
    ? parsed.taskUpdates.filter((u): u is Record<string, unknown> =>
        typeof u === 'object' && u !== null && typeof (u as Record<string, unknown>).taskName === 'string')
    : [];

  const newBlocks = Array.isArray(parsed.newBlocks)
    ? parsed.newBlocks.filter((b): b is Record<string, unknown> =>
        typeof b === 'object' && b !== null && typeof (b as Record<string, unknown>).name === 'string')
    : [];

  const preferenceUpdates = typeof parsed.preferenceUpdates === 'object' && parsed.preferenceUpdates !== null
    ? parsed.preferenceUpdates as Record<string, unknown>
    : null;

  let followUpQuestion: Record<string, unknown> | null = null;
  if (typeof parsed.followUpQuestion === 'object' && parsed.followUpQuestion !== null) {
    const fq = parsed.followUpQuestion as Record<string, unknown>;
    if (typeof fq.question === 'string' && Array.isArray(fq.options) && fq.options.length > 0) {
      followUpQuestion = fq;
    }
  }

  const sessionName = typeof parsed.sessionName === 'string' && parsed.sessionName.trim()
    ? parsed.sessionName.trim().slice(0, 50)
    : null;

  if (newTasks.length > 0 || taskUpdates.length > 0 || newBlocks.length > 0) {
    const skippedTasks = (Array.isArray(parsed.newTasks) ? parsed.newTasks.length : 0) - newTasks.length;
    const skippedUpdates = (Array.isArray(parsed.taskUpdates) ? parsed.taskUpdates.length : 0) - taskUpdates.length;
    if (skippedTasks > 0 || skippedUpdates > 0) {
      console.warn(`[AI] Validation filtered out ${skippedTasks} invalid tasks, ${skippedUpdates} invalid updates`);
    }
  }

  return { message, newTasks, taskUpdates, newBlocks, preferenceUpdates, followUpQuestion, sessionName };
}

export async function processChatMessage(
  input: string,
  existingTasks: Task[],
  currentPrefs: SchedulingPreferences,
  chatHistory: ChatMessage[],
  tone: UserTone = 'friendly',
  projectContext?: ProjectContext,
): Promise<ChatProcessResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey });
  const system = buildSystemPrompt(tone, existingTasks, currentPrefs, projectContext);
  const history = buildHistory(chatHistory);
  const messages: MessagePair[] = [...history, { role: 'user', content: input }];

  console.log('[AI] Sending message to Claude, history length:', history.length);

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system,
    messages,
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  console.log('[AI] Claude response length:', text.length, 'stop_reason:', response.stop_reason);

  // Extract and validate JSON
  const parsed = extractJSON(text);
  if (!parsed) {
    console.warn('[AI] No JSON found in Claude response. Raw text:', text.slice(0, 500));
    return { ...EMPTY_RESULT, message: text || 'I had trouble processing that. Could you try rephrasing?' };
  }

  const validated = validateAndNormalize(parsed);

  try {
    const parseTask = (t: Record<string, unknown>, parentCategory?: string, parentDeadline?: string | null, parentRecurrence?: string): ParsedTaskData => {
      const category = validateCategory((t.category as string) || parentCategory || 'Personal');
      const deadline = (t.deadline as string) || parentDeadline || null;
      const recurrence = validateRecurrence((t.recurrence as string) || parentRecurrence || 'none');
      const subtasksRaw = Array.isArray(t.subtasks) ? t.subtasks as Record<string, unknown>[] : [];
      const hasSubtasks = subtasksRaw.length > 0;

      const result: ParsedTaskData = {
        name: t.name as string,
        category,
        estimatedMinutes: hasSubtasks ? 0 : Math.max(15, Math.round((t.estimatedMinutes as number) || 60)),
        deadline,
        recurrence,
        urgency: Math.min(100, Math.max(0, Math.round((t.urgency as number) || 0))),
      };

      if (hasSubtasks) {
        result.subtasks = subtasksRaw.map(sub => parseTask(sub, category as string, deadline, recurrence as string));
      }

      return result;
    };

    const newTasks: ParsedTaskData[] = validated.newTasks.map(t => parseTask(t));

    const taskUpdates: TaskUpdate[] = validated.taskUpdates.map(u => {
      const updates = u.updates as Record<string, unknown> || {};
      return {
        taskName: (u.taskName as string) || '',
        updates: {
          ...(updates.name !== undefined && { name: updates.name as string }),
          ...(updates.category !== undefined && { category: validateCategory(updates.category as string) }),
          ...(updates.estimatedMinutes !== undefined && { estimatedMinutes: Math.max(15, Math.round(updates.estimatedMinutes as number)) }),
          ...(updates.deadline !== undefined && { deadline: updates.deadline as string | null }),
          ...(updates.recurrence !== undefined && { recurrence: validateRecurrence(updates.recurrence as string) }),
          ...(updates.completed !== undefined && { completed: !!updates.completed }),
        },
      };
    });

    const newBlocks = validated.newBlocks.map(b => ({
      name: b.name as string,
      dayOfWeek: Math.min(6, Math.max(0, b.dayOfWeek as number)),
      startHour: b.startHour as number,
      startMinute: (b.startMinute as number) || 0,
      endHour: b.endHour as number,
      endMinute: (b.endMinute as number) || 0,
      userCreated: false,
      color: null,
      recurring: true,
      googleEventId: null,
      googleCalendarId: null,
      specificDate: null,
    }));

    let preferenceUpdates: Partial<SchedulingPreferences> | null = null;
    if (validated.preferenceUpdates) {
      const p = validated.preferenceUpdates;
      preferenceUpdates = {};
      if (p.earliestHour !== undefined) preferenceUpdates.earliestHour = Math.max(0, Math.min(23, p.earliestHour as number));
      if (p.latestHour !== undefined) preferenceUpdates.latestHour = Math.max(1, Math.min(24, p.latestHour as number));
      if (p.minBlockMinutes !== undefined) preferenceUpdates.minBlockMinutes = Math.max(10, Math.min(180, p.minBlockMinutes as number));
      if (p.preferMornings !== undefined) preferenceUpdates.preferMornings = !!p.preferMornings;
      if (p.preferEvenings !== undefined) preferenceUpdates.preferEvenings = !!p.preferEvenings;
      if (p.avoidWeekends !== undefined) preferenceUpdates.avoidWeekends = !!p.avoidWeekends;
      if (p.addRule) {
        preferenceUpdates.customRules = [...currentPrefs.customRules, p.addRule as string];
      }
      if (p.removeRuleIndex !== undefined && (p.removeRuleIndex as number) >= 0 && (p.removeRuleIndex as number) < currentPrefs.customRules.length) {
        const rules = preferenceUpdates.customRules || [...currentPrefs.customRules];
        rules.splice(p.removeRuleIndex as number, 1);
        preferenceUpdates.customRules = rules;
      }
      if (Object.keys(preferenceUpdates).length === 0) preferenceUpdates = null;
    }

    let followUpQuestion: FollowUpQuestion | null = null;
    if (validated.followUpQuestion) {
      const fq = validated.followUpQuestion;
      followUpQuestion = {
        question: fq.question as string,
        options: (fq.options as unknown[]).slice(0, 4).map(o => String(o)),
      };
    }

    console.log('[AI] Parsed result:', {
      newTasks: newTasks.length,
      taskUpdates: taskUpdates.length,
      newBlocks: newBlocks.length,
      hasPreferenceUpdates: !!preferenceUpdates,
      hasFollowUp: !!followUpQuestion,
      sessionName: validated.sessionName,
    });

    return {
      message: validated.message,
      newTasks,
      taskUpdates,
      newBlocks,
      preferenceUpdates,
      followUpQuestion,
      sessionName: validated.sessionName,
    };
  } catch (parseErr) {
    console.error('[AI] Failed to process validated JSON:', parseErr);
    return { ...EMPTY_RESULT, message: validated.message || text };
  }
}
