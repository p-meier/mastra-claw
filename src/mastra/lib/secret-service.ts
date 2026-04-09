import 'server-only';

import { cache } from 'react';

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
  const { data, error } = await supabase.rpc('app_secret_get', { p_name: name });
  if (error) {
    throw new Error(`appSecrets.get(${name}) failed: ${error.message}`);
  }
  // RPC returns the text value directly; null if not present.
  return (data as string | null) ?? null;
});

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
  telegramBotToken: 'telegram_bot_token',
  composioApiKey: 'composio_api_key',
} as const;

export type AppSecretName = (typeof APP_SECRET_NAMES)[keyof typeof APP_SECRET_NAMES];
