import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { processChatMessage } from '@/lib/ai/claude';
import { preprocessBraindump, buildEnhancedMessage } from '@/lib/ai/preprocessor';
import { mapTask, mapPreferences } from '@/lib/utils/db';
import type { ChatMessage, UserTone } from '@/lib/types/domain';

// POST /api/chat — send a message and get AI response
export async function POST(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { message, sessionId } = await req.json();
  if (!message || !sessionId) {
    return NextResponse.json({ error: 'Missing message or sessionId' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Fetch chat history for this session
  const { data: historyRows } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  const chatHistory: ChatMessage[] = (historyRows || []).map(r => ({
    id: r.id,
    sessionId: r.session_id,
    userId: r.user_id,
    role: r.role,
    content: r.content,
    metadata: r.metadata || {},
    createdAt: r.created_at,
  }));

  // Save user message
  await supabase.from('chat_messages').insert({
    session_id: sessionId,
    user_id: userId,
    role: 'user',
    content: message,
    metadata: {},
  });

  try {
    // Fetch context
    const { data: taskRows } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId);
    const existingTasks = (taskRows || []).map(mapTask);

    const { data: prefsRow } = await supabase
      .from('scheduling_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();
    const currentPrefs = prefsRow ? mapPreferences(prefsRow) : {
      id: '', userId, earliestHour: 9, latestHour: 23, minBlockMinutes: 30,
      preferMornings: true, preferEvenings: true, avoidWeekends: false,
      customRules: [], createdAt: '', updatedAt: '',
    };

    // Get user tone
    const { data: userRow } = await supabase
      .from('users')
      .select('tone')
      .eq('id', userId)
      .single();
    const tone: UserTone = userRow?.tone || 'friendly';

    // Preprocess
    const preprocessed = preprocessBraindump(message);
    const enhancedMessage = buildEnhancedMessage(message, preprocessed);

    // Call AI
    const result = await processChatMessage(enhancedMessage, existingTasks, currentPrefs, chatHistory, tone);

    const actions: string[] = [];
    console.log('[chat] AI result:', { newTasks: result.newTasks.length, taskUpdates: result.taskUpdates.length, newBlocks: result.newBlocks.length });

    // 1. Add new tasks (with subtask support)
    let tasksAdded = 0;
    let subtasksAdded = 0;
    for (const taskData of result.newTasks) {
      const { data: parentRow, error: parentErr } = await supabase.from('tasks').insert({
        user_id: userId,
        name: taskData.name,
        category: taskData.category,
        estimated_minutes: taskData.estimatedMinutes,
        deadline: taskData.deadline,
        recurrence: taskData.recurrence,
        completed: false,
        color: taskData.color ?? null,
        parent_id: taskData.parentId ?? null,
        urgency: taskData.urgency ?? 0,
      }).select('id').single();

      if (parentErr) {
        console.error('[chat] Task insert failed:', parentErr.message, taskData);
        continue;
      }
      tasksAdded++;

      if (parentRow && taskData.subtasks && taskData.subtasks.length > 0) {
        for (const sub of taskData.subtasks) {
          const { error: subErr } = await supabase.from('tasks').insert({
            user_id: userId,
            name: sub.name,
            category: sub.category,
            estimated_minutes: sub.estimatedMinutes,
            deadline: sub.deadline,
            recurrence: sub.recurrence,
            completed: false,
            color: sub.color ?? null,
            parent_id: parentRow.id,
            urgency: sub.urgency ?? 0,
          });
          if (subErr) {
            console.error('[chat] Subtask insert failed:', subErr.message, sub);
            continue;
          }
          subtasksAdded++;
        }
      }
    }
    if (tasksAdded > 0) {
      const subtaskNote = subtasksAdded > 0 ? ` with ${subtasksAdded} subtask(s)` : '';
      actions.push(`Added ${tasksAdded} task(s)${subtaskNote}`);
    }

    // 2. Apply task updates
    let tasksUpdated = 0;
    for (const tu of result.taskUpdates) {
      const match = existingTasks.find(t =>
        t.name.toLowerCase() === tu.taskName.toLowerCase()
      ) || existingTasks.find(t =>
        t.name.toLowerCase().includes(tu.taskName.toLowerCase()) ||
        tu.taskName.toLowerCase().includes(t.name.toLowerCase())
      );
      if (match) {
        const updates: Record<string, unknown> = {};
        if (tu.updates.name !== undefined) updates.name = tu.updates.name;
        if (tu.updates.category !== undefined) updates.category = tu.updates.category;
        if (tu.updates.estimatedMinutes !== undefined) updates.estimated_minutes = tu.updates.estimatedMinutes;
        if (tu.updates.deadline !== undefined) updates.deadline = tu.updates.deadline;
        if (tu.updates.recurrence !== undefined) updates.recurrence = tu.updates.recurrence;
        if (tu.updates.completed !== undefined) updates.completed = tu.updates.completed;
        updates.updated_at = new Date().toISOString();
        await supabase.from('tasks').update(updates).eq('id', match.id).eq('user_id', userId);
        tasksUpdated++;
      }
    }
    if (tasksUpdated > 0) actions.push(`Updated ${tasksUpdated} task(s)`);

    // 3. Add fixed blocks
    for (const block of result.newBlocks) {
      await supabase.from('fixed_blocks').insert({
        user_id: userId,
        name: block.name,
        day_of_week: block.dayOfWeek,
        start_hour: block.startHour,
        start_minute: block.startMinute,
        end_hour: block.endHour,
        end_minute: block.endMinute,
        user_created: false,
        color: null,
      });
    }
    if (result.newBlocks.length > 0) actions.push(`Added ${result.newBlocks.length} fixed block(s)`);

    // 4. Apply preference updates
    if (result.preferenceUpdates) {
      const prefUpdates: Record<string, unknown> = {};
      const pu = result.preferenceUpdates;
      if (pu.earliestHour !== undefined) prefUpdates.earliest_hour = pu.earliestHour;
      if (pu.latestHour !== undefined) prefUpdates.latest_hour = pu.latestHour;
      if (pu.minBlockMinutes !== undefined) prefUpdates.min_block_minutes = pu.minBlockMinutes;
      if (pu.preferMornings !== undefined) prefUpdates.prefer_mornings = pu.preferMornings;
      if (pu.preferEvenings !== undefined) prefUpdates.prefer_evenings = pu.preferEvenings;
      if (pu.avoidWeekends !== undefined) prefUpdates.avoid_weekends = pu.avoidWeekends;
      if (pu.customRules !== undefined) prefUpdates.custom_rules = pu.customRules;
      prefUpdates.updated_at = new Date().toISOString();
      await supabase.from('scheduling_preferences').update(prefUpdates).eq('user_id', userId);
      actions.push('Updated scheduling preferences');
    }

    // Build response
    let responseText = result.message;
    if (actions.length > 0) {
      responseText += `\n\n${actions.join(' · ')}.${result.newTasks.length > 0 ? ' Use "Generate Schedule" to slot them in.' : ''}`;
    }

    // Save assistant message with metadata
    const metadata: Record<string, unknown> = {};
    if (result.followUpQuestion) metadata.followUpQuestion = result.followUpQuestion;

    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      user_id: userId,
      role: 'assistant',
      content: responseText,
      metadata,
    });

    return NextResponse.json({
      message: responseText,
      followUpQuestion: result.followUpQuestion,
      tasksAdded: tasksAdded + subtasksAdded,
      blocksAdded: result.newBlocks.length,
    });
  } catch (error: unknown) {
    const errMsg = `Error: ${error instanceof Error ? error.message : 'Failed to process message'}`;
    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      user_id: userId,
      role: 'assistant',
      content: errMsg,
      metadata: {},
    });
    return NextResponse.json({ message: errMsg, tasksAdded: 0, blocksAdded: 0 }, { status: 500 });
  }
}
