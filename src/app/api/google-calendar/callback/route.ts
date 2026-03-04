import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // userId
  const error = url.searchParams.get('error');

  if (error || !code || !state) {
    return NextResponse.redirect(`${url.origin}/dashboard?gcal=error`);
  }

  const redirectUri = `${url.origin}/api/google-calendar/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(`${url.origin}/dashboard?gcal=error`);
  }

  const tokens = await tokenRes.json();

  const supabase = createServiceClient();
  const { error: dbError } = await supabase
    .from('google_calendar_tokens')
    .upsert({
      user_id: state,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      calendar_id: 'primary',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (dbError) {
    return NextResponse.redirect(`${url.origin}/dashboard?gcal=error`);
  }

  return NextResponse.redirect(`${url.origin}/dashboard?gcal=connected`);
}
