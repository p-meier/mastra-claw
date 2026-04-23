import 'server-only';

import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';
import { z } from 'zod';

import type { CurrentUser } from '@/lib/auth';
import type { UserProfile } from '@/lib/user-profile';

// The LLM provider/model/key do not travel on the RequestContext —
// agents resolve the active text provider directly from
// `platform_settings` via `buildTextModel`. What stays here is only
// the identity block: which user, how they want to be addressed, and
// their free-form preferences markdown.

/**
 * Cross-cutting user identity injection for every Mastra agent in
 * MastraClaw.
 *
 * Why this exists: per-agent dynamic instructions that read `preferredName`
 * and `userPrompt` out of the request context don't scale once we add
 * sub-agents. Every agent would have to re-implement the same wiring, and
 * every entry point (chat route, cron job, etc.) would have to remember
 * to populate the same set of keys. Bugs in either layer leak data
 * between users.
 *
 * Instead, this file is the single chokepoint:
 *
 *  - **`applyUserContext()`** is the only place in the codebase that
 *    writes `userId`, `preferredName`, `userPrompt`, the resolved model,
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
 * instructions can read the same keys.
 *
 * **All fields are optional at the schema level on purpose.** Mastra
 * validates `requestContextSchema` *before* input processors run; the
 * runtime guarantee that they ARE present by the time the agent calls
 * the LLM lives in the `applyUserContext` chokepoint, which every
 * entry point (web chat route, future processors) is required to call.
 */
export const userContextSchema = z.object({
  userId: z.string().uuid().optional(),

  /** How the user wants to be addressed. Source: `user_profiles.preferred_name`. */
  preferredName: z.string().nullable().optional(),

  /**
   * Free-form Markdown about the user. Source: `user_profiles.user_prompt`.
   * Loaded verbatim into the system prompt under `<preferences>` tags.
   */
  userPrompt: z.string().nullable().optional(),
});

export type UserContext = z.infer<typeof userContextSchema>;

// ---------------------------------------------------------------------------
// Chokepoint: applyUserContext
// ---------------------------------------------------------------------------

export type ApplyUserContextInput = {
  user: CurrentUser;
  profile: UserProfile;
  /** Optional thread id; framework will create one per call if omitted. */
  threadId?: string;
};

/**
 * The single chokepoint for populating the request context that an agent
 * sees. **Every** entry point that invokes a MastraClaw agent must go
 * through this function — chat route, cron job, everything.
 *
 * Side effects (on the passed-in `RequestContext`):
 *
 *  - Sets `userId`, `preferredName`, `userPrompt`, `llm` (read by the
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
  const { user, profile, threadId } = input;

  if (user.userId !== profile.userId) {
    throw new Error(
      `applyUserContext: user/profile mismatch (${user.userId} vs ${profile.userId})`,
    );
  }

  rc.set('userId', user.userId);
  rc.set('preferredName', profile.preferredName);
  rc.set('userPrompt', profile.userPrompt);

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
 * It is forgiving by design: missing `preferredName` / `userPrompt` are
 * silently omitted, so an agent can still be invoked from a hand-rolled
 * request context without crashing.
 */
export function withUserContext(baseInstructions: string) {
  return async ({
    requestContext,
  }: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requestContext: RequestContext<any>;
  }): Promise<string> => {
    const preferredName =
      (requestContext.get('preferredName') as string | null) ?? null;
    const userPrompt =
      (requestContext.get('userPrompt') as string | null) ?? null;

    return composeInstructions(baseInstructions, { preferredName, userPrompt });
  };
}

// ---------------------------------------------------------------------------
// Internal: prompt composition
// ---------------------------------------------------------------------------

function composeInstructions(
  base: string,
  ctx: { preferredName: string | null; userPrompt: string | null },
): string {
  const parts: string[] = [base];

  if (ctx.preferredName) {
    parts.push(
      `\n# How to address the user\nAlways call the user **${ctx.preferredName}**.`,
    );
  }

  // Wrap the per-user preferences Markdown in <preferences> tags so the
  // model can reliably distinguish "static instructions" from "facts
  // about the user it should know". The Markdown body is editable from
  // /account/settings; the wrapper is added at injection time so the
  // stored value stays clean.
  if (ctx.userPrompt) {
    parts.push(`\n<preferences>\n${ctx.userPrompt}\n</preferences>`);
  }

  return parts.join('\n');
}
