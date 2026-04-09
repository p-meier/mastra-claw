import 'server-only';

import { createGateway } from '@ai-sdk/gateway';
import { getProviderConfig } from '@mastra/core/llm';

import type {
  DescriptorProbeExtras,
  ProbeResult,
} from '@/lib/descriptors/types';

import type { ProviderDescriptor } from './registry';

/**
 * Text model providers. Each descriptor knows:
 *  - which credential fields the admin must enter
 *  - how to validate them (`probe`)
 *  - how to enumerate available models post-probe so the form's
 *    `model-select` field can populate without a second round-trip
 *
 * Probes are pure: no DB writes, no env reads, no global state mutation.
 * They never throw — every error path returns `{ ok: false, error }` so
 * the wizard / admin form can render the message inline.
 *
 * Where the base URLs come from
 * -----------------------------
 * Wherever possible we look up the provider's base URL via Mastra's
 * `getProviderConfig(providerId).url`. That keeps a single source of
 * truth for endpoint locations and means a routing change upstream
 * lands in our code via a `@mastra/core` bump instead of a hand-edit.
 *
 * Two providers are exceptions:
 *
 *   - **Anthropic** and **OpenAI**. Mastra's registry leaves the `url`
 *     field empty for these (`getProviderConfig('anthropic').url ===
 *     undefined` — verified live). The reason is upstream: neither
 *     `@ai-sdk/anthropic` nor `@ai-sdk/openai` exports its default
 *     base URL as a constant — both providers bake the URL into
 *     their factory closures and never expose it as a runtime
 *     property. The `models.dev` feed Mastra ingests doesn't carry
 *     the URL for them either. So the only place these two endpoints
 *     can live is here, hardcoded once with a comment explaining why.
 *
 *   - **Vercel AI Gateway**. The gateway has its own discovery API
 *     (`createGateway({apiKey}).getAvailableModels()`), so we never
 *     need a base URL constant for it.
 *
 * If `@ai-sdk/anthropic` or `@ai-sdk/openai` start exporting their
 * defaults (or Mastra's `models.dev` feed gains the field), this
 * file's two hardcoded URLs are the only thing to delete.
 */
const ANTHROPIC_API_BASE = 'https://api.anthropic.com';
const OPENAI_API_BASE = 'https://api.openai.com';

// ---------------------------------------------------------------------------
// Shared probe helpers
// ---------------------------------------------------------------------------

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const ctrl = new AbortController();
  const timeoutMs = init.timeoutMs ?? 10_000;
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function safeError(prefix: string, err: unknown): { ok: false; error: string } {
  const msg = err instanceof Error ? err.message : String(err);
  // Defensive redaction — strip anything that looks like an API key so a
  // mis-quoted error message can't echo a secret back into the UI.
  const cleaned = msg.replace(/sk[-_][\w-]{8,}/gi, '<redacted>');
  return { ok: false, error: `${prefix}: ${cleaned}` };
}

function extractOpenAiCompatibleModelIds(json: unknown): string[] {
  if (
    typeof json === 'object' &&
    json !== null &&
    'data' in json &&
    Array.isArray((json as { data: unknown }).data)
  ) {
    const arr = (json as { data: unknown[] }).data;
    return arr
      .map((m) =>
        typeof m === 'object' && m !== null && 'id' in m
          ? String((m as { id: unknown }).id)
          : null,
      )
      .filter((id): id is string => Boolean(id));
  }
  return [];
}

// ---------------------------------------------------------------------------
// Provider-specific probe implementations
// ---------------------------------------------------------------------------

async function probeVercelGateway(
  apiKey: string,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  try {
    const gateway = createGateway({ apiKey });
    const meta = await gateway.getAvailableModels();
    // The gateway returns every model regardless of modality
    // (`'language' | 'embedding' | 'image' | 'video'`). For the
    // text-provider model picker we only want chat-capable language
    // models — without this filter the dropdown bleeds image and
    // video model ids that the chat route can't actually call.
    // Verified live (255 total → 185 language / 24 embedding / 23
    // image / 23 video, zero untyped) so the strict equality is safe.
    const models = meta.models
      .filter((m) => m.modelType === 'language')
      .map((m) => m.id);
    if (models.length === 0) {
      return {
        ok: false,
        error: 'Connected, but no language models returned. Check your API access tier.',
      };
    }
    return { ok: true, models };
  } catch (err) {
    return safeError('Vercel AI Gateway connection failed', err);
  }
}

