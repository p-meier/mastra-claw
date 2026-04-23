import 'server-only';

import { cache } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

/**
 * SecretService — the *only* surface application code uses to read/write
 * secrets in Supabase Vault.
 *
 * Two namespaces, mirroring ARCHITECTURE.md §11 (post-revision):
 *
 *   appSecrets    Layer B   `app:<name>`             admin-only
 *   userSecrets   Layer C   `user:<userId>:<name>`   per-user, scoped to auth.uid()
 *
 * Both surfaces dispatch to SECURITY DEFINER functions defined in
 * `supabase/migrations/20260408195437_onboarding.sql`. Those functions
 * enforce the role/ownership check internally — even an authenticated
 * user calling them via raw `supabase.rpc(...)` cannot bypass the
 * boundary. SecretService is just the typed application-side facade.
 *
 * Design notes:
 *
 * - Reads are wrapped in `react.cache` so a Server Component or Server
 *   Action that reads the same secret twice in one request only hits
 *   the database once. Writes invalidate by being separate non-cached
 *   functions.
 *
 * - We deliberately do NOT add a 5-minute in-memory TTL cache here yet.
 *   That's an optimization once we measure latency under real load.
 *
 * - Errors are surfaced as thrown exceptions. Server Actions that call
 *   these should catch + render a user-friendly error in the wizard UI.
 *
 * - Naming convention: callers pass the *unprefixed* name (e.g.
 *   `'llm_api_key'`). The full Vault name (`'app:llm_api_key'` or
 *   `'user:<uuid>:llm_api_key'`) is built inside the SQL function so
 *   callers cannot escape their namespace by passing a colon-laden name.
 */

// ---------------------------------------------------------------------------
// Internal RPC helpers
// ---------------------------------------------------------------------------

async function rpcAppSecretSet(name: string, value: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('app_secret_set', {
    p_name: name,
    p_value: value,
  });
  if (error) {
    throw new Error(`appSecrets.set(${name}) failed: ${error.message}`);
  }
}

const rpcAppSecretGet = cache(async (name: string): Promise<string | null> => {
  const supabase = await createClient();
  return rpcAppSecretGetWithClient(supabase, name);
});

/**
 * Boot-time / headless variant of `rpcAppSecretGet`. Takes an explicit
 * Supabase client (typically `createServiceClient()`) instead of
 * constructing one from the request cookies — `cookies()` throws
 * outside a request scope, which crashes `instrumentation.ts` on boot.
 *
 * Not wrapped in `react.cache`: that helper itself requires a request
 * scope and would throw the same way at module load.
 */
async function rpcAppSecretGetWithClient(
  supabase: SupabaseClient,
  name: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('app_secret_get', { p_name: name });
  if (error) {
    throw new Error(`appSecrets.get(${name}) failed: ${error.message}`);
  }
  // RPC returns the text value directly; null if not present.
  return (data as string | null) ?? null;
}

async function rpcAppSecretDelete(name: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('app_secret_delete', { p_name: name });
  if (error) {
    throw new Error(`appSecrets.delete(${name}) failed: ${error.message}`);
  }
}

const rpcAppSecretList = cache(async (): Promise<string[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('app_secret_list');
  if (error) {
    throw new Error(`appSecrets.list() failed: ${error.message}`);
  }
  // RETURNS TABLE (name text) → array of { name }
  return ((data as { name: string }[] | null) ?? []).map((r) => r.name);
});

async function rpcUserSecretSet(name: string, value: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('user_secret_set', {
    p_name: name,
    p_value: value,
  });
  if (error) {
    throw new Error(`userSecrets.set(${name}) failed: ${error.message}`);
  }
}

const rpcUserSecretGet = cache(
  async (name: string): Promise<string | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('user_secret_get', {
      p_name: name,
    });
    if (error) {
      throw new Error(`userSecrets.get(${name}) failed: ${error.message}`);
    }
    return (data as string | null) ?? null;
  },
);

