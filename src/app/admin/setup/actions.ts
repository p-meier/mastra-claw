'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { resolveSettings, upsertSetting } from '@/lib/settings/resolve';

/**
 * Server actions for the slimmed-down admin setup wizard.
 *
 * After the provider/channel refactor the wizard delegates every
 * provider step to the shared `descriptor-config-form` and the
 * matching `saveProviderConfigAction` from `@/lib/providers/actions`.
 * Those actions handle probes, Vault writes, and `app_settings`
 * upserts on a per-step basis — there is no longer a giant
 * `commitAdminSetupAction` doing the whole thing at the end.
 *
 * The remaining responsibility of this file is the **finalizer**:
 * once the admin has at least an active text provider, flip
 * `app.setup_completed_at` and redirect into the personal-onboarding
 * flow.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function finalizeAdminSetupAction(): Promise<ActionResult> {
  await requireAdmin();
  const settings = await resolveSettings();
  if (!settings.providers.text.active) {
    return {
      ok: false,
      error: 'Configure a text-model provider before finishing setup.',
    };
  }
  const supabase = await createClient();
  await upsertSetting(
    supabase,
    'app.setup_completed_at',
    new Date().toISOString(),
  );
  revalidatePath('/admin/setup');
  return { ok: true };
}

export async function handoffContinue(): Promise<void> {
  await requireAdmin();
  redirect('/onboarding');
}

export async function handoffSkip(): Promise<void> {
  const user = await requireAdmin();
  const supabase = await createClient();
  // Stamp the profile with explicit admin-only values so the personal
  // onboarding gate treats it as fully resolved and never loads the
  // bootstrap chat for this account. The nickname/preferences make it
  // obvious from /account/settings that this is an administrator who
  // chose not to use the assistant personally.
  const now = new Date().toISOString();
  await supabase
    .from('user_profiles')
    .update({
      nickname: 'Admin',
      user_preferences:
        '# Admin account\n\nThis is an administrator account that is not intended to be used as a personal assistant user. Personal onboarding was skipped intentionally during admin setup. If you want to start using MastraClaw as an end user with this account, run the personal onboarding from /account/settings.',
      bootstrap_thread_id: null,
      onboarding_completed_at: now,
    })
    .eq('user_id', user.userId);
  redirect('/admin/settings');
}
