import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Session-refresh + onboarding gate used by the project-root `proxy.ts`
 * (the Next.js 16 successor of `middleware.ts`).
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
 *   4. Resolve the three-state onboarding gate (admin app setup → personal
 *      onboarding → fully done) and redirect accordingly.
 *   5. Return the (possibly cookie-updated) NextResponse so the browser
 *      receives any rotated tokens.
 *
 * The cookie-handling pattern below is the only correct one — see the
 * IMPORTANT block at the end of the function. Source:
 *   https://supabase.com/docs/guides/auth/server-side/creating-a-client
 *
 * Onboarding gate states:
 *
 *   A. App setup not done
 *      → admin: redirect to /admin/setup
 *      → user:  redirect to /not-configured (blocking screen)
 *   B. App setup done, this user's personal onboarding not resolved
 *      (neither completed nor explicitly skipped)
 *      → redirect to /onboarding
 *   C. Both done → normal navigation
 *
 *   Inverse: completed users hitting /admin/setup or /onboarding bounce
 *   back to /.
 */

// Paths that must be reachable without an active session.
const PUBLIC_PATHS = [
  '/login',
  '/auth', // /auth/confirm, /auth/callback, /auth/auth-code-error, ...
  '/not-configured',
];

// Paths that bypass the onboarding gate entirely (assets, auth flows,
// the wizards themselves, the bootstrap chat API).
const GATE_BYPASS_PREFIXES = [
  '/_next',
  '/api/auth',
  '/admin/setup',
  '/onboarding',
  '/api/onboarding',
  '/not-configured',
  '/favicon',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function bypassesGate(pathname: string): boolean {
  return GATE_BYPASS_PREFIXES.some((p) => pathname.startsWith(p));
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

  const pathname = request.nextUrl.pathname;

  if (!claims && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Preserve the originally requested path so we can redirect back after
    // a successful login.
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // ----------------------------------------------------------------
  // Onboarding gate
  // ----------------------------------------------------------------
  //
  // Only runs for authenticated requests that don't already target a
  // wizard / setup / public asset path. The gate query is one small
  // indexed lookup; it's fine to run on every navigation.
  if (claims && !bypassesGate(pathname) && !isPublicPath(pathname)) {
    const role =
      ((claims.app_metadata as { role?: string } | undefined)?.role ===
      'admin'
        ? 'admin'
        : 'user') as 'admin' | 'user';
    const userId = claims.sub;

    const [{ data: appSetting }, { data: profile }] = await Promise.all([
      supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'app.setup_completed_at')
        .maybeSingle(),
      supabase
        .from('user_profiles')
        .select('onboarding_completed_at, onboarding_skipped_at')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    const appSetupCompleted =
      appSetting?.value !== null && appSetting?.value !== undefined;
    const userOnboardingResolved = Boolean(
      profile?.onboarding_completed_at ?? profile?.onboarding_skipped_at,
    );

    if (!appSetupCompleted) {
      const url = request.nextUrl.clone();
      url.pathname = role === 'admin' ? '/admin/setup' : '/not-configured';
      return NextResponse.redirect(url);
    }

    if (!userOnboardingResolved) {
      const url = request.nextUrl.clone();
      url.pathname = '/onboarding';
      return NextResponse.redirect(url);
    }
  }

  // Inverse: completed users hitting wizard pages get bounced back to /.
  // Skip this for /api/* so server actions and route handlers still work.
  if (
    claims &&
    !pathname.startsWith('/api/') &&
    (pathname === '/admin/setup' ||
      pathname.startsWith('/admin/setup/') ||
      pathname === '/onboarding' ||
      pathname.startsWith('/onboarding/'))
  ) {
    const userId = claims.sub;
    const [{ data: appSetting }, { data: profile }] = await Promise.all([
      supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'app.setup_completed_at')
        .maybeSingle(),
      supabase
        .from('user_profiles')
        .select('onboarding_completed_at, onboarding_skipped_at')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    const appSetupCompleted =
      appSetting?.value !== null && appSetting?.value !== undefined;
    const userOnboardingResolved = Boolean(
      profile?.onboarding_completed_at ?? profile?.onboarding_skipped_at,
    );

    // Admin setup is only "done" — onboarding is whatever the user resolved.
    const onAdminSetup =
      pathname === '/admin/setup' || pathname.startsWith('/admin/setup/');
    const onPersonalOnboarding =
      pathname === '/onboarding' || pathname.startsWith('/onboarding/');

    if (onAdminSetup && appSetupCompleted) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
    if (
      onPersonalOnboarding &&
      appSetupCompleted &&
      userOnboardingResolved
    ) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  // IMPORTANT: We *must* return supabaseResponse as-is. Constructing a new
  // NextResponse here would drop the rotated cookies and the user would
  // get logged out on the next request.
  return supabaseResponse;
}