async function probeAnthropic(
  apiKey: string,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  try {
    const res = await fetchJson(`${ANTHROPIC_API_BASE}/v1/models`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Anthropic returned HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      };
    }
    // Live model list. Anthropic's /v1/models returns only Claude
    // chat models — no embeddings, no image generators, nothing to
    // filter out. We use the live response (8 entries today) instead
    // of Mastra's static registry (22 entries, includes legacy 3.x
    // and stale `-latest` aliases that don't exist on the API).
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{ id?: string; type?: string }>;
    };
    const models = (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .sort();
    if (models.length === 0) {
      return {
        ok: false,
        error: 'Connected, but no models returned. Check your API access tier.',
      };
    }
    return { ok: true, models };
  } catch (err) {
    return safeError('Anthropic connection failed', err);
  }
}

/**
 * Drop OpenAI model ids that aren't chat models. The /v1/models endpoint
 * returns 122 entries with no modality field, so we filter by id pattern.
 * The exclude list covers every non-chat surface OpenAI ships:
 *
 *   - dall-e-*, chatgpt-image-*, gpt-image-*  →  image generation
 *   - sora-*                                  →  video generation
 *   - tts-*, *-tts*                           →  text-to-speech
 *   - whisper-*, *-transcribe*                →  speech-to-text
 *   - text-embedding-*, *-embedding-*         →  embeddings
 *   - omni-moderation-*, *-moderation-*       →  moderation classifier
 *   - babbage-002, davinci-002                →  legacy completion bases
 *   - *-instruct                              →  legacy completion-only chat
 *
 * Anything not matching is kept — including realtime/search/audio chat
 * variants which are still callable as chat models.
 */
const OPENAI_NON_CHAT_PATTERN =
  /(^|[-/])(dall-e|chatgpt-image|gpt-image|sora|tts|whisper|text-embedding|omni-moderation|babbage-002|davinci-002)|(transcribe|embedding|moderation|instruct)([-]|$)/i;

function isOpenAiChatModel(id: string): boolean {
  return !OPENAI_NON_CHAT_PATTERN.test(id);
}

async function probeOpenAi(
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
    // Live fetch + pattern filter. OpenAI's /v1/models doesn't carry
    // modality metadata, so we apply an explicit non-chat exclude
    // list (see `OPENAI_NON_CHAT_PATTERN` above). Live is the right
    // source because Mastra's registry lags the latest GPT releases.
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{ id?: string }>;
    };
    const models = (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .filter(isOpenAiChatModel)
      .sort();
    if (models.length === 0) {
      return {
        ok: false,
        error: 'Connected, but no chat models returned. Check your API access tier.',
      };
    }
    return { ok: true, models };
  } catch (err) {
    return safeError('OpenAI connection failed', err);
  }
}

