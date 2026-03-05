import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { processChatMessage } from '@/lib/ai/claude';
import type { ProjectContext } from '@/lib/ai/claude';
import { preprocessBraindump, buildEnhancedMessage } from '@/lib/ai/preprocessor';
import { mapTask, mapPreferences, normalizeColorPalette } from '@/lib/utils/db';
import { randomColor } from '@/lib/utils/format';
import { shouldDecompose, decomposeTask } from '@/lib/planning/task-decomposer';
import type { ChatMessage, UserTone } from '@/lib/types/domain';

// POST /api/chat — send a message and get AI response
export async function POST(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { message, sessionId } = await req.json();
  if (!message || !sessionId) {
    return NextResponse.json({ error: 'Missing message or sessionId' }, { status: 400 });
  }

  console.log('[CHAT] Incoming message:', message.slice(0, 200), sessionId);

  const supabase = createServiceClient();

  // Check if this is a project-scoped session
  let projectContext: ProjectContext | undefined;
  const { data: sessionRow } = await supabase
    .from('chat_sessions')
    .select('task_id, name')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single();

  if (sessionRow?.task_id) {
    const taskId = sessionRow.task_id;

    // Fetch parent task
    const { data: parentRow } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (parentRow) {
      // Fetch subtasks
      const { data: subtaskRows } = await supabase
        .from('tasks')
        .select('*')
        .eq('parent_id', taskId);

      // Fetch cross-session memory (messages from OTHER sessions in same project)
      const { data: otherSessions } = await supabase
        .from('chat_sessions')
        .select('id')
        .eq('task_id', taskId)
        .eq('user_id', userId)
        .neq('id', sessionId);

      let memoryMessages: ChatMessage[] = [];
      if (otherSessions && otherSessions.length > 0) {
        const otherSessionIds = otherSessions.map(s => s.id);
        const { data: memoryRows } = await supabase
          .from('chat_messages')
          .select('*')
          .in('session_id', otherSessionIds)
          .eq('user_id', userId)
          .order('created_at', { ascending: true });

        memoryMessages = (memoryRows || []).map(r => ({
          id: r.id,
          sessionId: r.session_id,
          userId: r.user_id,
          role: r.role,
          content: r.content,
          metadata: r.metadata || {},
          createdAt: r.created_at,
        }));
      }

      projectContext = {
        task: mapTask(parentRow),
        subtasks: (subtaskRows || []).map(mapTask),
        memory: memoryMessages,
      };
    }
  }

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
      customRules: [], colorPalette: null, createdAt: '', updatedAt: '',
    };
    const userPalette = normalizeColorPalette(prefsRow?.color_palette ?? null);

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
    if (preprocessed.wasModified) {
      console.log('[CHAT] Preprocessed:', { cleaned: preprocessed.cleaned.slice(0, 200), dates: preprocessed.dates.length });
    }

    // Call AI
    console.log('[CHAT] Calling Claude with', existingTasks.length, 'existing tasks, tone:', tone, projectContext ? 'project-scoped' : 'general');
    const result = await processChatMessage(enhancedMessage, existingTasks, currentPrefs, chatHistory, tone, projectContext);

    const actions: string[] = [];
    console.log('[CHAT] AI result:', { newTasks: result.newTasks.length, taskUpdates: result.taskUpdates.length, newBlocks: result.newBlocks.length, hasPrefs: !!result.preferenceUpdates });

    // 1. Add new tasks (with subtask support)
    let tasksAdded = 0;
    let subtasksAdded = 0;
    for (const taskData of result.newTasks) {
      const parentColor = taskData.color ?? (taskData.parentId ? null : randomColor(userPalette));
      const { data: parentRow, error: parentErr } = await supabase.from('tasks').insert({
        user_id: userId,
        name: taskData.name,
        category: taskData.category,
        estimated_minutes: taskData.estimatedMinutes,
        deadline: taskData.deadline,
        recurrence: taskData.recurrence,
        completed: false,
        color: parentColor,
        parent_id: taskData.parentId ?? null,
        urgency: taskData.urgency ?? 0,
      }).select('id, color').single();

      if (parentErr) {
        console.error('[CHAT] Task insert failed:', parentErr.message, taskData);
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
            color: sub.color ?? parentRow.color ?? null,
            parent_id: parentRow.id,
            urgency: sub.urgency ?? 0,
          });
          if (subErr) {
            console.error('[CHAT] Subtask insert failed:', subErr.message, sub);
            continue;
          }
          subtasksAdded++;
        }
      }
    }
    // 1b. Auto-decompose large tasks that Claude didn't split
    for (const taskData of result.newTasks) {
      if (taskData.subtasks && taskData.subtasks.length > 0) continue; // already split
      if (!shouldDecompose({ name: taskData.name, estimatedMinutes: taskData.estimatedMinutes, deadline: taskData.deadline })) continue;

      // Find the parent row we just inserted
      const { data: parentRows } = await supabase
        .from('tasks')
        .select('id, color')
        .eq('user_id', userId)
        .eq('name', taskData.name)
        .order('created_at', { ascending: false })
        .limit(1);

      const parentRow = parentRows?.[0];
      if (!parentRow) continue;

      console.log('[CHAT] Auto-decomposing task:', taskData.name);
      const decomposition = await decomposeTask({
        name: taskData.name,
        deadline: taskData.deadline,
        estimatedMinutes: taskData.estimatedMinutes,
        category: taskData.category,
      });

      if (decomposition.shouldDecompose && decomposition.subtasks.length > 0) {
        // Update parent to be a shell (0 minutes)
        await supabase.from('tasks').update({ estimated_minutes: 0 }).eq('id', parentRow.id);

        for (const sub of decomposition.subtasks) {
          const { error: subErr } = await supabase.from('tasks').insert({
            user_id: userId,
            name: sub.name,
            category: taskData.category,
            estimated_minutes: sub.estimatedMinutes,
            deadline: taskData.deadline,
            recurrence: taskData.recurrence,
            completed: false,
            color: parentRow.color,
            parent_id: parentRow.id,
            urgency: taskData.urgency ?? 0,
          });
          if (!subErr) subtasksAdded++;
        }
        console.log('[CHAT] Auto-decomposed into', decomposition.subtasks.length, 'subtasks');
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

    // Auto-rename session if it's still "New Chat"
    if (result.sessionName && sessionRow?.name === 'New Chat') {
      await supabase
        .from('chat_sessions')
        .update({ name: result.sessionName, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('user_id', userId);
    }

    return NextResponse.json({
      message: responseText,
      followUpQuestion: result.followUpQuestion,
      tasksAdded: tasksAdded + subtasksAdded,
      blocksAdded: result.newBlocks.length,
      sessionName: result.sessionName,
    });
  } catch (error: unknown) {
    console.error('[CHAT] Pipeline error:', error instanceof Error ? error.message : error);
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
