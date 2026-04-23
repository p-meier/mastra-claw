import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

/**
 * Per-user profile loader. Mirrors the `public.user_profiles` table:
 * `preferred_name`, `user_prompt`, `name`, `avatar_path`,
 * `must_change_password`.
 *
 * The profile is edited from `/account/settings` and read on every
 * agent call to inject `preferredName` and `userPrompt` into the
 * system prompt.
 */
export type UserProfile = {
  userId: string;
  name: string | null;
  preferredName: string | null;
  avatarPath: string | null;
  userPrompt: string | null;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// ---------------------------------------------------------------------------
// loadProfile(userId)
// ---------------------------------------------------------------------------

export const loadProfile = cache(
  async (userId: string): Promise<UserProfile | null> => {
    const supabase = await createClient();
    return loadProfileAsService(supabase, userId);
  },
);

// ---------------------------------------------------------------------------
// Service-role variant — for headless entry points (cron, etc.)
// ---------------------------------------------------------------------------
//
// Not cached: called from handlers without a React-cache lifecycle.
// Forces every call site to think about *which* client it's passing —
// the cookie-bound one (respects RLS) or the service-role one (bypasses
// it). See `src/lib/supabase/service.ts` for the discipline.

export async function loadProfileAsService(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select(
      'user_id, name, preferred_name, avatar_path, user_prompt, must_change_password, created_at, updated_at',
    )
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`loadProfile(${userId}) failed: ${error.message}`);
  }
  if (!data) return null;
  return rowToProfile(data);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type UserProfileRow = {
  user_id: string;
  name: string | null;
  preferred_name: string | null;
  avatar_path: string | null;
  user_prompt: string | null;
  must_change_password: boolean;
  created_at: string;
  updated_at: string;
};

function rowToProfile(data: UserProfileRow): UserProfile {
  return {
    userId: data.user_id,
    name: data.name,
    preferredName: data.preferred_name,
    avatarPath: data.avatar_path,
    userPrompt: data.user_prompt,
    mustChangePassword: data.must_change_password,
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
  };
}
