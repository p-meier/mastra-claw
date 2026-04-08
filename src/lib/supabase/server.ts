import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-side Supabase client for Server Components, Server Actions, and
 * Route Handlers.
 *
 * Reads cookies from the incoming request via `next/headers` so the user's
 * session travels with the request. The `setAll` try/catch is intentional
 * — Server Components cannot write cookies, so any writes from a Server
 * Component context throw. The proxy (`proxy.ts`) is responsible for
 * actually persisting refreshed cookies, so it is safe to swallow the error
 * here.
 *
 * Pattern source: https://supabase.com/docs/guides/auth/server-side/creating-a-client
 *
 * The `'server-only'` import at the top is a Next.js build-time guard: if
 * any Client Component imports this file, the build fails loud.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components can't set cookies. The proxy refreshes them.
          }
        },
      },
    },
  );
}
