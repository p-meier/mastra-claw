import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { listChannels } from '@/lib/channels/registry';
import { DEFAULTS } from '@/lib/defaults';
import {
  PROVIDER_CATEGORIES,
  type ProviderCategory,
  getProvider,
} from '@/lib/providers/registry';
import { createClient } from '@/lib/supabase/server';

/**
 * Settings resolver.
 *
 * Walks the `app_settings` table and assembles a fully-typed
 * `ResolvedSettings` object that downstream code (the chat route, the
 * channel context loader, the agent factory) can read without knowing
 * about the underlying key/value layout.
 *
 * Schema (Tier 1 = `app_settings`):
 *
 *   app.setup_completed_at                            string ISO timestamp | null
 *   providers.{category}.active                       providerId | null
 *   providers.{category}.{providerId}.config          { ... non-secret fields ... }
 *   channels.{channelId}.configured                   boolean
 *   channels.{channelId}.config                       { ... non-secret fields, voiceEnabled }
 *   composio.configured                               boolean
 *
 * The dynamic keys (`providers.*.config`, `channels.*.config`) are
 * validated lazily by looking up the matching descriptor in the
 * registry and asserting that every required non-secret field has a
 * value. Unknown providers/channels (e.g. data left over from a
 * deleted descriptor) are skipped with a console warning rather than
 * crashing the chat route.
 *
 * Two entry points:
 *
 *  - `resolveSettings()` — cookie-bound Supabase client, cached per
 *    request via `react.cache`.
 *
 *  - `resolveSettingsAsService(supabase)` — explicit service-role
 *    client, NOT cached. For headless entry points (Telegram polling,
 *    cron, instrumentation hook).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ResolvedDescriptorConfig = {
  /** The descriptor id (e.g. `'anthropic'`, `'telegram'`). */
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

export type ResolvedChannel = {
  /** True iff the channel has at least one stored config row. */
  configured: boolean;
  /** Validated non-secret config map (includes `voiceEnabled`). */
  config: Record<string, unknown>;
};

export type ResolvedSettings = {
  app: {
    setupCompletedAt: Date | null;
  };
  providers: {
    text: ResolvedProviderCategory;
    imageVideo: ResolvedProviderCategory;
    voice: ResolvedProviderCategory;
  };
  channels: Record<string, ResolvedChannel>;
  telegram: {
    /** Tuning knob — not in `providers.*` because it's purely runtime. */
    pollingIntervalMs: number;
  };
  composio: {
    configured: boolean;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_CONFIG_KEY_RE =
  /^providers\.(text|image-video|voice)\.([^.]+)\.config$/;
const PROVIDER_ACTIVE_KEY_RE =
  /^providers\.(text|image-video|voice)\.active$/;
const CHANNEL_CONFIG_KEY_RE = /^channels\.([^.]+)\.config$/;
const CHANNEL_CONFIGURED_KEY_RE = /^channels\.([^.]+)\.configured$/;

function categoryKey(c: ProviderCategory): keyof ResolvedSettings['providers'] {
  switch (c) {
    case 'text':
      return 'text';
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
      imageVideo: emptyCategory(),
      voice: emptyCategory(),
    },
    channels: {},
    telegram: { pollingIntervalMs: DEFAULTS.telegram.pollingIntervalMs },
    composio: { configured: false },
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
    .from('app_settings')
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
  const channelConfigs: Array<{
    channelId: string;
    raw: Record<string, unknown>;
  }> = [];
  const channelConfigured = new Set<string>();

  for (const { key, value } of rows) {
    if (key === 'app.setup_completed_at') {
      if (typeof value === 'string') {
        out.app.setupCompletedAt = new Date(value);
      }
      continue;
    }

    if (key === 'composio.configured') {
      out.composio.configured = value === true;
      continue;
    }

    if (key === 'telegram.polling_interval_ms') {
      // Legacy fall-through — newer code stores this on
      // `channels.telegram.config.pollingIntervalMs`. We still honor
      // an old top-level key for one cycle in case a hand-edited row
      // exists, then prefer the channel config below.
      if (typeof value === 'number' && value > 0) {
        out.telegram.pollingIntervalMs = value;
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

    const channelConfiguredMatch = CHANNEL_CONFIGURED_KEY_RE.exec(key);
    if (channelConfiguredMatch && value === true) {
      channelConfigured.add(channelConfiguredMatch[1]);
      continue;
    }

    const channelConfigMatch = CHANNEL_CONFIG_KEY_RE.exec(key);
    if (channelConfigMatch) {
      const channelId = channelConfigMatch[1];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        channelConfigs.push({
          channelId,
          raw: value as Record<string, unknown>,
        });
      }
      continue;
    }

    // Unknown key — log once but don't crash. A row left over from a
    // deleted descriptor or a future schema addition should never take
    // down the chat route.
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[settings] ignoring unknown app_settings key: ${key}`);
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

  // Merge channel configs.
  for (const { channelId, raw } of channelConfigs) {
    const { getChannel } = await import('@/lib/channels/registry');
    const descriptor = getChannel(channelId);
    if (!descriptor) {
      console.warn(
        `[settings] no descriptor for channel ${channelId}, skipping`,
      );
      continue;
    }
    const validated = validateNonSecretConfig(descriptor, raw);
    // voiceEnabled is a meta field outside the descriptor's normal
    // field set; preserve it verbatim if present.
    if (typeof raw.voiceEnabled === 'boolean') {
      validated.voiceEnabled = raw.voiceEnabled;
    }
    out.channels[channelId] = {
      configured: true,
      config: validated,
    };
  }

  // Some channels were marked configured via the boolean key but had
  // no config row yet (e.g. wizard wrote the flag before the config).
  // Surface them as configured-but-empty so the admin UI can show a
  // re-edit prompt.
  for (const channelId of channelConfigured) {
    if (!out.channels[channelId]) {
      out.channels[channelId] = { configured: true, config: {} };
    }
  }

  // Channels override the legacy top-level Telegram polling default.
  const telegramConfig = out.channels.telegram?.config;
  if (
    telegramConfig &&
    typeof telegramConfig.pollingIntervalMs === 'number' &&
    telegramConfig.pollingIntervalMs > 0
  ) {
    out.telegram.pollingIntervalMs = telegramConfig.pollingIntervalMs;
  }

  // Make sure every channel descriptor at least appears in the map
  // (with `configured: false`) so the admin UI can render an "Add"
  // card uniformly.
  for (const channel of listChannels()) {
    if (!out.channels[channel.id]) {
      out.channels[channel.id] = { configured: false, config: {} };
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers for the admin actions layer
// ---------------------------------------------------------------------------

/**
 * Convenience helper used by Server Actions: write a single row to
 * `app_settings`. Validation against the per-key schema happens at the
 * action layer (see `src/lib/providers/actions.ts` and
 * `src/lib/channels/actions.ts`) — this helper is the raw Postgres
 * upsert.
 */
export async function upsertSetting(
  supabase: SupabaseClient,
  key: string,
  value: unknown,
): Promise<void> {
  if (value === null || value === undefined) {
    const { error } = await supabase
      .from('app_settings')
      .delete()
      .eq('key', key);
    if (error) throw new Error(`upsertSetting(${key}): ${error.message}`);
    return;
  }
  const { error } = await supabase
    .from('app_settings')
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
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`readSetting(${key}): ${error.message}`);
  return data?.value ?? null;
}
