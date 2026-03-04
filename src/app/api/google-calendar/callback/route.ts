import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // userId
  const error = url.searchParams.get('error');

  console.log('[gcal/callback] params:', { hasCode: !!code, state, error });

  const h = await headers();
  const proto = h.get('x-forwarded-proto') || 'https';
  const host = h.get('host') || '';
  const origin = `${proto}://${host}`;

  console.log('[gcal/callback] origin:', origin);

  if (error || !code || !state) {
    console.log('[gcal/callback] BAIL: missing code/state or error present');
    return NextResponse.redirect(`${origin}/dashboard?gcal=error`);
  }

  const redirectUri = `${origin}/api/google-calendar/callback`;
  console.log('[gcal/callback] redirectUri for token exchange:', redirectUri);

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
    const errBody = await tokenRes.text();
    console.log('[gcal/callback] TOKEN EXCHANGE FAILED:', tokenRes.status, errBody);
    return NextResponse.redirect(`${origin}/dashboard?gcal=error`);
  }

  const tokens = await tokenRes.json();
  console.log('[gcal/callback] token exchange OK, has refresh_token:', !!tokens.refresh_token);

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
    console.log('[gcal/callback] DB UPSERT FAILED:', dbError.message);
    return NextResponse.redirect(`${origin}/dashboard?gcal=error`);
  }

  console.log('[gcal/callback] SUCCESS — redirecting to /dashboard?gcal=connected');
  return NextResponse.redirect(`${origin}/dashboard?gcal=connected`);
}
