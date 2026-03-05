/**
 * Task Decomposition Engine — breaks large tasks into smaller subtasks.
 *
 * Can be called standalone (from UI or API) or as part of the chat pipeline.
 * Uses Claude to generate structured subtask breakdowns.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface DecompositionInput {
  name: string;
  deadline?: string | null;
  estimatedMinutes?: number;
  category?: string;
  context?: string; // additional user context
}

export interface DecomposedSubtask {
  name: string;
  estimatedMinutes: number;
  order: number;
}

export interface DecompositionResult {
  parentName: string;
  subtasks: DecomposedSubtask[];
  totalMinutes: number;
  shouldDecompose: boolean;
  reasoning: string;
}

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const DECOMPOSITION_PROMPT = `You are a task decomposition expert helping people with ADHD break large tasks into small, actionable steps.

Given a task, decide whether it should be decomposed into subtasks.

RULES:
- Decompose if: the task is >= 90 minutes, OR has multiple implied steps, OR is vague/overwhelming
- Do NOT decompose: simple, single-action tasks (e.g., "reply to email", "take out trash")
- Each subtask should be 15-120 minutes
- Subtasks should be concrete and actionable (start with a verb)
- Order subtasks logically (dependencies first)
- Time estimates should be realistic for someone with ADHD (slightly generous)
- Keep subtask count between 2-6

Respond with ONLY a JSON object:
{
  "shouldDecompose": true/false,
  "reasoning": "Brief explanation of why/why not",
  "subtasks": [
    {"name": "Verb-starting action", "estimatedMinutes": 30, "order": 1}
  ]
}

If shouldDecompose is false, return an empty subtasks array.`;

/**
 * Check if a task should be decomposed based on heuristics
 * (avoids an API call for obviously simple tasks).
 */
export function shouldDecompose(input: DecompositionInput): boolean {
  // Long tasks should be decomposed
  if (input.estimatedMinutes && input.estimatedMinutes >= 90) return true;

  // Tasks with multiple implied steps (keywords)
  const name = input.name.toLowerCase();
  const multiStepKeywords = [
    'paper', 'essay', 'project', 'presentation', 'report', 'thesis',
    'assignment', 'application', 'proposal', 'portfolio', 'study for',
    'prepare for', 'plan', 'organize', 'move', 'clean',
    'launch', 'build', 'develop', 'implement', 'redesign',
  ];
  if (multiStepKeywords.some(k => name.includes(k))) return true;

  // Tasks with "and" suggesting multiple actions
  if (/\band\b/.test(name) && name.length > 30) return true;

  return false;
}

/**
 * Decompose a task into subtasks using Claude.
 */
export async function decomposeTask(input: DecompositionInput): Promise<DecompositionResult> {
  // Quick heuristic check
  if (!shouldDecompose(input)) {
    return {
      parentName: input.name,
      subtasks: [],
      totalMinutes: input.estimatedMinutes || 0,
      shouldDecompose: false,
      reasoning: 'Task appears simple enough to complete in one sitting.',
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[PLANNING] No API key — skipping AI decomposition');
    return {
      parentName: input.name,
      subtasks: [],
      totalMinutes: input.estimatedMinutes || 0,
      shouldDecompose: false,
      reasoning: 'API key not available for decomposition.',
    };
  }

  const client = new Anthropic({ apiKey });

  const taskDescription = [
    `Task: "${input.name}"`,
    input.deadline ? `Deadline: ${input.deadline}` : null,
    input.estimatedMinutes ? `Estimated time: ${input.estimatedMinutes} minutes` : null,
    input.category ? `Category: ${input.category}` : null,
    input.context ? `Additional context: ${input.context}` : null,
  ].filter(Boolean).join('\n');

  console.log('[PLANNING] Decomposing task:', input.name);

  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: DECOMPOSITION_PROMPT,
      messages: [{ role: 'user', content: taskDescription }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[PLANNING] No JSON in decomposition response');
      return {
        parentName: input.name,
        subtasks: [],
        totalMinutes: input.estimatedMinutes || 0,
        shouldDecompose: false,
        reasoning: 'Failed to parse decomposition response.',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.shouldDecompose || !Array.isArray(parsed.subtasks) || parsed.subtasks.length === 0) {
      return {
        parentName: input.name,
        subtasks: [],
        totalMinutes: input.estimatedMinutes || 0,
        shouldDecompose: false,
        reasoning: parsed.reasoning || 'AI determined task does not need decomposition.',
      };
    }

    const subtasks: DecomposedSubtask[] = parsed.subtasks
      .filter((s: Record<string, unknown>) => typeof s.name === 'string')
      .map((s: Record<string, unknown>, i: number) => ({
        name: s.name as string,
        estimatedMinutes: Math.max(15, Math.min(120, Math.round((s.estimatedMinutes as number) || 30))),
        order: (s.order as number) || i + 1,
      }))
      .sort((a: DecomposedSubtask, b: DecomposedSubtask) => a.order - b.order);

    const totalMinutes = subtasks.reduce((sum: number, s: DecomposedSubtask) => sum + s.estimatedMinutes, 0);

    console.log('[PLANNING] Decomposed into', subtasks.length, 'subtasks, total:', totalMinutes, 'min');

    return {
      parentName: input.name,
      subtasks,
      totalMinutes,
      shouldDecompose: true,
      reasoning: parsed.reasoning || 'Task broken into smaller steps.',
    };
  } catch (err) {
    console.error('[PLANNING] Decomposition failed:', err);
    return {
      parentName: input.name,
      subtasks: [],
      totalMinutes: input.estimatedMinutes || 0,
      shouldDecompose: false,
      reasoning: 'Decomposition service temporarily unavailable.',
    };
  }
}
