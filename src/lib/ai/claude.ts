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

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system,
    messages,
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

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

      const newTasks: ParsedTaskData[] = (parsed.newTasks || []).map((t: Record<string, unknown>) => parseTask(t));

      const taskUpdates: TaskUpdate[] = (parsed.taskUpdates || []).map((u: Record<string, unknown>) => {
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

      const newBlocks = (parsed.newBlocks || []).map((b: Record<string, unknown>) => ({
        name: b.name as string,
        dayOfWeek: Math.min(6, Math.max(0, b.dayOfWeek as number)),
        startHour: b.startHour as number,
        startMinute: (b.startMinute as number) || 0,
        endHour: b.endHour as number,
        endMinute: (b.endMinute as number) || 0,
        userCreated: false,
        color: null,
      }));

      let preferenceUpdates: Partial<SchedulingPreferences> | null = null;
      if (parsed.preferenceUpdates) {
        const p = parsed.preferenceUpdates;
        preferenceUpdates = {};
        if (p.earliestHour !== undefined) preferenceUpdates.earliestHour = Math.max(0, Math.min(23, p.earliestHour));
        if (p.latestHour !== undefined) preferenceUpdates.latestHour = Math.max(1, Math.min(24, p.latestHour));
        if (p.minBlockMinutes !== undefined) preferenceUpdates.minBlockMinutes = Math.max(10, Math.min(180, p.minBlockMinutes));
        if (p.preferMornings !== undefined) preferenceUpdates.preferMornings = !!p.preferMornings;
        if (p.preferEvenings !== undefined) preferenceUpdates.preferEvenings = !!p.preferEvenings;
        if (p.avoidWeekends !== undefined) preferenceUpdates.avoidWeekends = !!p.avoidWeekends;
        if (p.addRule) {
          preferenceUpdates.customRules = [...currentPrefs.customRules, p.addRule];
        }
        if (p.removeRuleIndex !== undefined && p.removeRuleIndex >= 0 && p.removeRuleIndex < currentPrefs.customRules.length) {
          const rules = preferenceUpdates.customRules || [...currentPrefs.customRules];
          rules.splice(p.removeRuleIndex, 1);
          preferenceUpdates.customRules = rules;
        }
        if (Object.keys(preferenceUpdates).length === 0) preferenceUpdates = null;
      }

      let followUpQuestion: FollowUpQuestion | null = null;
      if (parsed.followUpQuestion?.question && Array.isArray(parsed.followUpQuestion.options) && parsed.followUpQuestion.options.length > 0) {
        followUpQuestion = {
          question: parsed.followUpQuestion.question,
          options: parsed.followUpQuestion.options.slice(0, 4).map((o: unknown) => String(o)),
        };
      }

      const sessionName: string | null = typeof parsed.sessionName === 'string' && parsed.sessionName.trim()
        ? parsed.sessionName.trim().slice(0, 50)
        : null;

      return {
        message: parsed.message || 'Processed.',
        newTasks,
        taskUpdates,
        newBlocks,
        preferenceUpdates,
        followUpQuestion,
        sessionName,
      };
    }
  } catch (parseErr) {
    console.error('[claude] JSON parse failed:', parseErr, '\nRaw text:', text);
  }

  return { message: text, newTasks: [], taskUpdates: [], newBlocks: [], preferenceUpdates: null, followUpQuestion: null, sessionName: null };
}
