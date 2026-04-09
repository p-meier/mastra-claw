import 'server-only';

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

export type LlmProvider =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'vercel-gateway'
  | 'custom';

export type LlmProbeResult = ProbeResult<{
  models: string[];
}>;

/**
 * Validates an LLM API key by listing available models. The endpoint
 * differs per provider; we normalize the response to a list of model
 * IDs so the wizard's "Pick a default model" step can populate its
 * select directly.
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
    let url: string;
    let headers: Record<string, string>;

    switch (provider) {
      case 'anthropic':
        url = 'https://api.anthropic.com/v1/models';
        headers = {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        };
        break;
      case 'openai':
        url = 'https://api.openai.com/v1/models';
        headers = { Authorization: `Bearer ${apiKey}` };
        break;
      case 'openrouter':
        url = 'https://openrouter.ai/api/v1/models';
        headers = { Authorization: `Bearer ${apiKey}` };
        break;
      case 'vercel-gateway':
        url = 'https://ai-gateway.vercel.sh/v1/models';
        headers = { Authorization: `Bearer ${apiKey}` };
        break;
      case 'custom': {
        if (!customBaseUrl) {
          return {
            ok: false,
            error: 'Custom provider requires a base URL',
          };
        }
        url = `${customBaseUrl.replace(/\/$/, '')}/v1/models`;
        headers = { Authorization: `Bearer ${apiKey}` };
        break;
      }
    }

    const res = await fetchJson(url, { method: 'GET', headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Provider returned HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`,
      };
    }

    const json = (await res.json()) as unknown;
    const models = extractModelIds(json);
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

function extractModelIds(json: unknown): string[] {
  // Most providers (OpenAI / OpenRouter / Vercel Gateway / OpenAI-compat)
  // return { data: [{ id: "..." }, ...] }. Anthropic returns
  // { data: [{ id: "...", type: "model", ... }] }.
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
