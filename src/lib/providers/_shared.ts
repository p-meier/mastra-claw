import 'server-only';

import type {
  DescriptorProbeExtras,
  ProbeResult,
} from '@/lib/descriptors/types';

/**
 * Probe helpers shared by text + embedding + future provider descriptor
 * files. Kept separate so adding a new descriptor in
 * `src/lib/providers/` doesn't force another inline copy of these four
 * utilities.
 *
 * Every probe in this codebase must:
 *   - Never throw — return `{ ok: false, error }` on any failure.
 *   - Redact API-key shapes from error messages (`safeError` handles it).
 *   - Time-bound the request via `fetchJson`'s AbortController.
 */

export async function fetchJson(
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

export function safeError(
  prefix: string,
  err: unknown,
): { ok: false; error: string } {
  const msg = err instanceof Error ? err.message : String(err);
  // Defensive redaction — strip anything that looks like an API key so
  // a mis-quoted error message can't echo a secret back into the UI.
  const cleaned = msg.replace(/sk[-_][\w-]{8,}/gi, '<redacted>');
  return { ok: false, error: `${prefix}: ${cleaned}` };
}

export function extractOpenAiCompatibleModelIds(json: unknown): string[] {
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

/**
 * Probe helper for any OpenAI-compatible endpoint: accepts a base URL
 * and bearer token, fetches `/models`, extracts model ids. Used by the
 * `custom` text and embedding descriptors.
 */
export async function probeCustomOpenAiCompat(
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
