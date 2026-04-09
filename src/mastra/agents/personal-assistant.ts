import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';

import { buildPersonalAssistantChannels } from '../lib/agent-channels';
import { loadChannelContextOnto } from '../lib/channel-context-loader';
import { AppNotConfiguredError } from '../lib/llm-credentials';
import { resolveLanguageModel } from '../lib/resolve-language-model';
import {
  type LlmContext,
  userContextSchema,
  withUserContext,
} from '../lib/user-context';
import { storage } from '../storage';
import { createUserAgentWorkspace } from '../workspace';

/**
 * Personal Assistant — the user-facing Main Agent.
 *
 * One code-defined agent serves *all* users. Per-user customization
 * happens via two orthogonal mechanisms, both runtime-only:
 *
 *  1. **Dynamic instructions** via the shared `withUserContext()` helper
 *     in `src/mastra/lib/user-context.ts`. The helper reads the
 *     per-user `nickname` and `userPreferences` keys off the request
 *     context (which were set by the `applyUserContext()` chokepoint
 *     at the entry point) and prepends them to this agent's base
 *     prompt at call time. Nothing user-specific is baked into a
 *     static prompt. The `user_profiles` row is the source of truth
 *     and can be edited from `/account/settings` without redeploying.
 *
 *  2. **Memory isolation** via `MASTRA_RESOURCE_ID_KEY` set to
 *     `user_<userId>` (also done by `applyUserContext`). Mastra rejects
 *     any cross-resource thread access with 403, so a forged thread id
 *     cannot leak data between users.
 *
 * The Bootstrap interview that produces the user_preferences is *not* a
 * Mastra agent — it's a disposable Vercel AI SDK call so it never
 * appears in any user-visible agent listing. See
 * `src/app/api/onboarding/bootstrap/route.ts`.
 */

const BASE_PROMPT = `You are MastraClaw's Personal Assistant — a calm, capable, slightly playful AI partner for an executive, founder, or operator. Your job is to make this person's day work: help them think clearly, draft and review work, manage their calendar and inbox, research things they need to know, and remember what matters to them.

Default behavior:
- Be concise. Lead with the answer, then the reasoning if asked.
- Never take destructive action (sending email, modifying calendars, posting publicly, spending money) without explicit confirmation. Surface a clear summary and wait.
- When you don't know, say so and propose how to find out.
- Prefer doing one thing well over hedging across three.
- Match the user's tone and energy. Don't over-explain.

You have a private file workspace that persists across conversations for this specific user. Use it as your scratchpad: save artifacts the user asks you to keep (notes, drafts, generated documents), and read them back later when relevant. The user does not see the workspace contents unless they open the file browser or you tell them what's there. Writes, edits, and deletes require explicit user approval — surface the file path and a short summary of what you're about to do, then wait.`;

/**
 * Build the Personal Assistant agent.
 *
 * Why this is an async factory now: the `channels.adapters` map used to
 * be hardcoded to a single Telegram adapter that auto-read its bot
 * token from `process.env.TELEGRAM_BOT_TOKEN` (seeded by an
 * `instrumentation.ts` Vault read). After the channel-registry refactor
 * the channel set is dynamic — anything an admin has configured under
 * `/admin/channels` ends up here — and credentials are passed inline to
 * each adapter factory rather than going through `process.env`.
 *
 * The factory is called once at module load from `src/mastra/index.ts`
 * via top-level await. Cold start is fine (one Vault round-trip per
 * configured channel) and the result is captured as a singleton for
 * the lifetime of the process.
 */
export async function createPersonalAssistant() {
  const channels = await buildPersonalAssistantChannels();

  return new Agent({
  id: 'personal-assistant',
  name: 'Personal Assistant',
  description:
    "MastraClaw's main personal AI agent. One definition, per-user nickname + preferences injected at call time via the shared user-context chokepoint.",

  // The model is resolved at call time from the request context. Two
  // entry points populate the context, in two different ways:
  //
  //  1. **Web requests** — the `/api/agents/[id]/chat` route handler
  //     calls `applyUserContext()` BEFORE invoking the agent, so by
  //     the time this resolver fires, `llm` is already on the context.
  //
  //  2. **Channel requests (Telegram, …)** — the channel adapter
  //     attaches a `'channel'` key with the platform user id, but
  //     nothing else. Mastra resolves the agent's `model` *before*
  //     input processors run, so we cannot rely on a `BaseProcessor`
  //     to populate `llm` in time. Instead, this resolver detects the
  //     missing-`llm` case, calls `loadChannelContextOnto()` to do the
  //     full lookup (link → user → profile → credentials → Vault) and
  //     populate the request context, then proceeds.
  //
  // Either way, the AI SDK provider is built INLINE with the resolved
  // key — no `process.env` mutation, no race between concurrent users
  // with different keys. Async resolver is supported by Mastra's
  // `DynamicArgument` type.
  //
  // No silent fallback to a hardcoded model. If neither `llm` nor a
  // valid `channel` is present, throw — failing loudly is safer than
  // running against the wrong account.
  model: async ({ requestContext }) => {
    if (!requestContext) {
      throw new AppNotConfiguredError('request context');
    }
    let llm = requestContext.get('llm') as LlmContext | undefined;
    if (!llm) {
      // Channel-driven invocation: lazy-load credentials. Throws on
      // unlinked / unonboarded users — the channel adapter surfaces
      // the error as a reply.
      await loadChannelContextOnto(requestContext);
      llm = requestContext.get('llm') as LlmContext;
    }
    return resolveLanguageModel(llm);
  },

  requestContextSchema: userContextSchema,

  // Identity injection happens here, uniformly with every other agent
  // in MastraClaw. The agent file owns nothing about per-user wiring.
  instructions: withUserContext(BASE_PROMPT),

  // Memory uses the shared Postgres storage from src/mastra/storage.ts.
  // Pass it explicitly so a future refactor that drops storage from the
  // top-level Mastra config fails at boot rather than silently
  // degrading memory persistence. Per-user isolation is enforced at
  // call time by `applyUserContext` setting `MASTRA_RESOURCE_ID_KEY =
  // user_<userId>` in the request context. Mastra returns 403 if a
  // thread is accessed under the wrong resource.
  memory: new Memory({
    storage,
    options: {
      lastMessages: 20,
      generateTitle: true,
    },
  }),

  // Per-user S3-backed workspace, resolved per request from the
  // `userId` key that `applyUserContext()` writes onto every request
  // context (`src/mastra/lib/user-context.ts`). The builder returns a
  // fresh `Workspace` whose `S3Filesystem` is pinned to the
  // `users/<userId>/agents/personal-assistant/` prefix — Mastra
  // auto-wires `mastra_workspace_read_file`, `_write_file`,
  // `_list_files`, `_grep`, etc. into the agent's toolset, all routed
  // through that prefix.
  //
  // Forgiving on missing context (Studio invocations without auth):
  // returning `undefined` makes Mastra fall back to no workspace
  // tools instead of crashing the call.
  workspace: async ({ requestContext }) => {
    if (!requestContext) return undefined;
    const userId = requestContext.get('userId') as string | undefined;
    if (!userId) return undefined;
    return createUserAgentWorkspace(userId, 'personal-assistant') ?? undefined;
  },

  // Channels are populated from the admin channel registry. Each
  // adapter is constructed with explicit credentials (no
  // `process.env` mutation). When no channel is configured the field
  // is left undefined so Mastra skips channel initialization entirely.
  channels,
  });
}
