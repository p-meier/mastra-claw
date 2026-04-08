import { type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/proxy';

/**
 * Next.js 16 proxy (the renamed-and-evolved successor of `middleware.ts`).
 * Both filenames are still recognised by Next 16 — we deliberately use the
 * new `proxy.ts` convention to align with the current Supabase docs.
 *
 * This file does ONE thing: hand the request to `updateSession`, which
 * refreshes the Supabase session cookie and gates unauthenticated access to
 * non-public routes. All routing logic lives in the helper.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip Next.js internals and static assets. Everything else passes through
  // updateSession() so the cookie refresh happens for every page render and
  // every API request.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
