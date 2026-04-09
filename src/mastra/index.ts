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

// Top-level await so the agent's `channels` slot is populated from
// `app_settings` + Vault before the Mastra constructor runs. The
// alternative — constructing with empty channels and patching later —
// would race against `AgentChannels.initialize()`, which kicks off
// polling immediately when the Mastra instance is built.
const personalAssistant = await createPersonalAssistant();

/**
 * Auth provider for the Mastra HTTP server (Mastra Studio on :4111, plus any
 * direct `/api/agents/...` endpoints exposed by `mastra start`).
 *
 * This does NOT gate Next.js Server Actions / Route Handlers — those run
 * in-process and will go through `mastraFor(currentUser)` (added later) for
 * their own role-aware authorization.
 *
 * The default `authorizeUser` in MastraAuthSupabase checks a `users.isAdmin`
 * column in the public schema, which we deliberately don't have. Per
 * ARCHITECTURE.md §6 / CLAUDE.md, roles live in `auth.users.raw_app_meta_data.role`
 * (exposed as `user.app_metadata.role` on the Supabase User object). Phase 1
 * ships with a single admin (Patrick); everyone else is rejected.
 */
const auth = new MastraAuthSupabase({
  url: env.NEXT_PUBLIC_SUPABASE_URL,
  anonKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  authorizeUser: (user) => {
    const role = (user.app_metadata as { role?: string } | undefined)?.role;
    return role === 'admin';
  },
});

export const mastra = new Mastra({
  agents: { personalAssistant },
  workflows: {},
  scorers: {},
  editor: new MastraEditor(),
  // Mastra calls storage.init() automatically and creates its mastra_*
  // tables on first request. PgVector is added later, attached to a Memory
  // instance — not at the top level.
  storage,
  server: {
    auth,
  },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
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
