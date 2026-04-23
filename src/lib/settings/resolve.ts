import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import {
  PROVIDER_CATEGORIES,
  type ProviderCategory,
  getProvider,
} from '@/lib/providers/registry';
import { createClient } from '@/lib/supabase/server';

/**
 * Settings resolver.
 *
 * Walks the `platform_settings` table and assembles a fully-typed
 * `ResolvedSettings` object that downstream code (the chat route, the
 * agent factory) can read without knowing about the underlying
 * key/value layout.
 *
 * Schema (Tier 1 = `platform_settings`):
 *
 *   app.setup_completed_at                            string ISO timestamp | null
 *   providers.{category}.active                       providerId | null
 *   providers.{category}.{providerId}.config          { ... non-secret fields ... }
 *
 * Two entry points:
 *
 *  - `resolveSettings()` — cookie-bound Supabase client, cached per
 *    request via `react.cache`.
 *
 *  - `resolveSettingsAsService(supabase)` — explicit service-role
 *    client, NOT cached. For headless entry points (cron,
 *    instrumentation hook).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ResolvedDescriptorConfig = {
  /** The descriptor id (e.g. `'anthropic'`). */
  id: string;
  /** Validated non-secret config map. Empty `{}` if no fields. */
  config: Record<string, unknown>;
};

export type ResolvedProviderCategory = {
  /**
   * The active provider for this category, or `null` when no admin
   * has configured one yet (which is normal until the setup wizard
   * runs at least one category through).
   */
  active: ResolvedDescriptorConfig | null;
  /**
   * Every provider id in this category that has a stored config
   * (whether or not it's currently active). Used by the admin UI to
   * show "configured but not active" providers as switchable.
   */
  configured: string[];
};

