import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

// GET /api/fixed-blocks — fetch all fixed blocks for the user
export async function GET() {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('fixed_blocks')
    .select('*')
    .eq('user_id', userId)
    .order('day_of_week', { ascending: true })
    .order('start_hour', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// POST /api/fixed-blocks — create a new fixed block
export async function POST(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const body = await req.json();
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('fixed_blocks')
    .insert({
      user_id: userId,
      name: body.name,
      day_of_week: body.dayOfWeek,
      start_hour: body.startHour,
      start_minute: body.startMinute || 0,
      end_hour: body.endHour,
      end_minute: body.endMinute || 0,
      user_created: body.userCreated ?? true,
      color: body.color || null,
      recurring: body.recurring ?? false,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