async function probeOpenRouter(
  apiKey: string,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  try {
    const cfg = getProviderConfig('openrouter');
    const base = cfg?.url ?? 'https://openrouter.ai/api/v1';
    const res = await fetchJson(`${base.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `OpenRouter returned HTTP ${res.status}`,
      };
    }
    // Live fetch + modality filter. OpenRouter exposes far more
    // models than Mastra's static registry knows about (351 vs 171
    // at last check), and a handful of those are image-output
    // models we don't want in a *text* picker. Each entry carries
    // `architecture.output_modalities`; we keep anything that emits
    // text and rejects anything that emits images. Multimodal entries
    // like `["text", "audio"]` (TTS-capable chat models) stay in.
    const json = (await res.json().catch(() => ({}))) as {
      data?: Array<{
        id?: string;
        architecture?: { output_modalities?: string[] };
      }>;
    };
    const models = (json.data ?? [])
      .filter((m) => {
        const outs = m.architecture?.output_modalities ?? [];
        if (outs.length === 0) return true; // permissive when missing
        return outs.includes('text') && !outs.includes('image');
      })
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .sort();
    if (models.length === 0) {
      return {
        ok: false,
        error: 'Connected, but no text models returned. Check your API access tier.',
      };
    }
    return { ok: true, models };
  } catch (err) {
    return safeError('OpenRouter connection failed', err);
  }
}

async function probeCustomOpenAiCompat(
  apiKey: string,
  baseUrl: string | undefined,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  if (!baseUrl) {
    return { ok: false, error: 'Custom provider requires a base URL' };
  }
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/models`;
    const res = await fetchJson(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Provider returned HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      };
    }
    const models = extractOpenAiCompatibleModelIds(await res.json());
    if (models.length === 0) {
      return {
        ok: false,
        error: 'Connected, but no models returned. Check your API access tier.',
      };
    }
    return { ok: true, models };
  } catch (err) {
    return safeError('Connection failed', err);
  }
}

// ---------------------------------------------------------------------------
// Descriptor list
// ---------------------------------------------------------------------------

/**
 * Closed set of text-provider IDs. Kept as a TS union so the AI SDK
 * provider switch in `resolve-language-model.ts` can exhaustively
 * dispatch on it.
 */
export type TextProviderId =
  | 'vercel-gateway'
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'custom';

export const TEXT_PROVIDERS: ProviderDescriptor[] = [
  {
    id: 'vercel-gateway',
    category: 'text',
    displayName: 'Vercel AI Gateway',
    badge: 'Recommended',
    blurb:
      'Anthropic, OpenAI, Google, and OpenRouter through one account — plus Perplexity, parallel.ai, and image/video. One key, one bill, fewer accounts to manage.',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        helpUrl: 'https://vercel.com/dashboard/ai-gateway',
      },
      {
        name: 'defaultModel',
        label: 'Default text model',
        type: 'model-select',
        required: true,
        secret: false,
        helpText:
          'Picked from the model list returned by the Vercel AI Gateway after a successful credential check.',
      },
    ],
    probe: async (values) => probeVercelGateway(String(values.apiKey ?? '')),
  },

  {
    id: 'anthropic',
    category: 'text',
    displayName: 'Anthropic',
    blurb:
      'Direct Claude API. Use this when you already have an Anthropic account or need access to features not yet on the gateway.',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        helpUrl: 'https://console.anthropic.com/settings/keys',
      },
      {
        name: 'defaultModel',
        label: 'Default text model',
        type: 'model-select',
        required: true,
        secret: false,
      },
    ],
    probe: async (values) => probeAnthropic(String(values.apiKey ?? '')),
  },

  {
    id: 'openai',
    category: 'text',
    displayName: 'OpenAI',
    blurb: 'Direct GPT API. Use this for the GPT model family.',
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
        label: 'Default text model',
        type: 'model-select',
        required: true,
        secret: false,
      },
    ],
    probe: async (values) => probeOpenAi(String(values.apiKey ?? '')),
  },

  {
    id: 'openrouter',
    category: 'text',
    displayName: 'OpenRouter',
    blurb:
      'One key, dozens of providers. Useful for experimentation; less curated than the Vercel gateway.',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        helpUrl: 'https://openrouter.ai/keys',
      },
      {
        name: 'defaultModel',
        label: 'Default text model',
        type: 'model-select',
        required: true,
        secret: false,
      },
    ],
    probe: async (values) => probeOpenRouter(String(values.apiKey ?? '')),
  },

  {
    id: 'custom',
    category: 'text',
    displayName: 'Custom (OpenAI-compatible)',
    blurb:
      'Ollama, LM Studio, vLLM, private deployments — anything that speaks the OpenAI /models + /chat/completions schema.',
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
        label: 'Default text model',
        type: 'model-select',
        required: true,
        secret: false,
      },
    ],
    probe: async (values) =>
      probeCustomOpenAiCompat(
        String(values.apiKey ?? ''),
        values.baseUrl ? String(values.baseUrl) : undefined,
      ),
  },
];
