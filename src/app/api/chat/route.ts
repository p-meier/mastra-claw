import 'server-only';

import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
  RequestContext,
} from '@mastra/core/request-context';
import { handleChatStream } from '@mastra/ai-sdk';
import { createUIMessageStreamResponse } from 'ai';
import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth';
import { mastra } from '@/mastra';
import { mastraFor, AppNotConfiguredError } from '@/mastra/lib/mastra-for';

/**
 * POST /api/chat
 *
 * The single user-facing chat endpoint that talks to the personal
 * assistant Mastra agent.
 *
 * Implementation notes:
 *
 *  - Uses `handleChatStream()` from `@mastra/ai-sdk` (the canonical
 *    bridge from a Mastra agent to AI SDK's UI message stream format).
 *    This is what `useChat()` in the frontend speaks.
 *  - Per-user isolation is enforced at three layers:
 *      1. `getCurrentUser()` rejects unauthenticated requests.
 *      2. `MASTRA_RESOURCE_ID_KEY` is set in the request context to
 *         `user_<userId>` so Mastra rejects any thread access under a
 *         different resource — even a forged thread id from the client.
 *      3. The same value is passed explicitly via `memory: { resource }`
 *         so log inspection is unambiguous.
 *  - The bootstrap interview (`/api/onboarding/bootstrap`) is a SEPARATE
 *    endpoint that intentionally does NOT touch Mastra at all — it's a
 *    one-off Vercel AI SDK call so the bootstrap helper never appears in
 *    any Mastra agent listing.
 *
 * Body shape (matches AI SDK `useChat` posting):
 *
 *     { messages: UIMessage[], threadId?: string }
 */
export async function POST(req: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { messages?: unknown; threadId?: unknown };
  try {
    body = (await req.json()) as { messages?: unknown; threadId?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      { error: 'messages array required' },
      { status: 400 },
    );
  }

  const facade = mastraFor(user);

  let credentials;
  try {
    credentials = await facade.getLlmCredentials();
  } catch (err) {
    if (err instanceof AppNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  const profile = await facade.profile();
  if (!profile) {
    return NextResponse.json(
      { error: 'User profile missing — onboarding incomplete' },
      { status: 409 },
    );
  }

  const resourceId = `user_${user.userId}`;
  const threadId =
    typeof body.threadId === 'string' && body.threadId.length > 0
      ? body.threadId
      : `chat_${user.userId}_${Date.now()}`;

  const requestContext = new RequestContext();
  requestContext.set('userId', user.userId);
  requestContext.set('nickname', profile.nickname);
  requestContext.set('userPreferences', profile.userPreferences);
  requestContext.set('model', credentials.defaultModel);
  // Reserved keys — middleware-style enforcement of per-user memory isolation.
  requestContext.set(MASTRA_RESOURCE_ID_KEY, resourceId);
  requestContext.set(MASTRA_THREAD_ID_KEY, threadId);

  // Make the API key available to providers via env. AI SDK provider
  // packages all read from process.env by default. This is process-wide
  // and racy under concurrent traffic; Phase 1 is single-user.
  injectProviderKey(credentials.provider, credentials.apiKey, credentials.baseUrl);

  // Hand the request off to @mastra/ai-sdk's framework-agnostic helper.
  // We pass version: 'v6' so the helper emits AI SDK v6-typed chunks
  // (matching our installed `ai` package), which removes the need for
  // the v5↔v6 cast we used in earlier drafts.
  const stream = await handleChatStream({
    mastra,
    agentId: 'personal-assistant',
    version: 'v6',
    params: {
      messages: body.messages as never,
      requestContext,
      memory: { resource: resourceId, thread: threadId },
    },
  });

  return createUIMessageStreamResponse({ stream });
}

function injectProviderKey(
  provider: string,
  apiKey: string,
  baseUrl: string | null,
): void {
  switch (provider) {
    case 'anthropic':
      process.env.ANTHROPIC_API_KEY = apiKey;
      break;
    case 'openai':
      process.env.OPENAI_API_KEY = apiKey;
      break;
    case 'openrouter':
      process.env.OPENROUTER_API_KEY = apiKey;
      break;
    case 'vercel-gateway':
      process.env.AI_GATEWAY_API_KEY = apiKey;
      break;
    case 'custom':
      process.env.OPENAI_API_KEY = apiKey;
      if (baseUrl) process.env.OPENAI_BASE_URL = baseUrl;
      break;
  }
}
