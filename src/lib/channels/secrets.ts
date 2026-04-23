import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { appSecrets, appSecretsWithClient } from '@/mastra/lib/secret-service';

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

/**
 * Boot-time / headless variant of `channelSecrets`. Used by the channel
 * boot path in `agent-channels.ts`, which runs from
 * `instrumentation.ts` outside any request scope and therefore cannot
 * use the cookie-bound `createClient()` underpinning the request-scoped
 * surface above. Pass an explicit service-role Supabase client.
 *
 * Only the read shape (`get`) is exposed — writes always come from an
 * admin Server Action where the request-scoped path is correct.
 */
export const channelSecretsWithClient = {
  get(
    supabase: SupabaseClient,
    channelId: string,
    field: string,
  ): Promise<string | null> {
    return appSecretsWithClient.getNamespacedField(
      supabase,
      CHANNEL_SECRET_NAMESPACE,
      channelId,
      field,
    );
  },
} as const;
