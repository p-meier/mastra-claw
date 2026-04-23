import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { providerSecretsWithClient } from '@/lib/providers/secrets';
import type { TextProviderId } from '@/lib/providers/text';
import { resolveSettingsAsService } from '@/lib/settings/resolve';

/**
 * Single source of truth for "what LLM credentials should this request
 * use?". Web requests call this through `mastraFor(user).getLlmCredentials()`
 * with a cookie-bound Supabase client; channel/webhook requests
 * (Telegram polling, cron, instrumentation) call it directly with a
 * service-role client because they have no session cookies.
 *
 * The lookup chain after the provider/channel refactor:
 *
 *   1. `resolveSettingsAsService(supabase)` → which provider is active
 *      for the `text` category and what non-secret config it has.
 *   2. `providerSecrets.get('text', activeId, 'apiKey')` → API key from
 *      the namespaced Vault entry written by the admin setup wizard or
 *      `/admin/settings`.
 *   3. The validated config map carries the rest (`defaultModel`, and
 *      for `custom` providers a `baseUrl`).
 *
 * Throws `AppNotConfiguredError` (mapped to HTTP 503 by the API
 * boundary) if no text provider is configured or if its API key is
 * missing — that's the signal that the admin setup wizard hasn't run
 * yet.
 */

export type LlmCredentials = {
  provider: TextProviderId;
  apiKey: string;
  defaultModel: string;
  baseUrl: string | null;
};

export class AppNotConfiguredError extends Error {
  constructor(what: string) {
    super(`MastraClaw is not yet configured: ${what} missing`);
    this.name = 'AppNotConfiguredError';
  }
}

const KNOWN_TEXT_PROVIDERS: readonly TextProviderId[] = [
  'vercel-gateway',
  'anthropic',
  'openai',
  'openrouter',
  'custom',
] as const;

function assertTextProviderId(id: string): TextProviderId {
  if ((KNOWN_TEXT_PROVIDERS as readonly string[]).includes(id)) {
    return id as TextProviderId;
  }
  throw new AppNotConfiguredError(`unknown text provider "${id}"`);
}

export async function loadLlmCredentials(
  supabase: SupabaseClient,
): Promise<LlmCredentials> {
  const settings = await resolveSettingsAsService(supabase);
  const active = settings.providers.text.active;
  if (!active) {
    throw new AppNotConfiguredError('active text provider');
  }

  const provider = assertTextProviderId(active.id);
  const defaultModel = String(active.config.defaultModel ?? '');
  if (!defaultModel) {
    throw new AppNotConfiguredError(
      `default model for text provider ${active.id}`,
    );
  }

  const apiKey = await providerSecretsWithClient.get(
    supabase,
    'text',
    active.id,
    'apiKey',
  );
  if (!apiKey) {
    throw new AppNotConfiguredError(
      `API key for text provider ${active.id}`,
    );
  }

  const baseUrl =
    typeof active.config.baseUrl === 'string' && active.config.baseUrl.length > 0
      ? active.config.baseUrl
      : null;

  return { provider, apiKey, defaultModel, baseUrl };
}
