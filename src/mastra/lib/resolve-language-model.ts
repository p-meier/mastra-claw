import 'server-only';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3 } from '@ai-sdk/provider-v6';

import type { TextProviderId } from '@/lib/providers/text';

type LlmProvider = TextProviderId;

/** Default OpenRouter API base URL when the credential doesn't supply one. */
const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Resolve a `LanguageModelV3` instance from per-request credentials.
 *
 * This is the SOTA replacement for the previous `injectProviderKey()`
 * helper, which mutated `process.env` globally and was racy under
 * concurrent traffic with different per-user keys (see plan §F.1 and
 * the secrets-handling audit).
 *
 * Each AI SDK provider factory is called inline with the resolved
 * `apiKey`, so nothing ever touches process-wide state. Safe to call
 * once per request from a Mastra agent's `model: ({ requestContext }) =>`
 * resolver.
 */
export type LanguageModelInputs = {
  provider: LlmProvider;
  apiKey: string;
  modelId: string;
  baseUrl: string | null;
};

export function resolveLanguageModel(inputs: LanguageModelInputs): LanguageModelV3 {
  const { provider, apiKey, modelId, baseUrl } = inputs;

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId);

    case 'openai':
      return createOpenAI({ apiKey })(modelId);

    case 'openrouter':
      return createOpenAICompatible({
        name: 'openrouter',
        apiKey,
        baseURL: baseUrl ?? OPENROUTER_DEFAULT_BASE_URL,
      }).chatModel(modelId);

    case 'vercel-gateway':
      return createGateway({ apiKey })(modelId);

    case 'custom':
      if (!baseUrl) {
        throw new Error(
          'resolveLanguageModel: provider "custom" requires a baseUrl',
        );
      }
      return createOpenAICompatible({
        name: 'custom',
        apiKey,
        baseURL: baseUrl,
      }).chatModel(modelId);
  }
}
