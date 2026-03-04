import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireAuth } from '@/lib/utils/auth';

export async function GET(req: NextRequest) {
  const [userId, errorResponse] = await requireAuth();
  if (!userId) return errorResponse!;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'Google Calendar not configured' }, { status: 500 });
  }

  const h = await headers();
  const proto = h.get('x-forwarded-proto') || 'https';
  const host = h.get('host') || '';
  const origin = `${proto}://${host}`;
  const redirectUri = `${origin}/api/google-calendar/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/calendar.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state: userId,
  });

  // Support login_hint for re-auth of a specific account
  const email = req.nextUrl.searchParams.get('email');
  if (email) {
    params.set('login_hint', email);
  }

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
