import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';

// GET /api/scheduled-slots?weekOf=YYYY-MM-DD — fetch slots with joined task data
export async function GET(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const { searchParams } = new URL(req.url);
  const weekOf = searchParams.get('weekOf');
  if (!weekOf) {
    return NextResponse.json({ error: 'weekOf query parameter required' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('scheduled_slots')
    .select('*, tasks(*)')
    .eq('user_id', userId)
    .eq('week_of', weekOf)
    .order('day_of_week', { ascending: true })
    .order('start_hour', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
