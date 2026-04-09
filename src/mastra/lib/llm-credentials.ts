import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  resolveSettingsAsService,
  type LlmProvider,
} from '@/lib/settings/resolve';

import { APP_SECRET_NAMES } from './secret-service';

/**
 * Single source of truth for "what LLM credentials should this request
 * use?". Web requests call this through `mastraFor(user).getLlmCredentials()`
 * with a cookie-bound Supabase client; channel/webhook requests
 * (Telegram, cron, instrumentation) call it directly with a
 * service-role client because they have no session cookies.
 *
 * Both paths walk the same lookup chain:
 *
 *   1. `app_settings` (Tier 1, Zod-validated) → provider, model, base URL
 *   2. Tier 0 defaults from `src/lib/defaults.ts` for any missing fields
 *   3. Vault `app:llm_api_key` for the secret (only the API key needs
 *      Vault — provider/model are non-secret config)
 *
 * Throws `AppNotConfiguredError` (mapped to HTTP 503 by the API
 * boundary) if the API key is missing — that's the signal that the
 * admin setup wizard hasn't run yet.
 */

export type LlmCredentials = {
  provider: LlmProvider;
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

export async function loadLlmCredentials(
  supabase: SupabaseClient,
): Promise<LlmCredentials> {
  const settings = await resolveSettingsAsService(supabase);

  const { data: apiKey, error } = await supabase.rpc('app_secret_get', {
    p_name: APP_SECRET_NAMES.llmApiKey,
  });
  if (error) {
    throw new Error(`loadLlmCredentials: ${error.message}`);
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new AppNotConfiguredError('LLM API key');
  }

  return {
    provider: settings.llm.provider,
    apiKey,
    defaultModel: settings.llm.defaultTextModel,
    baseUrl: settings.llm.customBaseUrl,
  };
}
