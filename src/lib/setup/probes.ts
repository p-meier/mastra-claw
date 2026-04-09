import 'server-only';

import { createGateway } from '@ai-sdk/gateway';
import { getProviderConfig } from '@mastra/core/llm';

import type { LlmProvider } from '@/lib/settings/resolve';
export type { LlmProvider } from '@/lib/settings/resolve';

/**
 * Test-connection probes used by the Admin Setup wizard. Every credential
 * step in the wizard runs the matching probe via a Server Action; the
 * action only writes the secret to Vault and updates `app_settings` if
 * the probe returns `{ ok: true }`. Continue is server-validated, so the
 * client-side disabled state is just convenience — the server is the
 * authority.
 *
 * Design rules:
 *
 *  - Probes never throw. They return a structured `ProbeResult` object so
 *    the wizard can render an inline error.
 *  - Probes never log secret values. The error message must be safe to
 *    show in the UI.
 *  - Probes are pure: no DB writes, no env reads, no side effects beyond
 *    a single outbound HTTPS request to the provider's API.
 *  - On the LLM probe, we return the list of available models so the next
 *    wizard step (model picker) can populate its select without a second
 *    round-trip.
 *
 * Where the URLs and model lists come from
 * ----------------------------------------
 * We deliberately avoid scattering provider base URLs and response-shape
 * parsers across this file. Instead:
 *
 *  1. **Vercel AI Gateway** uses `createGateway({ apiKey }).getAvailableModels()`
 *     from `@ai-sdk/gateway`. The SDK owns the URL and the response shape.
 *  2. **OpenRouter** pulls its base URL from Mastra's `PROVIDER_REGISTRY`
 *     via `getProviderConfig('openrouter')`. The model list also comes
 *     from there.
 *  3. **Anthropic / OpenAI** are the only providers whose endpoint is
 *     hardcoded in this file (see `PROBE_ENDPOINTS`). Neither
 *     `@ai-sdk/anthropic` nor `@ai-sdk/openai` exposes its default base
 *     URL as a constant or runtime property, and Mastra's registry does
 *     not record one for them either — these two endpoints have no
 *     authoritative external source we could derive them from. The model
 *     list still comes from Mastra's registry.
 *  4. **Custom OpenAI-compatible endpoints** (LMStudio, vLLM, private
 *     deployments) hit the user-supplied base URL and parse the response
 *     because Mastra has no entry for private servers.
 */

export type ProbeResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Helpers
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
  // Strip anything that looks like a key from the message — defense in
  // depth so we never echo a secret back into the wizard UI.
  const cleaned = msg.replace(/sk[-_][\w-]{8,}/gi, '<redacted>');
  return { ok: false, error: `${prefix}: ${cleaned}` };
}

// ---------------------------------------------------------------------------
// LLM probe (text providers)
// ---------------------------------------------------------------------------

// `LlmProvider` is re-exported from `@/lib/settings/resolve` at the
// top of this file — that's the canonical definition shared with the
// settings resolver and the `mastraFor` facade.

export type LlmProbeResult = ProbeResult<{
  models: string[];
}>;

/**
 * Endpoints we have to hardcode because no SDK exposes them.
 *
 * `@ai-sdk/anthropic` and `@ai-sdk/openai` keep their default base URLs
 * inside the bundled provider factories and do not export them as
 * constants or attach them to the runtime provider object. Mastra's
 * `PROVIDER_REGISTRY` also leaves the `url` field empty for these two.
 * So this is the single, labeled place those URLs live.
 *
 * Used only for the connectivity probe — the model list still comes
 * from Mastra's `getProviderConfig`.
 */
const PROBE_ENDPOINTS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    headers: (apiKey: string): Record<string, string> => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
  },
  openai: {
    url: 'https://api.openai.com/v1/models',
    headers: (apiKey: string): Record<string, string> => ({
      Authorization: `Bearer ${apiKey}`,
    }),
  },
} as const;

/**
 * Validates an LLM API key and returns the list of available models so
 * the wizard's "Pick a default model" step can populate its select
 * without a second round-trip.
 *
 * For `custom` (OpenAI-compatible endpoints like Ollama, LM Studio,
 * vLLM, private deployments) the caller passes a base URL.
 */
