import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client. Uses @supabase/ssr's `createBrowserClient`
 * which is internally a singleton — calling this multiple times in the same
 * browser session returns the same instance.
 *
 * Reads NEXT_PUBLIC_* env vars only. The publishable key is safe in the
 * browser by design (it carries no privileged access).
 *
 * Use this in:
 *   - Client Components ('use client')
 *   - Browser-side event handlers
 *   - Realtime subscriptions
 *
 * NEVER import this in Server Components, Server Actions, Route Handlers,
 * or any module under `src/mastra/`. Use the server client (`./server.ts`)
 * there instead.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
