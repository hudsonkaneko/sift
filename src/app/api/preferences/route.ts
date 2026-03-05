import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/utils/auth';
import { createServiceClient } from '@/lib/supabase/server';
import type { ColorPaletteConfig } from '@/lib/types/domain';

// GET /api/preferences — get scheduling preferences (creates default if missing)
export async function GET() {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('scheduling_preferences')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code === 'PGRST116') {
    // No row found — create defaults
    const { data: newPrefs, error: insertError } = await supabase
      .from('scheduling_preferences')
      .insert({
        user_id: userId,
        earliest_hour: 9,
        latest_hour: 23,
        min_block_minutes: 30,
        prefer_mornings: true,
        prefer_evenings: true,
        avoid_weekends: false,
        custom_rules: [],
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
    return NextResponse.json(newPrefs);
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

// PATCH /api/preferences — update scheduling preferences
export async function PATCH(req: Request) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const body = await req.json();
  const supabase = createServiceClient();

  const updates: Record<string, unknown> = {};
  if (body.earliestHour !== undefined) updates.earliest_hour = body.earliestHour;
  if (body.latestHour !== undefined) updates.latest_hour = body.latestHour;
  if (body.minBlockMinutes !== undefined) updates.min_block_minutes = body.minBlockMinutes;
  if (body.preferMornings !== undefined) updates.prefer_mornings = body.preferMornings;
  if (body.preferEvenings !== undefined) updates.prefer_evenings = body.preferEvenings;
  if (body.avoidWeekends !== undefined) updates.avoid_weekends = body.avoidWeekends;
  if (body.customRules !== undefined) updates.custom_rules = body.customRules;
  if (body.colorPalette !== undefined) {
    if (body.colorPalette === null) {
      updates.color_palette = null;
    } else {
      const cp = body.colorPalette as ColorPaletteConfig;
      if (!cp.activeThemeId || !Array.isArray(cp.themes) || cp.themes.length === 0) {
        return NextResponse.json({ error: 'Invalid colorPalette: must have activeThemeId and at least 1 theme' }, { status: 400 });
      }
      for (const theme of cp.themes) {
        if (!theme.id || !theme.name || !Array.isArray(theme.colors) || theme.colors.length === 0) {
          return NextResponse.json({ error: 'Invalid theme: must have id, name, and at least 1 color' }, { status: 400 });
        }
      }
      if (!cp.themes.some(t => t.id === cp.activeThemeId)) {
        return NextResponse.json({ error: 'activeThemeId must reference an existing theme' }, { status: 400 });
      }
      updates.color_palette = body.colorPalette;
    }
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('scheduling_preferences')
    .update(updates)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
