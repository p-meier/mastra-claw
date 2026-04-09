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
  await supabase
    .from('user_profiles')
    .update({ onboarding_skipped_at: new Date().toISOString() })
    .eq('user_id', user.userId);
  redirect('/');
}
