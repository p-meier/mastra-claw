import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { z } from 'zod';

/**
 * Personal Assistant — the user-facing Main Agent.
 *
 * One code-defined agent serves *all* users. Per-user customization
 * happens via two orthogonal mechanisms, both runtime-only:
 *
 *  1. **Dynamic instructions** read `requestContext` and inject the
 *     per-user profile (nickname + free-form Markdown user_preferences)
 *     at call time. Nothing is baked into a static prompt. The
 *     user_profiles row is the source of truth and can be edited from
 *     /account/settings without redeploying.
 *
 *  2. **Memory isolation** via `resource: user_${userId}` passed at
 *     call time. Each user has their own conversation history and
 *     working memory under their own resource, persisted in the same
 *     Postgres storage as everything else. Mastra enforces ownership at
 *     the framework level — `MASTRA_RESOURCE_ID_KEY` set in middleware
 *     causes Mastra to reject any cross-resource thread access with
 *     403, so a forged thread ID cannot leak data between users.
 *
 * The Bootstrap interview that produces the user_preferences is *not* a
 * Mastra agent — it's a disposable Vercel AI SDK call so it never
 * appears in any user-visible agent listing. See
 * `src/app/api/onboarding/bootstrap/route.ts`.
 */

// ---------------------------------------------------------------------------
// Request context shape
// ---------------------------------------------------------------------------

export const personalAssistantContextSchema = z.object({
  userId: z.string().uuid(),

  // How the user wants to be addressed (e.g. "Patrick"). Captured during
  // the bootstrap interview, editable from /account/settings.
  nickname: z.string().nullable(),

  // Free-form Markdown document about the user. Loaded verbatim into
  // the system prompt. Editable from /account/settings — single source
  // of truth for the per-user persona.
  userPreferences: z.string().nullable(),
});

export type PersonalAssistantContext = z.infer<
  typeof personalAssistantContextSchema
>;

// ---------------------------------------------------------------------------
// Prompt composition
// ---------------------------------------------------------------------------

const BASE_PROMPT = `You are MastraClaw's Personal Assistant — a calm, capable, slightly playful AI partner for an executive, founder, or operator. Your job is to make this person's day work: help them think clearly, draft and review work, manage their calendar and inbox, research things they need to know, and remember what matters to them.

Default behavior:
- Be concise. Lead with the answer, then the reasoning if asked.
- Never take destructive action (sending email, modifying calendars, posting publicly, spending money) without explicit confirmation. Surface a clear summary and wait.
- When you don't know, say so and propose how to find out.
- Prefer doing one thing well over hedging across three.
- Match the user's tone and energy. Don't over-explain.`;

function composeInstructions(ctx: PersonalAssistantContext): string {
  const parts = [BASE_PROMPT];

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

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

export const personalAssistant = new Agent({
  id: 'personal-assistant',
  name: 'Personal Assistant',
  description:
    "MastraClaw's main personal AI agent. One definition, per-user nickname + preferences injected at call time via requestContext.",

  // The model is resolved at call time from the request context. The
  // chat route handler reads it from `mastraFor(user).getLlmCredentials()`
  // and sets it on the requestContext under the `model` key. We default
  // to a sensible Anthropic model if nothing is set so the agent is
  // still callable from Studio for development.
  model: ({ requestContext }) => {
    const m = requestContext?.get('model') as string | undefined;
    return m ?? 'anthropic/claude-sonnet-4-5';
  },

  requestContextSchema: personalAssistantContextSchema.extend({
    // Allowed but not validated by the persona schema — set by the chat
    // route handler before invoking the agent.
    model: z.string().optional(),
  }),

  instructions: async ({ requestContext }) => {
    const ctx = personalAssistantContextSchema.parse({
      userId: requestContext.get('userId'),
      nickname: requestContext.get('nickname') ?? null,
      userPreferences: requestContext.get('userPreferences') ?? null,
    });
    return composeInstructions(ctx);
  },

  // Memory uses the shared Postgres storage from src/mastra/storage.ts.
  // Per-user isolation is enforced at call time by passing
  // `memory: { resource: 'user_<userId>', thread: ... }` AND by setting
  // MASTRA_RESOURCE_ID_KEY in the request context — see the chat route
  // handler. Mastra returns 403 if a thread is accessed under the wrong
  // resource.
  memory: new Memory({
    options: {
      lastMessages: 20,
      generateTitle: true,
    },
  }),
});
