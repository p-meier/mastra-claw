import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { appSecrets, appSecretsWithClient } from '@/mastra/lib/secret-service';

import {
  type ProviderCategory,
  providerSecretNamespace,
} from './registry';

/**
 * Type-safe convenience wrapper around `appSecrets.*NamespacedField`
 * for provider credentials. Keeps the namespace string in one place
 * (`providerSecretNamespace(category)`) so a typo in `'provider:text'`
 * vs `'providers:text'` cannot leak across the codebase.
 */
export const providerSecrets = {
  set(
    category: ProviderCategory,
    providerId: string,
    field: string,
    value: string,
  ): Promise<void> {
    return appSecrets.setNamespacedField(
      providerSecretNamespace(category),
      providerId,
      field,
      value,
    );
  },

  get(
    category: ProviderCategory,
    providerId: string,
    field: string,
  ): Promise<string | null> {
    return appSecrets.getNamespacedField(
      providerSecretNamespace(category),
      providerId,
      field,
    );
  },

  deleteAll(category: ProviderCategory, providerId: string): Promise<void> {
    return appSecrets.deleteNamespace(
      providerSecretNamespace(category),
      providerId,
    );
  },

  listFields(
    category: ProviderCategory,
    providerId: string,
  ): Promise<string[]> {
    return appSecrets.listFieldsInNamespace(
      providerSecretNamespace(category),
      providerId,
    );
  },
} as const;

/**
 * Boot-time / headless variant of `providerSecrets`. Channel adapters
 * (Telegram polling, etc.) handle messages outside any HTTP request
 * scope, so the cookie-bound `appSecrets.get*` path throws
 * `cookies() outside a request scope`. Pass an explicit service-role
 * Supabase client (from `createServiceClient()`) instead.
 *
 * Read-only by design — writes always come from an admin Server Action
 * that runs inside a request scope and uses `providerSecrets.set`.
 */
export const providerSecretsWithClient = {
  get(
    supabase: SupabaseClient,
    category: ProviderCategory,
    providerId: string,
    field: string,
  ): Promise<string | null> {
    return appSecretsWithClient.getNamespacedField(
      supabase,
      providerSecretNamespace(category),
      providerId,
      field,
    );
  },
} as const;
