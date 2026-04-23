'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth';
import {
  UpdateOrganizationSettingSchema,
  loadOrganization,
  type OrganizationSetting,
} from '@/lib/organization';
import { upsertSetting } from '@/lib/settings/resolve';
import { createClient } from '@/lib/supabase/server';

/**
 * Admin-only partial update of the `organization` row in
 * `platform_settings`. Reads the current JSON, merges the incoming
 * partial, writes it back so the name / prompt / logo slots can be
 * saved independently.
 *
 * Logo upload is not wired yet — the `customerLogoPath` slot stays
 * `null` until the storage-bucket upload path lands. Callers that
 * pass a `customerLogoPath` still see it persisted; just no UI path
 * to populate it.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const REVALIDATE_PATHS = [
  '/admin/setup',
  '/admin/settings',
  '/login',
  '/',
];

function revalidateBrandingSurfaces(): void {
  for (const path of REVALIDATE_PATHS) revalidatePath(path);
}

export async function updateOrganizationSettingAction(
  input: unknown,
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = UpdateOrganizationSettingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join('; '),
    };
  }

  const supabase = await createClient();
  const current = await loadOrganization(supabase);
  const next: OrganizationSetting = { ...current, ...parsed.data };

  await upsertSetting(supabase, 'organization', next);
  revalidateBrandingSurfaces();

  return { ok: true };
}
