import 'server-only';

import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';
import { z } from 'zod';

import type { CurrentUser } from '@/lib/auth';
import type { UserProfile } from '@/lib/onboarding/profile';

/**
 * Cross-cutting user identity injection for every Mastra agent in
 * MastraClaw.
 *
 * Why this exists: per-agent dynamic instructions that read `nickname` and
 * `userPreferences` out of the request context don't scale once we add
 * sub-agents. Every agent would have to re-implement the same wiring, and
 * every entry point (chat route, Telegram webhook, cron job, etc.) would
 * have to remember to populate the same set of keys. Bugs in either layer
 * leak data between users.
 *
 * Instead, this file is the single chokepoint:
 *
 *  - **`applyUserContext()`** is the only place in the codebase that
 *    writes `userId`, `nickname`, `userPreferences`, the resolved model,
 *    and the framework-reserved `MASTRA_RESOURCE_ID_KEY` /
 *    `MASTRA_THREAD_ID_KEY` keys onto a `RequestContext`. Every entry
 *    point that invokes an agent calls it. CI grep enforces this:
 *    `grep -rn "requestContext\.set('userId'" src/` should only show
 *    this file.
 *
 *  - **`withUserContext(baseInstructions)`** is what every agent's
 *    `instructions` field uses. It returns the dynamic-instructions
 *    function Mastra wants, which prepends the user identity block to
 *    the agent's own base prompt at call time.
 *
 *  - **`userContextSchema`** is the shared Zod schema for the keys
 *    `applyUserContext` writes. Individual agents extend it with their
 *    own request-context keys (e.g. `model`) when defining their
 *    `requestContextSchema`.
 *
 * The agent file then only owns its specialty — base prompt, tools,
 * memory config — and identity injection happens uniformly above it.
 */

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Shared request-context schema for user identity. Every agent's own
 * `requestContextSchema` should extend this so that the dynamic
 * instructions and model resolver can read the same keys.
 *
 * **All fields are optional at the schema level on purpose.** Mastra
 * validates `requestContextSchema` *before* input processors run, and
 * channel-driven requests (Telegram, Slack, …) populate these keys in
 * the `ChannelUserContextProcessor` — they aren't present yet at
 * validation time. The runtime guarantee that they ARE present by the
 * time the agent calls the LLM lives in the `applyUserContext`
 * chokepoint, which every entry point (web chat route, channel
 * processor) is required to call.
 */
/**
 * Per-request LLM credentials, set on the request context by every entry
 * point and consumed by an agent's `model: ({ requestContext }) =>`
 * resolver via `resolveLanguageModel()`. This replaces the old
 * `process.env` mutation pattern (`injectProviderKey`) which was racy
 * under concurrent traffic.
 *
 * `apiKey` is sensitive — it lives only on the in-process RequestContext
 * for the duration of one request and is never written to env, logs, or
 * persistent storage by this codebase. Observability traces should be
 * filtered via `SensitiveDataFilter` (see ARCHITECTURE.md §11).
 */
export const llmContextSchema = z.object({
  provider: z.enum([
    'anthropic',
    'openai',
    'openrouter',
    'vercel-gateway',
    'custom',
  ]),
  apiKey: z.string(),
  modelId: z.string(),
  baseUrl: z.string().nullable(),
});

export type LlmContext = z.infer<typeof llmContextSchema>;

export const userContextSchema = z.object({
  userId: z.string().uuid().optional(),

  /** How the user wants to be addressed. Source: `user_profiles.nickname`. */
  nickname: z.string().nullable().optional(),

  /**
   * Free-form Markdown about the user. Source: `user_profiles.user_preferences`.
   * Loaded verbatim into the system prompt under `<preferences>` tags.
   */
  userPreferences: z.string().nullable().optional(),

  /**
   * Resolved LLM credentials for this request. Optional at the schema
   * level so a hand-rolled Studio invocation can omit it and let the
   * agent fall back to a Mastra-router model string.
   */
  llm: llmContextSchema.optional(),
});

export type UserContext = z.infer<typeof userContextSchema>;

// ---------------------------------------------------------------------------
// Chokepoint: applyUserContext
// ---------------------------------------------------------------------------

