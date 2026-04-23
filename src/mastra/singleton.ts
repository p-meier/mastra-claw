import 'server-only';

import { Mastra } from '@mastra/core/mastra';
import { MastraAuthSupabase } from '@mastra/auth-supabase';
import { MastraEditor } from '@mastra/editor';
import { PinoLogger } from '@mastra/loggers';
import {
  Observability,
  DefaultExporter,
  SensitiveDataFilter,
} from '@mastra/observability';

import { env } from '@/lib/env';
import { createPersonalAssistant } from './agents/personal-assistant';
import { storage } from './storage';

/**
 * Process-wide Mastra singleton.
 *
 * Why `process` and not `globalThis`: under Next.js App Router, RSC
 * modules and Route Handler modules run in separate module scopes, and
 * under Turbopack/webpack server HMR a value stashed on `globalThis`
 * from one scope is not reliably visible to the other. `process` is
 * the same object in every server module scope in the same Node
 * process, so it's the only slot that works for a cross-boundary,
 * HMR-safe singleton.
 *
 * Why cache the Promise, not just the resolved Mastra: two concurrent
 * first-callers (e.g. RSC page + parallel route handler on cold start)
 * must share one build. If we only cached the resolved value, both
 * would race, each would call `new Mastra()`, and each would start an
 * independent Telegram polling loop — exactly the bug this file
 * fixes. Caching the Promise makes the second caller await the first's
 * build.
 *
 * Why this matters: `Mastra`'s constructor kicks off
 * `agentChannels.initialize()` as fire-and-forget inside `addAgent()`,
 * which starts the `@chat-adapter/telegram` long-polling loop. Every
 * stray `new Mastra()` creates an orphaned polling loop, and within a
 * few re-evaluations Telegram rejects all concurrent `getUpdates`
 * callers with `Conflict: terminated by other getUpdates request`.
 * Running `new Mastra()` exactly once per process is the whole fix.
 *
 * Side effect, deliberately accepted: any change under
 * `/admin/channels` or `/admin/settings` requires a process restart
 * to take effect — already documented in the admin Channels page
 * banner.
 */

const SLOT = Symbol.for('mastra-claw.singleton');

type Slot = { promise?: Promise<Mastra> };
type ProcessWithSlot = NodeJS.Process & { [SLOT]?: Slot };

function slot(): Slot {
  const p = process as ProcessWithSlot;
  if (!p[SLOT]) p[SLOT] = {};
  return p[SLOT]!;
}

export function getMastra(): Promise<Mastra> {
  const s = slot();
  if (!s.promise) s.promise = buildMastra();
  return s.promise;
}

async function buildMastra(): Promise<Mastra> {
  const personalAssistant = await createPersonalAssistant();

  // Auth provider for the Mastra HTTP server (plus any direct
  // `/api/agents/...` endpoints exposed by `mastra start`). This does
  // NOT gate Next.js Server Actions / Route Handlers — those run
  // in-process and go through `mastraFor(currentUser)` for their own
  // role-aware authorization. The default `authorizeUser` in
  // MastraAuthSupabase checks a `users.isAdmin` column we deliberately
  // don't have; roles live in `auth.users.raw_app_meta_data.role` per
  // ARCHITECTURE.md §6.
  const auth = new MastraAuthSupabase({
    url: env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    authorizeUser: (user) => {
      const role = (user.app_metadata as { role?: string } | undefined)?.role;
      return role === 'admin';
    },
  });

  return new Mastra({
    agents: { personalAssistant },
    workflows: {},
    scorers: {},
    editor: new MastraEditor(),
    // Mastra calls storage.init() automatically and creates its mastra_*
    // tables on first request. PgVector is added later, attached to a
    // Memory instance — not at the top level.
    storage,
    server: { auth },
    logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'mastra',
          exporters: [new DefaultExporter()],
          spanOutputProcessors: [new SensitiveDataFilter()],
        },
      },
    }),
  });
}
