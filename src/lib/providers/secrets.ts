import 'server-only';

import { appSecrets } from '@/mastra/lib/secret-service';

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
