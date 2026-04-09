import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';
import { z } from 'zod';

import { DEFAULTS } from '@/lib/defaults';
import { createClient } from '@/lib/supabase/server';

/**
 * Tier 1 — `app_settings` resolver.
 *
 * Reads every known key from `public.app_settings`, validates each
 * value against a Zod schema, and merges the result over the Tier 0
 * defaults from `src/lib/defaults.ts`. Returns a fully-defined object —
 * call sites never have to handle a `null` for fields that have a
 * default.
 *
 * Two entry points:
 *
 *  - `resolveSettings()` — cookie-bound Supabase client, cached per
 *    request via `react.cache`. The `app_settings` RLS policy is
 *    admin-only for writes; reads are also gated, but every server
 *    component / server action that calls this is already running in
 *    a context where the caller's role is established. The chat route
 *    needs read access for non-admin users, so the underlying RLS
 *    policy must allow it (see migration 20260408195437 — read access
 *    is implicit on `app_settings` for any authenticated user; only
 *    write is admin-gated).
 *
 *  - `resolveSettingsAsService(supabase)` — explicit service-role
 *    client, NOT cached. For headless entry points (Telegram webhook,
 *    cron, instrumentation) that have no cookies and no React lifecycle.
 *
 * Adding a new key? Touch this file (`settingValueSchema` + the
 * `merge()` mapping) and `src/lib/defaults.ts`. That's it — no new
 * SQL, no migration. The `app_settings` table is generic key/value.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const llmProviderSchema = z.enum([
  'anthropic',
  'openai',
  'openrouter',
  'vercel-gateway',
  'custom',
]);
export type LlmProvider = z.infer<typeof llmProviderSchema>;

export type ResolvedSettings = {
  app: {
    setupCompletedAt: Date | null;
  };
  llm: {
    provider: LlmProvider;
    defaultTextModel: string;
    customBaseUrl: string | null;
  };
  imageVideo: {
    provider: 'vercel-gateway' | null;
    baseUrl: string | null;
  };
  elevenlabs: {
    voiceId: string;
    modelId: string;
    configured: boolean;
  };
  telegram: {
    pollingIntervalMs: number;
    configured: boolean;
  };
  composio: {
    configured: boolean;
  };
};

// ---------------------------------------------------------------------------
// Schema for validated overrides
// ---------------------------------------------------------------------------
//
// Every key the resolver knows about must appear here with its expected
// shape. `.nullable().optional()` is the standard form because the
// underlying column is `jsonb` and a row may be missing or explicitly
// `null` (admin cleared the override).

const settingValueSchema = z
  .object({
    'app.setup_completed_at': z.string().nullable().optional(),

    'llm.default_provider': llmProviderSchema.nullable().optional(),
    'llm.default_text_model': z.string().min(1).nullable().optional(),
    'llm.custom_base_url': z.string().url().nullable().optional(),

    'image_video.provider': z
      .enum(['vercel-gateway'])
      .nullable()
      .optional(),
    'image_video.base_url': z.string().url().nullable().optional(),

    'elevenlabs.voice_id': z.string().min(1).nullable().optional(),
    'elevenlabs.model_id': z.string().min(1).nullable().optional(),
    'elevenlabs.configured': z.boolean().nullable().optional(),

    'telegram.polling_interval_ms': z
      .number()
      .int()
      .positive()
      .nullable()
      .optional(),
    'telegram.configured': z.boolean().nullable().optional(),

    'composio.configured': z.boolean().nullable().optional(),
  })
  .partial();

type SettingsRecord = z.infer<typeof settingValueSchema>;

/** Every editable settings key. Used by the admin settings UI. */
export const SETTINGS_KEYS = Object.keys(settingValueSchema.shape) as Array<
  keyof SettingsRecord
>;
export type SettingKey = (typeof SETTINGS_KEYS)[number];

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export const resolveSettings = cache(async (): Promise<ResolvedSettings> => {
  const supabase = await createClient();
  return resolveSettingsAsService(supabase);
});

export async function resolveSettingsAsService(
  supabase: SupabaseClient,
): Promise<ResolvedSettings> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value');

  if (error) {
    throw new Error(`resolveSettings: ${error.message}`);
  }

  const raw: Record<string, unknown> = {};
  for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
    raw[row.key] = row.value;
  }

  // safeParse — a malformed row in `app_settings` should NOT crash the
  // chat route. Log it, fall back to defaults for the affected key, and
  // let the admin notice via the settings UI (which renders the same
  // schema and surfaces validation errors).
  const parsed = settingValueSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      '[settings] invalid app_settings row(s) — falling back to defaults',
      parsed.error.issues,
    );
  }
  const overrides: SettingsRecord = parsed.success ? parsed.data : {};

  return merge(overrides);
}

function merge(o: SettingsRecord): ResolvedSettings {
  const setupAt = o['app.setup_completed_at'];

  return {
    app: {
      setupCompletedAt: setupAt ? new Date(setupAt) : null,
    },
    llm: {
      provider: o['llm.default_provider'] ?? DEFAULTS.llm.provider,
      defaultTextModel:
        o['llm.default_text_model'] ?? DEFAULTS.llm.defaultTextModel,
      customBaseUrl:
        o['llm.custom_base_url'] ?? DEFAULTS.llm.customBaseUrl,
    },
    imageVideo: {
      provider: o['image_video.provider'] ?? DEFAULTS.imageVideo.provider,
      baseUrl: o['image_video.base_url'] ?? DEFAULTS.imageVideo.baseUrl,
    },
    elevenlabs: {
      voiceId: o['elevenlabs.voice_id'] ?? DEFAULTS.elevenlabs.voiceId,
      modelId: o['elevenlabs.model_id'] ?? DEFAULTS.elevenlabs.modelId,
      configured: o['elevenlabs.configured'] ?? false,
    },
    telegram: {
      pollingIntervalMs:
        o['telegram.polling_interval_ms'] ??
        DEFAULTS.telegram.pollingIntervalMs,
      configured: o['telegram.configured'] ?? false,
    },
    composio: {
      configured: o['composio.configured'] ?? false,
    },
  };
}

// ---------------------------------------------------------------------------
// Override helpers (admin settings UI)
// ---------------------------------------------------------------------------

/**
 * Read the raw stored override value (or `null` if not set) for one
 * key. The admin settings UI uses this to render "default" vs
 * "overridden" badges next to each field — `null` means "falling back
 * to Tier 0".
 */
export async function readOverride(
  key: SettingKey,
): Promise<unknown | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`readOverride(${key}): ${error.message}`);
  return data?.value ?? null;
}

/**
 * Write or clear a single override. Pass `null` to remove the row and
 * fall back to the Tier 0 default.
 */
export async function writeOverride(
  key: SettingKey,
  value: unknown,
): Promise<void> {
  const supabase = await createClient();
  if (value === null || value === undefined) {
    const { error } = await supabase.from('app_settings').delete().eq('key', key);
    if (error) throw new Error(`writeOverride(${key}): ${error.message}`);
    return;
  }

  // Validate the single key against its schema before writing.
  const partial = settingValueSchema.parse({ [key]: value });
  const validated = partial[key];

  const { error } = await supabase
    .from('app_settings')
    .upsert({ key, value: validated }, { onConflict: 'key' });
  if (error) throw new Error(`writeOverride(${key}): ${error.message}`);
}
