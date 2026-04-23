import 'server-only';

/**
 * Read-API for the platform's provider configuration. Designed to be
 * imported by agent code running inside the Mastra runtime.
 *
 * The contract:
 *
 *   import { getActiveProvider } from '@/lib/platform-providers';
 *   const sb = await createServiceClient();
 *   const active = await getActiveProvider(sb, 'text');
 *   if (!active) throw new Error('No text provider configured yet.');
 *   // active.id       → 'anthropic'
 *   // active.config   → { defaultModel: 'claude-sonnet-4', ... }
 *   // active.secrets  → { apiKey: 'sk-...' }
 *
 * The `supabase` client must be constructed with the **service-role**
 * key so that `is_admin()` inside the `app_secret_get` RPC succeeds
 * (it has an unconditional `auth.role() = 'service_role'` bypass).
 * Calling with a cookie-bound anon client from a non-admin session
 * will throw.
 *
 * No probe, no validation, no provider-registry lookups — pure DB read.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActiveProvider, ProviderCategory } from './types';

// ---------------------------------------------------------------------------
// Active provider resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the active provider for a category, including its non-secret
 * config (from `platform_settings`) and all stored secrets (from Vault via
 * the `app_secret_get` RPC).
 *
 * Returns `null` when:
 *   - no provider is marked active for this category, OR
 *   - the active pointer references a provider that has no config row
 *     (corrupt state; logged to stderr but not thrown).
 *
 * Throws when the underlying Supabase query errors.
 */
export async function getActiveProvider(
  supabase: SupabaseClient,
  category: ProviderCategory,
): Promise<ActiveProvider | null> {
  const activeKey = `providers.${category}.active`;
  const { data: activeRow, error: activeErr } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', activeKey)
    .maybeSingle();

  if (activeErr) {
    throw new Error(
      `getActiveProvider(${category}): failed to read active pointer: ${activeErr.message}`,
    );
  }

  const activeId = typeof activeRow?.value === 'string' ? activeRow.value : null;
  if (!activeId) return null;

  const configKey = `providers.${category}.${activeId}.config`;
  const { data: configRow, error: configErr } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', configKey)
    .maybeSingle();

  if (configErr) {
    throw new Error(
      `getActiveProvider(${category}): failed to read config for ${activeId}: ${configErr.message}`,
    );
  }

  if (!configRow) {
    // eslint-disable-next-line no-console
    console.warn(
      `[platform-providers] providers.${category}.active = ${activeId} but no config row; returning null`,
    );
    return null;
  }

  const config =
    configRow.value && typeof configRow.value === 'object' && !Array.isArray(configRow.value)
      ? (configRow.value as Record<string, unknown>)
      : {};

  const secrets = await listSecretsForProvider(supabase, category, activeId);

  return { id: activeId, config, secrets };
}

/**
 * Low-level single-secret read. Exposed for callers that already know
 * the descriptor-field name.
 */
export async function getProviderSecret(
  supabase: SupabaseClient,
  category: ProviderCategory,
  providerId: string,
  field: string,
): Promise<string | null> {
  const name = buildVaultName(category, providerId, field);
  const { data, error } = await supabase.rpc('app_secret_get', { p_name: name });
  if (error) {
    throw new Error(
      `getProviderSecret(${category}/${providerId}/${field}) failed: ${error.message}`,
    );
  }
  return (data as string | null) ?? null;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** `provider:{category}:{providerId}:{field}` — the Vault-key convention. */
function buildVaultName(category: ProviderCategory, providerId: string, field: string): string {
  return `provider:${category}:${providerId}:${field}`;
}

/**
 * List + fetch every secret for (category, providerId). Uses
 * `app_secret_list` to enumerate names and `app_secret_get` per hit.
 * The write path never stores anything outside the
 * `provider:{category}:{providerId}:*` namespace so this list is bounded
 * by the descriptor's secret fields (1–3 entries typically).
 */
async function listSecretsForProvider(
  supabase: SupabaseClient,
  category: ProviderCategory,
  providerId: string,
): Promise<Record<string, string>> {
  const prefix = `provider:${category}:${providerId}:`;
  const { data: listData, error: listErr } = await supabase.rpc('app_secret_list');
  if (listErr) {
    throw new Error(
      `getActiveProvider: failed to list secrets for ${category}/${providerId}: ${listErr.message}`,
    );
  }

  const rows = (listData as { name: string }[] | null) ?? [];
  const fieldNames = rows
    .map((r) => r.name)
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length));

  const out: Record<string, string> = {};
  for (const field of fieldNames) {
    const { data, error } = await supabase.rpc('app_secret_get', {
      p_name: `${prefix}${field}`,
    });
    if (error) {
      throw new Error(
        `getActiveProvider: failed to read secret ${category}/${providerId}/${field}: ${error.message}`,
      );
    }
    if (typeof data === 'string' && data.length > 0) {
      out[field] = data;
    }
  }
  return out;
}
