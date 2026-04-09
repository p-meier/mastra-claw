import 'server-only';

import { appSecrets } from '@/mastra/lib/secret-service';

import { CHANNEL_SECRET_NAMESPACE } from './registry';

/**
 * Type-safe convenience wrapper for channel credentials in Vault.
 *
 * Layout: `app:channel:{channelId}:{field}`. The wrapper exists so the
 * `'channel'` namespace string is centralized — every channel action
 * goes through this surface, never raw `appSecrets.setNamespacedField`
 * with a literal namespace.
 */
export const channelSecrets = {
  set(channelId: string, field: string, value: string): Promise<void> {
    return appSecrets.setNamespacedField(
      CHANNEL_SECRET_NAMESPACE,
      channelId,
      field,
      value,
    );
  },

  get(channelId: string, field: string): Promise<string | null> {
    return appSecrets.getNamespacedField(
      CHANNEL_SECRET_NAMESPACE,
      channelId,
      field,
    );
  },

  deleteAll(channelId: string): Promise<void> {
    return appSecrets.deleteNamespace(CHANNEL_SECRET_NAMESPACE, channelId);
  },

  listFields(channelId: string): Promise<string[]> {
    return appSecrets.listFieldsInNamespace(
      CHANNEL_SECRET_NAMESPACE,
      channelId,
    );
  },
} as const;
