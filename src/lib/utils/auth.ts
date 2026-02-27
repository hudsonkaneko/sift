import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

/**
 * Get the authenticated user ID or return a 401 response.
 * Use in API routes: `const [userId, errorResponse] = await requireAuth();`
 *
 * When `userId` is null, `errorResponse` is always a NextResponse (non-null assertion is safe).
 */
export async function requireAuth(): Promise<[string, null] | [null, NextResponse]> {
  const { userId } = await auth();
  if (!userId) {
    return [null, NextResponse.json({ error: 'Unauthorized' }, { status: 401 })];
  }
  return [userId, null];
}

/**
 * Helper that throws if not authenticated, returning just the userId.
 * Callers must catch and return a 401 response.
 */
export async function getAuthUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new AuthError();
  return userId;
}

export class AuthError extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'AuthError';
  }

  toResponse(): NextResponse {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
