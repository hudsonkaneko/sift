import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

// GET /api/fixed-blocks — fetch fixed blocks for the user
// Optional ?weekOf=YYYY-MM-DD to include date-specific blocks for that week
export async function GET(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { searchParams } = new URL(req.url);
  const weekOf = searchParams.get('weekOf');

  const supabase = createServiceClient();

  let query = supabase
    .from('fixed_blocks')
    .select('*')
    .eq('user_id', userId);

  if (weekOf) {
    // Return recurring blocks + date-specific blocks for this week (Sun-Sat)
    const weekStart = new Date(weekOf + 'T12:00:00Z');
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    console.log(`[fixed-blocks GET] weekOf=${weekOf}, range=${weekStartStr} to ${weekEndStr}`);

    query = query.or(`specific_date.is.null,and(specific_date.gte.${weekStartStr},specific_date.lte.${weekEndStr})`);
  } else {
    console.log('[fixed-blocks GET] no weekOf — returning recurring only');
    // Backward compatible: only return blocks without a specific date
    query = query.is('specific_date', null);
  }

  const { data, error } = await query
    .order('day_of_week', { ascending: true })
    .order('start_hour', { ascending: true });

  if (error) {
    console.error('[fixed-blocks GET] query error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const googleBlocks = (data || []).filter((b: { google_event_id: string | null }) => b.google_event_id);
  const userBlocks = (data || []).filter((b: { user_created: boolean }) => b.user_created);
  console.log(`[fixed-blocks GET] returning ${data?.length ?? 0} blocks (${googleBlocks.length} google, ${userBlocks.length} user-created)`);

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
