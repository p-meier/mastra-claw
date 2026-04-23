'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { resolveSettings, upsertSetting } from '@/lib/settings/resolve';

/**
 * Server actions for the admin setup wizard.
 *
 * Per-provider probes + Vault writes happen through the shared
 * `saveProviderConfigAction` in `@/lib/providers/actions`. This file
 * contains the single finalizer that flips `app.setup_completed_at`
 * once at least an active text provider is configured, then redirects
 * to `/admin/settings`. On error, returns `{ ok: false, error }` so
 * the wizard can surface the message inline.
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
  if (!settings.providers.embedding.active) {
    return {
      ok: false,
      error:
        'Configure an embedding provider before finishing setup — semantic recall and RAG workflows require one.',
    };
  }
  const supabase = await createClient();
  await upsertSetting(
    supabase,
    'app.setup_completed_at',
    new Date().toISOString(),
  );
  revalidatePath('/admin/setup');
  revalidatePath('/');
  redirect('/admin/settings');
}
