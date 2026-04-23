import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';

import { buildTextModel } from '@/lib/platform-providers';
import { createServiceClient } from '@/lib/supabase/service';

import { userContextSchema, withUserContext } from '../../lib/user-context';
import { storage } from '../../storage';
import { WorkspaceNotConfiguredError, buildWorkspace } from '../../workspace';

/**
 * Personal Assistant — the user-facing Main Agent.
 *
 * One code-defined agent serves *all* users. Per-user customization
 * happens via two orthogonal mechanisms, both runtime-only:
 *
 *  1. **Dynamic instructions** via the shared `withUserContext()` helper
 *     in `src/mastra/lib/user-context.ts`. The helper reads the
 *     per-user `preferredName` and `userPrompt` keys off the request
 *     context (which were set by the `applyUserContext()` chokepoint
 *     at the entry point) and prepends them to this agent's base
 *     prompt at call time. Nothing user-specific is baked into a
 *     static prompt.
 *
 *  2. **Memory isolation** via `MASTRA_RESOURCE_ID_KEY` set to
 *     `user_<userId>` (also done by `applyUserContext`). Mastra rejects
 *     any cross-resource thread access with 403, so a forged thread id
 *     cannot leak data between users.
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
 * Build the Personal Assistant agent. Returns a plain `Agent` instance;
 * called once from `src/mastra/singleton.ts` during top-level Mastra
 * instantiation.
 */
export async function createPersonalAssistant() {
  return new Agent({
    id: 'personal-assistant',
    name: 'Personal Assistant',
    description:
      "MastraClaw's main personal AI agent. One definition, per-user preferences injected at call time via the shared user-context chokepoint.",

    // The model is resolved from the active text provider stored in
    // `platform_settings`. `buildTextModel` caches for 30 s, so a burst
    // of chat turns doesn't hammer Supabase. Admin changes to the active
    // provider propagate within one TTL window without a process
    // restart.
    //
    // The service-role client is correct here: `buildTextModel` reads
    // the Vault-backed API key via the `app_secret_get` RPC, which
    // requires the caller to pass the `is_admin()` check. Service-role
    // bypasses that check unconditionally (see the migration at
    // `20260409120255_is_admin_service_role_bypass.sql`), and agents
    // run server-side so there's no client exposure risk.
    model: async () => {
      const supabase = createServiceClient();
      return buildTextModel(supabase);
    },

    requestContextSchema: userContextSchema,

    // Identity injection happens here, uniformly with every other agent
    // in MastraClaw.
    instructions: withUserContext(BASE_PROMPT),

    // Memory uses the shared Postgres storage from src/mastra/storage.ts.
    // Per-user isolation is enforced at call time by `applyUserContext`
    // setting `MASTRA_RESOURCE_ID_KEY = user_<userId>` in the request
    // context. Mastra returns 403 if a thread is accessed under the
    // wrong resource.
    memory: new Memory({
      storage,
      options: {
        lastMessages: 20,
        generateTitle: true,
      },
    }),

    // Per-request S3-backed workspace resolved from the request
    // context's resourceId (`user:<userId>` for personal agents).
    // Forgiving on missing context (dev invocations without auth):
    // returning `undefined` makes Mastra fall back to no workspace
    // tools instead of crashing the call.
    workspace: async ({ requestContext }) => {
      if (!requestContext) return undefined;
      try {
        return buildWorkspace('personal-assistant', requestContext);
      } catch (err) {
        if (err instanceof WorkspaceNotConfiguredError) return undefined;
        throw err;
      }
    },
  });
}
