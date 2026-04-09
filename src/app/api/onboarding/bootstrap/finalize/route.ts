import 'server-only';

import type { UIMessage } from 'ai';
import { convertToModelMessages, generateObject } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { toErrorResponse } from '@/app/api/_lib';
import { getCurrentUser } from '@/lib/auth';
import {
  commitPersonalOnboarding,
  personaSchema,
} from '@/lib/onboarding/commit';
import { createClient } from '@/lib/supabase/server';
import { mastraFor } from '@/mastra/lib/mastra-for';

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

const uiMessageShape = z.object({
  id: z.string(),
  role: z.enum(['system', 'user', 'assistant']),
  parts: z.array(z.unknown()),
});

const requestSchema = z.object({
  messages: z.array(uiMessageShape),
  wizardDraft: z.object({
    tone: z.enum(['casual', 'crisp', 'friendly', 'playful']),
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

  let model;
  try {
    model = await facade.getLanguageModel();
  } catch (err) {
    return toErrorResponse(err);
  }

  // Convert UI messages → model messages so generateObject sees the
  // same conversation the user has been having in the chat.
  const modelMessages = await convertToModelMessages(
    messages as unknown as UIMessage[],
  );

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
    console.error('[onboarding/bootstrap/finalize] generateObject failed', err);
    return NextResponse.json(
      { error: 'Failed to summarize interview. Please try again.' },
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

export const dynamic = 'force-dynamic';