async function rpcUserSecretDelete(name: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('user_secret_delete', { p_name: name });
  if (error) {
    throw new Error(`userSecrets.delete(${name}) failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Public surfaces
// ---------------------------------------------------------------------------

/**
 * App-level secrets (Layer B). Admin-only at the database boundary.
 *
 * The admin-role check happens twice:
 *  1. In every Server Action / Route Handler call site, via
 *     `requireAdmin()` (defense in depth, makes intent visible).
 *  2. Inside the SQL function, via `is_admin()` against the JWT.
 *
 * Calling these from a non-admin context throws.
 */
export const appSecrets = {
  set: rpcAppSecretSet,
  get: rpcAppSecretGet,
  delete: rpcAppSecretDelete,
  list: rpcAppSecretList,

  // ---------------------------------------------------------------------
  // Namespaced helpers
  // ---------------------------------------------------------------------
  //
  // The provider/channel registries store many secrets per descriptor:
  //   provider:text:anthropic:apiKey
  //   provider:tts:elevenlabs:apiKey
  //   channel:slack:botToken
  //   channel:slack:signingSecret
  //
  // Rather than minting one named constant per (descriptor, field), we
  // namespace the Vault key. The helpers below build the canonical name
  // and dispatch to the same RPCs as the unnamespaced API.
  //
  // The namespace string is a free-form path with `:` separators
  // (e.g. `'provider:text'` or `'channel'`). We never echo `:` from
  // user input — descriptor IDs and field names are validated against
  // their registry before they reach this layer.

  /** Build the unprefixed Vault name `<namespace>:<id>:<field>`. */
  buildName(namespace: string, id: string, field: string): string {
    return `${namespace}:${id}:${field}`;
  },

  async setNamespacedField(
    namespace: string,
    id: string,
    field: string,
    value: string,
  ): Promise<void> {
    return rpcAppSecretSet(
      appSecrets.buildName(namespace, id, field),
      value,
    );
  },

  async getNamespacedField(
    namespace: string,
    id: string,
    field: string,
  ): Promise<string | null> {
    return rpcAppSecretGet(appSecrets.buildName(namespace, id, field));
  },

  /**
   * Delete every secret stored under `<namespace>:<id>:*`. Used when an
   * admin removes a configured provider/channel.
   */
  async deleteNamespace(namespace: string, id: string): Promise<void> {
    const prefix = `${namespace}:${id}:`;
    const all = await rpcAppSecretList();
    await Promise.all(
      all
        .filter((name) => name.startsWith(prefix))
        .map((name) => rpcAppSecretDelete(name)),
    );
  },

  /**
   * List the field names that currently have a stored value under
   * `<namespace>:<id>`. The returned strings are *just* the field
   * portion (everything after the trailing `:`), suitable for building
   * the SecretFieldStatus map that the edit form consumes.
   */
  async listFieldsInNamespace(
    namespace: string,
    id: string,
  ): Promise<string[]> {
    const prefix = `${namespace}:${id}:`;
    const all = await rpcAppSecretList();
    return all
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length));
  },
} as const;

/**
 * Boot-time / headless read surface for app secrets. Mirrors the
 * `appSecrets.get*` shape but takes an explicit Supabase client as the
 * first argument. Use this when there is no request scope to read
 * cookies from — i.e. `instrumentation.ts` and the channel boot path in
 * `agent-channels.ts`.
 *
 * Read-only by design: writes always come from an admin Server Action,
 * which runs inside a request scope and uses `appSecrets.set*` instead.
 *
 * The underlying RPC (`app_secret_get`) is `SECURITY DEFINER` and gates
 * itself with `is_admin()`, which exempts the `service_role` JWT (see
 * `supabase/migrations/20260409120255_is_admin_service_role_bypass.sql`).
 * Passing a non-service-role client here will throw the same admin
 * check the cookie path enforces.
 */
export const appSecretsWithClient = {
  get(supabase: SupabaseClient, name: string): Promise<string | null> {
    return rpcAppSecretGetWithClient(supabase, name);
  },

  getNamespacedField(
    supabase: SupabaseClient,
    namespace: string,
    id: string,
    field: string,
  ): Promise<string | null> {
    return rpcAppSecretGetWithClient(
      supabase,
      appSecrets.buildName(namespace, id, field),
    );
  },
} as const;

/**
 * Per-user secrets (Layer C). Scoped to the calling user's `auth.uid()`.
 * No admin override — admins reading another user's secrets must do so
 * via dedicated admin tooling, not through this surface.
 *
 * Phase 1: structurally ready, no UI wires this in yet. Kept on the
 * SecretService surface so future per-user override work has a stable
 * place to plug into.
 */
export const userSecrets = {
  set: rpcUserSecretSet,
  get: rpcUserSecretGet,
  delete: rpcUserSecretDelete,
} as const;

// ---------------------------------------------------------------------------
// Canonical secret names
// ---------------------------------------------------------------------------
//
// Keep these as a closed enum so a typo in a wizard step doesn't write
// `app:llm_api_keyy` and silently break the chat route handler.

export const APP_SECRET_NAMES = {
  llmApiKey: 'llm_api_key',
  imageVideoApiKey: 'image_video_api_key',
  elevenlabsApiKey: 'elevenlabs_api_key',
} as const;

export type AppSecretName = (typeof APP_SECRET_NAMES)[keyof typeof APP_SECRET_NAMES];