export type ResolvedSettings = {
  app: {
    setupCompletedAt: Date | null;
  };
  providers: {
    text: ResolvedProviderCategory;
    embedding: ResolvedProviderCategory;
    imageVideo: ResolvedProviderCategory;
    voice: ResolvedProviderCategory;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_CONFIG_KEY_RE =
  /^providers\.(text|embedding|image-video|voice)\.([^.]+)\.config$/;
const PROVIDER_ACTIVE_KEY_RE =
  /^providers\.(text|embedding|image-video|voice)\.active$/;

// Keys that older mastra-claw installs seeded or wrote and which the
// refactor no longer reads. Skipped without warning so the log stays
// clean; a future cleanup migration removes the rows entirely.
const HISTORICAL_KEYS: ReadonlySet<string> = new Set([
  'composio.configured',
  'telegram.configured',
  'telegram.polling_interval_ms',
  'elevenlabs.configured',
  'elevenlabs.voice_id_override',
  'elevenlabs.model_id_override',
]);

const HISTORICAL_KEY_PREFIXES: readonly string[] = ['channels.'];

function isHistoricalKey(key: string): boolean {
  if (HISTORICAL_KEYS.has(key)) return true;
  return HISTORICAL_KEY_PREFIXES.some((p) => key.startsWith(p));
}

function categoryKey(c: ProviderCategory): keyof ResolvedSettings['providers'] {
  switch (c) {
    case 'text':
      return 'text';
    case 'embedding':
      return 'embedding';
    case 'image-video':
      return 'imageVideo';
    case 'voice':
      return 'voice';
  }
}

/** Validate a non-secret config object against a descriptor's field set. */
function validateNonSecretConfig(
  descriptor: { fields: { name: string; secret: boolean; required: boolean }[] },
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of descriptor.fields) {
    if (field.secret) continue;
    const value = raw[field.name];
    if (value !== undefined && value !== null) {
      out[field.name] = value;
    }
  }
  return out;
}

function emptyCategory(): ResolvedProviderCategory {
  return { active: null, configured: [] };
}

function emptyResolvedSettings(): ResolvedSettings {
  return {
    app: { setupCompletedAt: null },
    providers: {
      text: emptyCategory(),
      embedding: emptyCategory(),
      imageVideo: emptyCategory(),
      voice: emptyCategory(),
    },
  };
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export const resolveSettings = cache(
  async (): Promise<ResolvedSettings> => {
    const supabase = await createClient();
    return resolveSettingsAsService(supabase);
  },
);

export async function resolveSettingsAsService(
  supabase: SupabaseClient,
): Promise<ResolvedSettings> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('key, value');

  if (error) {
    throw new Error(`resolveSettings: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ key: string; value: unknown }>;
  const out = emptyResolvedSettings();

  // Bucket the rows by their semantic role first; we'll merge config
  // rows after the active pointers are known so the lookup is O(1).
  const activeByCategory: Partial<Record<ProviderCategory, string>> = {};
  const providerConfigs: Array<{
    category: ProviderCategory;
    providerId: string;
    raw: Record<string, unknown>;
  }> = [];

  for (const { key, value } of rows) {
    if (key === 'app.setup_completed_at') {
      if (typeof value === 'string') {
        out.app.setupCompletedAt = new Date(value);
      }
      continue;
    }

    const activeMatch = PROVIDER_ACTIVE_KEY_RE.exec(key);
    if (activeMatch) {
      const category = activeMatch[1] as ProviderCategory;
      if (typeof value === 'string' && value.length > 0) {
        activeByCategory[category] = value;
      }
      continue;
    }

    const providerConfigMatch = PROVIDER_CONFIG_KEY_RE.exec(key);
    if (providerConfigMatch) {
      const category = providerConfigMatch[1] as ProviderCategory;
      const providerId = providerConfigMatch[2];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        providerConfigs.push({
          category,
          providerId,
          raw: value as Record<string, unknown>,
        });
      }
      continue;
    }

    // `organization` is handled by `src/lib/organization.ts`, not
    // this resolver. Historical keys (`composio.configured`,
    // `telegram.*`, `channels.*`, etc.) from earlier schema shapes
    // are silently ignored — they can survive in long-lived installs
    // and are not worth logging every request. Any truly unknown key
    // still gets a dev-only warning.
    if (key === 'organization' || isHistoricalKey(key)) {
      continue;
    }
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[settings] ignoring unknown platform_settings key: ${key}`);
    }
  }

  // Merge provider configs into the resolved object.
  for (const { category, providerId, raw } of providerConfigs) {
    const descriptor = getProvider(category, providerId);
    if (!descriptor) {
      console.warn(
        `[settings] no descriptor for provider ${category}/${providerId}, skipping`,
      );
      continue;
    }
    const slot = out.providers[categoryKey(category)];
    slot.configured.push(providerId);
    if (activeByCategory[category] === providerId) {
      slot.active = {
        id: providerId,
        config: validateNonSecretConfig(descriptor, raw),
      };
    }
  }

  // For each category, log when an `active` pointer references a
  // provider that has no config row — that's a corrupt state and we
  // surface it as `null` so call sites fall back to "no provider".
  for (const category of PROVIDER_CATEGORIES) {
    const targetId = activeByCategory[category];
    const slot = out.providers[categoryKey(category)];
    if (targetId && !slot.active) {
      console.warn(
        `[settings] providers.${category}.active = ${targetId} but no config row exists`,
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers for the admin actions layer
// ---------------------------------------------------------------------------

/**
 * Convenience helper used by Server Actions: write a single row to
 * `platform_settings`. Validation against the per-key schema happens at the
 * action layer (see `src/lib/providers/actions.ts`) — this helper is
 * the raw Postgres upsert.
 */
export async function upsertSetting(
  supabase: SupabaseClient,
  key: string,
  value: unknown,
): Promise<void> {
  if (value === null || value === undefined) {
    const { error } = await supabase
      .from('platform_settings')
      .delete()
      .eq('key', key);
    if (error) throw new Error(`upsertSetting(${key}): ${error.message}`);
    return;
  }
  const { error } = await supabase
    .from('platform_settings')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw new Error(`upsertSetting(${key}): ${error.message}`);
}

/**
 * Read a single row's raw value (or `null` if missing). Used by the
 * admin UI to render "default" vs "overridden" badges.
 */
export async function readSetting(
  supabase: SupabaseClient,
  key: string,
): Promise<unknown | null> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`readSetting(${key}): ${error.message}`);
  return data?.value ?? null;
}
