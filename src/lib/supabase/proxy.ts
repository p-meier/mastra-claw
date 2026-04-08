import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Session-refresh helper used by the project-root `proxy.ts` (the Next.js
 * 16 successor of `middleware.ts`).
 *
 * Responsibilities, in this exact order:
 *   1. Build a request-scoped Supabase server client wired to the incoming
 *      cookies.
 *   2. Call `supabase.auth.getClaims()` to validate the JWT signature and
 *      refresh the session if needed. This is the ONLY method safe to use
 *      in proxy/middleware code — `getSession()` does not validate the JWT
 *      and `getUser()` makes a network round-trip per request.
 *   3. If unauthenticated and the path is not in the allow-list, redirect
 *      to /login.
 *   4. Return the (possibly cookie-updated) NextResponse so the browser
 *      receives any rotated tokens.
 *
 * The cookie-handling pattern below is the only correct one — see the
 * IMPORTANT block at the end of the function. Source:
 *   https://supabase.com/docs/guides/auth/server-side/creating-a-client
 *
 * Phase 1 only gates by *authentication*. Role-based gating (admin) lives
 * in individual page Server Components via `getCurrentUser()` so that the
 * proxy stays simple and the role check happens close to the data access.
 */

// Paths that must be reachable without an active session.
const PUBLIC_PATHS = [
  '/login',
  '/auth', // /auth/confirm, /auth/callback, /auth/auth-code-error, ...
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // CRITICAL: do not insert any code between createServerClient and
  // getClaims(). A simple mistake here can cause users to be randomly
  // logged out, and it's very hard to debug.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Preserve the originally requested path so we can redirect back after
    // a successful login.
    url.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // IMPORTANT: We *must* return supabaseResponse as-is. Constructing a new
  // NextResponse here would drop the rotated cookies and the user would
  // get logged out on the next request.
  return supabaseResponse;
}
