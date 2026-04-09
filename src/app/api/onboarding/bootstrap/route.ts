import 'server-only';

import { gateway } from '@ai-sdk/gateway';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type LanguageModel,
} from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth';
import { commitPersonalOnboarding, personaSchema } from '@/lib/onboarding/commit';
import { buildBootstrapSystem } from '@/lib/onboarding/bootstrap-prompt';
import { createClient } from '@/lib/supabase/server';
import { mastraFor, AppNotConfiguredError } from '@/mastra/lib/mastra-for';

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

export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { messages?: unknown; wizardDraft?: unknown };
  try {
    body = (await req.json()) as { messages?: unknown; wizardDraft?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) {
    return NextResponse.json(
      { error: 'messages array required' },
      { status: 400 },
    );
  }

  const wizardDraftSchema = z.object({
    tone: z.enum(['casual', 'crisp', 'friendly', 'playful']),
    telegramSkipped: z.boolean(),
    telegramUserId: z.string().nullable(),
  });
  const wizardDraftParse = wizardDraftSchema.safeParse(body.wizardDraft);
  if (!wizardDraftParse.success) {
    return NextResponse.json(
      { error: 'Invalid or missing wizardDraft in request body' },
      { status: 400 },
    );
  }
  const wizardDraft = wizardDraftParse.data;

  const facade = mastraFor(user);

  let creds;
  try {
    creds = await facade.getLlmCredentials();
  } catch (err) {
    if (err instanceof AppNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  const model = buildModel(
    creds.provider,
    creds.apiKey,
    creds.defaultModel,
    creds.baseUrl,
  );

  // Capture the supabase client BEFORE streamText so the tool execute
  // doesn't have to call cookies() in a context where it might be lost.
  const supabase = await createClient();

  const modelMessages = await convertToModelMessages(body.messages as never);

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

function buildModel(
  provider: string,
  apiKey: string,
  modelId: string,
  baseUrl: string | null,
): LanguageModel {
  switch (provider) {
    case 'anthropic':
      process.env.ANTHROPIC_API_KEY = apiKey;
      return anthropic(modelId);
    case 'openai':
      process.env.OPENAI_API_KEY = apiKey;
      return openai(modelId);
    case 'vercel-gateway':
      process.env.AI_GATEWAY_API_KEY = apiKey;
      return gateway(modelId);
    case 'openrouter':
      process.env.OPENAI_API_KEY = apiKey;
      process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1';
      return openai(modelId);
    case 'custom':
      process.env.OPENAI_API_KEY = apiKey;
      if (baseUrl) process.env.OPENAI_BASE_URL = baseUrl;
      return openai(modelId);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export const dynamic = 'force-dynamic';
