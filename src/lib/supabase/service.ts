import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';

/**
 * Service-role Supabase client for **headless** entry points — places
 * where there is no Next.js session cookie to read, so the
 * cookie-bound `createClient()` in `./server.ts` would fail every RLS
 * check.
 *
 * MastraClaw does not run its own Telegram (or other channel) webhook
 * routes. Channel I/O is delegated to Mastra's built-in `AgentChannels`
 * (`@chat-adapter/telegram`, …), which polls / receives messages
 * outside the Next.js request lifecycle. Both legitimate callers of
 * this client live on that channel path:
 *
 *  - **`src/instrumentation.ts`** — runs once at server boot, before
 *    any HTTP request, to read the Telegram bot token from Supabase
 *    Vault (`app_secret_get` RPC) and seed it into `process.env` so
 *    `createTelegramAdapter()` picks it up when the `Mastra`
 *    constructor wires up `AgentChannels`. No session exists yet at
 *    this point, by definition.
 *  - **`src/mastra/lib/channel-context-processor.ts`** — input
 *    processor invoked on every channel-driven agent call. The
 *    incoming Telegram message carries no Supabase JWT, so this
 *    client is used to resolve `user_telegram_links → user_profiles`,
 *    fetch the active LLM credentials from `app_settings` + Vault,
 *    and call `applyUserContext` before the agent runs.
 *
 * Future headless entry points (cron jobs, other channel adapters,
 * scheduled tasks) belong here as well.
 *
 * **Not** used by:
 *
 *  - Anything driven by a logged-in browser session — those go
 *    through `createClient()` in `./server.ts`, which respects RLS.
 *
 * The service-role key bypasses RLS entirely, so callers are
 * responsible for their own authorization. The discipline:
 * `createServiceClient()` is only constructed from the channel boot
 * path (`src/instrumentation.ts`) and the channel context processor
 * (`src/mastra/lib/channel-context-processor.ts`). CI grep enforces
 * it.
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
