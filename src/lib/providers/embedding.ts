import 'server-only';

import { createGateway } from '@ai-sdk/gateway';

import type {
  DescriptorProbeExtras,
  ProbeResult,
} from '@/lib/descriptors/types';

import {
  fetchJson,
  probeCustomOpenAiCompat,
  safeError,
} from './_shared';
import type { ProviderDescriptor } from './registry';

/**
 * Embedding-model providers. Kept separate from text providers because
 * not every text provider exposes embeddings (Anthropic doesn't,
 * OpenRouter doesn't front embedding endpoints), and admins may want a
 * different provider here for cost or locality reasons.
 *
 * The set mirrors text providers that *do* support embeddings plus the
 * Custom (OpenAI-compatible) fallback. ElevenLabs (voice) is excluded
 * by design.
 */

const OPENAI_API_BASE = 'https://api.openai.com';

// OpenAI returns every model from /v1/models — filter to the embedding
// family so the picker doesn't bleed chat or audio models.
const OPENAI_EMBEDDING_PATTERN = /^(text-embedding-|text-similarity-)/i;

async function probeVercelGatewayEmbedding(
  apiKey: string,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  try {
    const gateway = createGateway({ apiKey });
    const meta = await gateway.getAvailableModels();
    const models = meta.models
      .filter((m) => m.modelType === 'embedding')
      .map((m) => m.id)
      .sort();
    if (models.length === 0) {
      return {
        ok: false,
        error:
          'Connected, but no embedding models returned. Check your API access tier.',
      };
    }
    return { ok: true, models };
  } catch (err) {
    return safeError('Vercel AI Gateway connection failed', err);
  }
}

async function probeOpenAiEmbedding(
  apiKey: string,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  try {
    const res = await fetchJson(`${OPENAI_API_BASE}/v1/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `OpenAI returned HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      };
    }
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{ id?: string }>;
    };
    const models = (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .filter((id) => OPENAI_EMBEDDING_PATTERN.test(id))
      .sort();
    if (models.length === 0) {
      return {
        ok: false,
        error:
          'Connected, but no embedding models returned. Check your API access tier.',
      };
    }
    return { ok: true, models };
  } catch (err) {
    return safeError('OpenAI connection failed', err);
  }
}

export const EMBEDDING_PROVIDERS: ProviderDescriptor[] = [
  {
    id: 'vercel-gateway',
    category: 'embedding',
    displayName: 'Vercel AI Gateway',
    badge: 'Recommended',
    blurb:
      'Same gateway as the text provider — embedding models through one key.',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        helpUrl: 'https://vercel.com/dashboard/ai-gateway',
        helpText:
          'You can reuse the same key configured for the text provider — they are interchangeable.',
      },
      {
        name: 'defaultModel',
        label: 'Embedding model',
        type: 'model-select',
        modelKind: 'embedding',
        required: true,
        secret: false,
      },
    ],
    probe: async (values) =>
      probeVercelGatewayEmbedding(String(values.apiKey ?? '')),
  },

  {
    id: 'openai',
    category: 'embedding',
    displayName: 'OpenAI',
    blurb:
      'Direct OpenAI API for embeddings. Use this when you already have an OpenAI account.',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        helpUrl: 'https://platform.openai.com/api-keys',
      },
      {
        name: 'defaultModel',
        label: 'Embedding model',
        type: 'model-select',
        modelKind: 'embedding',
        required: true,
        secret: false,
      },
    ],
    probe: async (values) => probeOpenAiEmbedding(String(values.apiKey ?? '')),
  },

  {
    id: 'custom',
    category: 'embedding',
    displayName: 'Custom (OpenAI-compatible)',
    blurb:
      'Ollama, LM Studio, vLLM, private deployments — anything that speaks the OpenAI /embeddings schema.',
    fields: [
      {
        name: 'baseUrl',
        label: 'Base URL',
        type: 'url',
        required: true,
        secret: false,
        placeholder: 'http://localhost:11434/v1',
      },
      {
        name: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        helpText:
          'Some local servers accept any non-empty value — use a placeholder if your server is unauthenticated.',
      },
      {
        name: 'defaultModel',
        label: 'Embedding model',
        type: 'model-select',
        modelKind: 'embedding',
        required: true,
        secret: false,
        helpText:
          'The /models endpoint does not carry modality metadata — pick an embedding-capable model id.',
      },
    ],
    probe: async (values) =>
      probeCustomOpenAiCompat(
        String(values.apiKey ?? ''),
        values.baseUrl ? String(values.baseUrl) : undefined,
      ),
  },
];
