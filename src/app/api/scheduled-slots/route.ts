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

  // Compute date range from weekOf (Sunday through Saturday)
  const startDate = weekOf;
  const endDate = (() => {
    const d = new Date(weekOf + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().split('T')[0];
  })();

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('scheduled_slots')
    .select('*, tasks(*)')
    .eq('user_id', userId)
    .gte('scheduled_date', startDate)
    .lte('scheduled_date', endDate)
    .order('scheduled_date', { ascending: true })
    .order('start_hour', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
