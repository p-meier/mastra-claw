import 'server-only';

import type { UIMessage } from 'ai';
import { convertToModelMessages, stepCountIs, streamText, tool } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { toErrorResponse } from '@/app/api/_lib';
import { getCurrentUser } from '@/lib/auth';
import { commitPersonalOnboarding, personaSchema } from '@/lib/onboarding/commit';
import { buildBootstrapSystem } from '@/lib/onboarding/bootstrap-prompt';
import { createClient } from '@/lib/supabase/server';
import { mastraFor } from '@/mastra/lib/mastra-for';

/**
 * POST /api/onboarding/bootstrap
 *
 * The disposable bootstrap interview chat. Pure Vercel AI SDK
 * `streamText` call with one tool — NOT a Mastra agent — so this helper
 * never appears in any user-visible agent listing.
 *
 * Two paths converge on the same `commitPersonalOnboarding()` helper:
 *
 *   - Natural path: the model decides on its own to call
 *     `complete_bootstrap` (this route's tool).
 *   - Forced path: the user clicks "Finish setup" → POST to
 *     `/api/onboarding/bootstrap/finalize` which uses generateObject
 *     against the same persona schema.
 *
 * Implementation note: we capture `user` and `supabase` at the top of
 * the request handler and pass them into the tool execute via closure.
 * Calling a 'use server' action from inside `streamText`'s tool execute
 * is fragile — by the time the tool fires, the request-context AsyncLocalStorage
 * can be in an unexpected state and `cookies()` returns the wrong
 * (or no) session, which makes the supabase client we'd build inside
 * the action fail RLS. Capturing the already-built client up here
 * sidesteps that entirely.
 */

// Same lightweight UIMessage validator as the chat route — defends
// against malicious payloads without trying to replicate the full
// AI SDK v6 `UIMessage` type. The producing client (assistant-ui +
// AI SDK v6) guarantees the full shape; the cast to `UIMessage[]`
// goes through `unknown` so the type lie is visible.
const uiMessageShape = z.object({
  id: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  parts: z.array(z.unknown()),
});

const requestSchema = z.object({
  messages: z.array(uiMessageShape),
  wizardDraft: z.object({
    tone: z.enum(['casual', 'crisp', 'friendly', 'playful']),
    telegramSkipped: z.boolean(),
    telegramUserId: z.string().nullable(),
  }),
});

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { messages, wizardDraft } = parsed.data;

  const facade = mastraFor(user);

  let model;
  try {
    model = await facade.getLanguageModel();
  } catch (err) {
    return toErrorResponse(err);
  }

  // Capture the supabase client BEFORE streamText so the tool execute
  // doesn't have to call cookies() in a context where it might be lost.
  const supabase = await createClient();

  const modelMessages = await convertToModelMessages(
    messages as unknown as UIMessage[],
  );

  const result = streamText({
    model,
    system: buildBootstrapSystem(wizardDraft.tone),
    messages: modelMessages,
    stopWhen: stepCountIs(20),
    tools: {
      complete_bootstrap: tool({
        description:
          'Save the bootstrap interview result and end the conversation. Call this exactly once when you have learned enough about the user (typically after 4–6 user messages). After this is called the conversation ends and the user is dropped into their main chat.',
        inputSchema: personaSchema,
        execute: async (args) => {
          const commit = await commitPersonalOnboarding(
            supabase,
            user,
            wizardDraft,
            args,
          );
          if (!commit.ok) {
            return { ok: false as const, error: commit.error };
          }
          return {
            ok: true as const,
            message: `All set, ${args.nickname}.`,
          };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}

export const dynamic = 'force-dynamic';
