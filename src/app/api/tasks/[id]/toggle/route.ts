import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

// POST /api/tasks/[id]/toggle — toggle complete with cascading logic
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { id } = await params;
  const { completed } = await req.json();
  const supabase = createServiceClient();

  // Update the task itself
  const { data: task, error } = await supabase
    .from('tasks')
    .update({ completed, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !task) {
    return NextResponse.json({ error: error?.message || 'Task not found' }, { status: 500 });
  }

  // If completing a parent task, complete all subtasks
  if (completed) {
    const { data: subtasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('parent_id', id)
      .eq('user_id', userId);

    if (subtasks && subtasks.length > 0) {
      await supabase
        .from('tasks')
        .update({ completed: true, updated_at: new Date().toISOString() })
        .in('id', subtasks.map(s => s.id))
        .eq('user_id', userId);
    }
  }

  // Lock/unlock associated scheduled slots so completed tasks stay visible
  // but their time becomes available for other tasks during generation
  const allTaskIds = [id];
  if (completed) {
    const { data: subtasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('parent_id', id)
      .eq('user_id', userId);
    if (subtasks) allTaskIds.push(...subtasks.map(s => s.id));
  }
  await supabase
    .from('scheduled_slots')
    .update({ locked: completed })
    .in('task_id', allTaskIds)
    .eq('user_id', userId);

  // If this is a subtask, handle parent cascading
  if (task.parent_id) {
    if (completed) {
      // Check if all siblings are done → auto-complete parent
      const { data: siblings } = await supabase
        .from('tasks')
        .select('id, completed')
        .eq('parent_id', task.parent_id)
        .eq('user_id', userId);

      const allDone = siblings?.every(s => s.completed) ?? false;
      if (allDone) {
        await supabase
          .from('tasks')
          .update({ completed: true, updated_at: new Date().toISOString() })
          .eq('id', task.parent_id)
          .eq('user_id', userId);
      }
    } else {
      // Un-completing a subtask → un-complete the parent
      await supabase
        .from('tasks')
        .update({ completed: false, updated_at: new Date().toISOString() })
        .eq('id', task.parent_id)
        .eq('user_id', userId);
    }
  }

  return NextResponse.json({ success: true });
}
