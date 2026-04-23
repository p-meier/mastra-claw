import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

/**
 * Service-role Supabase client for **headless** entry points — places
 * where there is no Next.js session cookie to read, so the
 * cookie-bound `createClient()` in `./server.ts` would fail every RLS
 * check.
 *
 * Legitimate callers are anything outside a logged-in browser session:
 * cron jobs, scheduled tasks, boot-time initialisation that needs to
 * read from Vault before the first HTTP request, or admin migration
 * scripts. The service-role key bypasses RLS entirely, so callers are
 * responsible for their own authorization.
 *
 * **Not** used by anything driven by a logged-in browser session —
 * those go through `createClient()` in `./server.ts`, which respects
 * RLS.
 */
export function createServiceClient() {
  return createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}
