import 'server-only';

import { gateway } from '@ai-sdk/gateway';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import {
  convertToModelMessages,
  generateObject,
  type LanguageModel,
} from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth';
import {
  commitPersonalOnboarding,
  personaSchema,
} from '@/lib/onboarding/commit';
import { createClient } from '@/lib/supabase/server';
import { mastraFor, AppNotConfiguredError } from '@/mastra/lib/mastra-for';

/**
 * POST /api/onboarding/bootstrap/finalize
 *
 * The "Finish setup" button's endpoint. Bypasses the streamText
 * tool-call dance entirely:
 *
 *   1. Take whatever message history the user has so far (could be
 *      zero messages, could be ten).
 *   2. Run a deterministic `generateObject()` call against the same
 *      `personaSchema` the chat tool uses, with a focused system prompt
 *      that tells the model "extract whatever you can, fall back to
 *      sensible defaults for anything missing".
 *   3. Commit via the same shared `commitPersonalOnboarding()` helper
 *      that the chat tool uses, so both paths produce identical writes.
 *
 * This is the user's escape hatch when the chat is dragging on or the
 * model gets stuck. It always works because `generateObject` returns
 * structured output unconditionally — no tool-call indirection that
 * the model can decline.
 */

import type { Tone } from '@/lib/onboarding/commit';

const TONE_HINT: Record<Tone, string> = {
  casual: 'casual, lowercase, no stress — like a quick text exchange between friends',
  crisp: 'crisp and polished — concise, professional, no fluff',
  friendly: 'warm and friendly — like texting with a good friend, light and personal',
  playful: 'playful and a little unhinged — keep things light, witty, occasionally cheeky',
};

function buildFinalizeSystem(tone: Tone): string {
  return `You are wrapping up a short personal-introduction interview between a brand-new AI assistant and its first user. The user just clicked "Finish setup" — they want this finished now, even if the interview is incomplete.

Your job: produce a final \`{ nickname, user_preferences }\` record from whatever is in the conversation so far. The interview is about WHO THE USER IS — NOT about what the assistant should do.

# nickname
Extract how the user said they want to be addressed. If unclear, use the first name they gave or a sensible default ("there").

# user_preferences

Write a concise Markdown document about the user. Use **exactly** this section structure (skip any section that has no content — never invent facts the user did not share):

\`\`\`markdown
# User Information
<First name + age + location, in one or two short sentences.>

## Professional Background
<1–3 short sentences about what they do — role, company, focus area.>

## Personal Background
<1–3 short sentences about life outside of work — family, life situation, where they're headed.>

## Communication Style
<Start this section with the chosen tone keyword and a short expansion. The tone the user picked is: "${tone}" (${TONE_HINT[tone]}). Then add anything specific the user mentioned about how they want to be talked to.>

## Additional Notes
<Anything else they volunteered worth remembering long-term. Omit this section if there's nothing.>
\`\`\`

Rules:
- Use ONLY information that is actually present in the conversation. Do NOT invent facts.
- Skip sections (and lines within them) that have no content. Do not write "unspecified" or "unknown".
- **Always include the "## Communication Style" section** — it's the only one with a known value (the tone the user picked in the form).
- **Match the user's language.** If the user wrote in German, write the Markdown in German.
- Aim for 10–25 lines. Information density beats length.`;
}

const requestSchema = z.object({
  messages: z.array(z.unknown()),
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { messages, wizardDraft } = parsed.data;

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

  // Convert UI messages → model messages so generateObject sees the
  // same conversation the user has been having in the chat.
  const modelMessages = await convertToModelMessages(messages as never);

  let persona;
  try {
    const obj = await generateObject({
      model,
      schema: personaSchema,
      system: buildFinalizeSystem(wizardDraft.tone),
      messages: modelMessages,
    });
    persona = obj.object;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to summarize interview: ${msg}` },
      { status: 500 },
    );
  }

  const supabase = await createClient();
  const commit = await commitPersonalOnboarding(
    supabase,
    user,
    wizardDraft,
    persona,
  );
  if (!commit.ok) {
    return NextResponse.json({ error: commit.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, persona });
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
