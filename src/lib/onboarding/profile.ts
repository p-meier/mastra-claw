import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

/**
 * Per-user profile + onboarding state. Mirrors the `public.user_profiles`
 * table schema from migration 20260408195437_onboarding.sql.
 *
 * Global app config (LLM provider, ElevenLabs defaults, etc.) is no longer
 * loaded here — see `src/lib/settings/resolve.ts` for the typed,
 * Zod-validated settings resolver that walks Tier 1 (`app_settings`) over
 * Tier 0 (`src/lib/defaults.ts`).
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

    return rowToProfile(data);
  },
);

// ---------------------------------------------------------------------------
// Service-role variants — for headless entry points (Telegram webhook etc.)
// ---------------------------------------------------------------------------
//
// These are NOT cached: they're called from request handlers that have no
// React-cache lifecycle. They're also intentionally separate functions so
// every call site is forced to think about *which* client it's passing —
// the cookie-bound one (which respects RLS) or the service-role one (which
// bypasses it). See `src/lib/supabase/service.ts` for the discipline.

export async function loadProfileAsService(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select(
      'user_id, nickname, user_preferences, bootstrap_thread_id, onboarding_completed_at, onboarding_skipped_at, created_at, updated_at',
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`loadProfileAsService(${userId}) failed: ${error.message}`);
  }
  if (!data) return null;
  return rowToProfile(data);
}

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

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type UserProfileRow = {
  user_id: string;
  nickname: string | null;
  user_preferences: string | null;
  bootstrap_thread_id: string | null;
  onboarding_completed_at: string | null;
  onboarding_skipped_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToProfile(data: UserProfileRow): UserProfile {
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
}
