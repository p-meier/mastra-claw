import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

/**
 * Per-user profile + onboarding state. Mirrors the `public.user_profiles`
 * table schema from migration 20260408195437_onboarding.sql.
 */
export type UserProfile = {
  userId: string;
  nickname: string | null;
  userPreferences: string | null;

  bootstrapThreadId: string | null;

  onboardingCompletedAt: Date | null;
  onboardingSkippedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
};

/**
 * Global app-setup + provider config. Read from `public.app_settings`.
 *
 * The wizard writes one row per key in `app_settings`; this loader pulls
 * everything that is relevant to runtime in a single query so the proxy
 * onboarding gate and the chat route handler don't make N round-trips.
 */
export type AppConfig = {
  setupCompletedAt: Date | null;

  llm: {
    provider: 'anthropic' | 'openai' | 'openrouter' | 'vercel-gateway' | 'custom' | null;
    customBaseUrl: string | null;
    defaultTextModel: string | null;
  };

  imageVideo: {
    provider: 'vercel-gateway' | null;
    baseUrl: string | null;
  };

  elevenlabs: {
    configured: boolean;
    voiceIdOverride: string | null;
    modelIdOverride: string | null;
  };

  telegram: {
    configured: boolean;
  };

  composio: {
    configured: boolean;
  };
};

// ---------------------------------------------------------------------------
// loadProfile(userId)
// ---------------------------------------------------------------------------

export const loadProfile = cache(
  async (userId: string): Promise<UserProfile | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('user_profiles')
      .select(
        'user_id, nickname, user_preferences, bootstrap_thread_id, onboarding_completed_at, onboarding_skipped_at, created_at, updated_at',
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new Error(`loadProfile(${userId}) failed: ${error.message}`);
    }
    if (!data) return null;

    return {
      userId: data.user_id,
      nickname: data.nickname,
      userPreferences: data.user_preferences,
      bootstrapThreadId: data.bootstrap_thread_id,
      onboardingCompletedAt: data.onboarding_completed_at
        ? new Date(data.onboarding_completed_at)
        : null,
      onboardingSkippedAt: data.onboarding_skipped_at
        ? new Date(data.onboarding_skipped_at)
        : null,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
    };
  },
);

// ---------------------------------------------------------------------------
// loadAppConfig() — admin-only via app_settings RLS
// ---------------------------------------------------------------------------

export const loadAppConfig = cache(async (): Promise<AppConfig> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value');

  if (error) {
    throw new Error(`loadAppConfig() failed: ${error.message}`);
  }

  const map = new Map<string, unknown>(
    (data ?? []).map((row) => [row.key as string, row.value]),
  );

  const get = <T>(key: string): T | null => {
    const v = map.get(key);
    return (v ?? null) as T | null;
  };

  const setupCompletedAtRaw = get<string>('app.setup_completed_at');

  return {
    setupCompletedAt: setupCompletedAtRaw ? new Date(setupCompletedAtRaw) : null,
    llm: {
      provider: get<AppConfig['llm']['provider']>('llm.default_provider'),
      customBaseUrl: get<string>('llm.custom_base_url'),
      defaultTextModel: get<string>('llm.default_text_model'),
    },
    imageVideo: {
      provider: get<AppConfig['imageVideo']['provider']>('image_video.provider'),
      baseUrl: get<string>('image_video.base_url'),
    },
    elevenlabs: {
      configured: get<boolean>('elevenlabs.configured') ?? false,
      voiceIdOverride: get<string>('elevenlabs.voice_id_override'),
      modelIdOverride: get<string>('elevenlabs.model_id_override'),
    },
    telegram: {
      configured: get<boolean>('telegram.configured') ?? false,
    },
    composio: {
      configured: get<boolean>('composio.configured') ?? false,
    },
  };
});

/**
 * Lightweight gate-only loader used by the proxy. Returns just the two
 * booleans the proxy needs to decide redirects, without pulling the full
 * profile/config payload. NOT cached because the proxy runs in the edge
 * runtime where react.cache is unavailable, and because the loader is
 * cheap (one indexed query).
 */
export async function loadOnboardingState(userId: string): Promise<{
  appSetupCompleted: boolean;
  userOnboardingResolved: boolean;
}> {
  const supabase = await createClient();

  const [{ data: settings }, { data: profile }] = await Promise.all([
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'app.setup_completed_at')
      .maybeSingle(),
    supabase
      .from('user_profiles')
      .select('onboarding_completed_at, onboarding_skipped_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const appSetupCompleted =
    settings?.value !== null && settings?.value !== undefined;
  const userOnboardingResolved = Boolean(
    profile?.onboarding_completed_at || profile?.onboarding_skipped_at,
  );

  return { appSetupCompleted, userOnboardingResolved };
}