export async function probeLlm(
  provider: LlmProvider,
  apiKey: string,
  customBaseUrl?: string | null,
): Promise<LlmProbeResult> {
  if (!apiKey || apiKey.trim().length === 0) {
    return { ok: false, error: 'API key is empty' };
  }

  try {
    // Vercel AI Gateway: the AI SDK ships a first-class helper, so we
    // never have to know the gateway URL or parse its response shape.
    if (provider === 'vercel-gateway') {
      const gateway = createGateway({ apiKey });
      const meta = await gateway.getAvailableModels();
      const models = meta.models.map((m) => m.id);
      if (models.length === 0) {
        return {
          ok: false,
          error: 'Connected, but no models returned. Check your API access tier.',
        };
      }
      return { ok: true, models };
    }

    // Custom OpenAI-compatible endpoint (LMStudio, vLLM, …): we have
    // to talk to the user-supplied base URL because Mastra has no
    // entry for private deployments.
    if (provider === 'custom') {
      if (!customBaseUrl) {
        return { ok: false, error: 'Custom provider requires a base URL' };
      }
      const url = `${customBaseUrl.replace(/\/$/, '')}/models`;
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
      const models = extractModelIds(await res.json());
      if (models.length === 0) {
        return {
          ok: false,
          error: 'Connected, but no models returned. Check your API access tier.',
        };
      }
      return { ok: true, models };
    }

    // Anthropic / OpenAI / OpenRouter: validate the key with a cheap
    // GET against the provider's /models endpoint, then return the
    // model list straight from Mastra's PROVIDER_REGISTRY (which is
    // pre-normalized — Anthropic's IDs already use the dashed form
    // accepted by /v1/messages, so no provider-specific patching).
    let probeUrl: string;
    let probeHeaders: Record<string, string>;
    if (provider === 'openrouter') {
      // Single source of truth for the URL: Mastra's registry.
      const cfg = getProviderConfig('openrouter');
      const base = cfg?.url;
      if (!base) {
        return {
          ok: false,
          error: "OpenRouter is not registered in Mastra's provider registry",
        };
      }
      probeUrl = `${base.replace(/\/$/, '')}/models`;
      probeHeaders = { Authorization: `Bearer ${apiKey}` };
    } else {
      const ep = PROBE_ENDPOINTS[provider];
      probeUrl = ep.url;
      probeHeaders = ep.headers(apiKey);
    }

    const res = await fetchJson(probeUrl, {
      method: 'GET',
      headers: probeHeaders,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Provider returned HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      };
    }
    // Drain the body so the connection can be reused. We deliberately
    // do not parse it — model IDs come from the registry below.
    await res.text().catch(() => '');

    const cfg = getProviderConfig(provider);
    const models = cfg?.models ?? [];
    if (models.length === 0) {
      return {
        ok: false,
        error: `No models registered in Mastra for provider "${provider}"`,
      };
    }
    return { ok: true, models };
  } catch (err) {
    return safeError('Connection failed', err);
  }
}

function extractModelIds(json: unknown): string[] {
  // OpenAI-compatible response shape: { data: [{ id: "..." }, ...] }.
  // Used only for the `custom` branch; the registered providers no
  // longer parse their /models response at all.
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
// ElevenLabs probe
// ---------------------------------------------------------------------------

export type ElevenlabsProbeResult = ProbeResult<{
  voiceCount: number;
}>;

export async function probeElevenlabs(
  apiKey: string,
): Promise<ElevenlabsProbeResult> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  try {
    const res = await fetchJson('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `ElevenLabs returned HTTP ${res.status}`,
      };
    }
    const json = (await res.json()) as { voices?: unknown[] };
    return { ok: true, voiceCount: Array.isArray(json.voices) ? json.voices.length : 0 };
  } catch (err) {
    return safeError('ElevenLabs connection failed', err);
  }
}

// ---------------------------------------------------------------------------
// Telegram probe
// ---------------------------------------------------------------------------

export type TelegramProbeResult = ProbeResult<{
  botUsername: string;
}>;

export async function probeTelegram(
  botToken: string,
): Promise<TelegramProbeResult> {
  if (!botToken) return { ok: false, error: 'Bot token is empty' };
  // Format check: <numeric>:<base64-ish>
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    return {
      ok: false,
      error: 'Token format looks wrong. Expected: 123456789:ABC-DEF1234ghIkl…',
    };
  }
  try {
    const res = await fetchJson(
      `https://api.telegram.org/bot${botToken}/getMe`,
      { method: 'GET' },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { username?: string };
      description?: string;
    };
    if (!res.ok || !json.ok || !json.result?.username) {
      return {
        ok: false,
        error: json.description ?? `Telegram returned HTTP ${res.status}`,
      };
    }
    return { ok: true, botUsername: json.result.username };
  } catch (err) {
    return safeError('Telegram connection failed', err);
  }
}

// ---------------------------------------------------------------------------
// Composio probe
// ---------------------------------------------------------------------------

export type ComposioProbeResult = ProbeResult;

/**
 * Validates a Composio API key by hitting the projects endpoint. We use
 * the REST API directly here instead of the @composio/core client because
 * we want a single round-trip with no side effects (the client wants to
 * eagerly initialize a session). The endpoint is documented at
 * https://docs.composio.dev/api-reference.
 */
export async function probeComposio(
  apiKey: string,
): Promise<ComposioProbeResult> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  try {
    const res = await fetchJson('https://backend.composio.dev/api/v3/toolkits', {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Composio rejected the API key' };
    }
    if (!res.ok) {
      return { ok: false, error: `Composio returned HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return safeError('Composio connection failed', err);
  }
}