export type ApplyUserContextInput = {
  user: CurrentUser;
  profile: UserProfile;
  /** Resolved per-request LLM credentials (provider + apiKey + modelId + baseUrl). */
  llm: LlmContext;
  /** Optional thread id; framework will create one per call if omitted. */
  threadId?: string;
};

/**
 * The single chokepoint for populating the request context that an agent
 * sees. **Every** entry point that invokes a MastraClaw agent must go
 * through this function — chat route, Telegram dispatch, cron job,
 * everything.
 *
 * Side effects (on the passed-in `RequestContext`):
 *
 *  - Sets `userId`, `nickname`, `userPreferences`, `model` (read by the
 *    agent's `instructions` resolver and `model` resolver).
 *  - Sets `MASTRA_RESOURCE_ID_KEY = "user_<userId>"`. This is the per-user
 *    isolation key — Mastra rejects any thread access under a different
 *    resource id with 403, so a forged thread id from the client cannot
 *    leak data.
 *  - Sets `MASTRA_THREAD_ID_KEY` if `threadId` was provided.
 *
 * Returns the `resourceId` so callers can pass it explicitly into
 * `agent.generate({ memory: { resource, thread } })` for unambiguous
 * log inspection.
 */
export function applyUserContext(
  rc: RequestContext,
  input: ApplyUserContextInput,
): { resourceId: string } {
  const { user, profile, llm, threadId } = input;

  if (user.userId !== profile.userId) {
    throw new Error(
      `applyUserContext: user/profile mismatch (${user.userId} vs ${profile.userId})`,
    );
  }

  rc.set('userId', user.userId);
  rc.set('nickname', profile.nickname);
  rc.set('userPreferences', profile.userPreferences);
  rc.set('llm', llm);

  const resourceId = `user_${user.userId}`;
  rc.set(MASTRA_RESOURCE_ID_KEY, resourceId);
  if (threadId) {
    rc.set(MASTRA_THREAD_ID_KEY, threadId);
  }

  return { resourceId };
}

// ---------------------------------------------------------------------------
// Instructions helper: withUserContext
// ---------------------------------------------------------------------------

/**
 * Wrap an agent's base prompt so that the per-user identity block is
 * prepended to every invocation.
 *
 * Usage:
 *
 *     export const myAgent = new Agent({
 *       id: 'my-agent',
 *       instructions: withUserContext(`You are the X specialist...`),
 *       requestContextSchema: userContextSchema.extend({
 *         model: z.string().optional(),
 *       }),
 *       ...
 *     });
 *
 * The returned function reads the same keys that `applyUserContext` set.
 * It is forgiving by design: missing `nickname` / `userPreferences` are
 * silently omitted, so an agent can still be invoked from Mastra Studio
 * with a hand-rolled (incomplete) request context for development.
 */
export function withUserContext(baseInstructions: string) {
  // Returns an `instructions` resolver compatible with Mastra's
  // `Agent({ instructions })` field. The `requestContext` is typed
  // loosely as `RequestContext` (no schema generic) so this single
  // helper plugs into every agent regardless of how that agent extends
  // `userContextSchema` for its own keys. The internal `get()` calls
  // are still safe — `applyUserContext()` is the only writer and
  // guarantees these keys are present.
  return async ({
    requestContext,
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requestContext: RequestContext<any>;
  }): Promise<string> => {
    const nickname = (requestContext.get('nickname') as string | null) ?? null;
    const userPreferences =
      (requestContext.get('userPreferences') as string | null) ?? null;

    return composeInstructions(baseInstructions, { nickname, userPreferences });
  };
}

// ---------------------------------------------------------------------------
// Internal: prompt composition
// ---------------------------------------------------------------------------

function composeInstructions(
  base: string,
  ctx: { nickname: string | null; userPreferences: string | null },
): string {
  const parts: string[] = [base];

  if (ctx.nickname) {
    parts.push(
      `\n# How to address the user\nAlways call the user **${ctx.nickname}**.`,
    );
  }

  // Wrap the per-user preferences Markdown in <preferences> tags so the
  // model can reliably distinguish "static instructions" from "facts
  // about the user it should know". The Markdown body is editable from
  // /account/settings; the wrapper is added at injection time so the
  // stored value stays clean.
  if (ctx.userPreferences) {
    parts.push(`\n<preferences>\n${ctx.userPreferences}\n</preferences>`);
  }

  return parts.join('\n');
}
