import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { readSetting } from '@/lib/settings/resolve';

/**
 * Organisation-setting loader + shape.
 *
 * Lives in `platform_settings.organization` as a single JSON row
 * seeded as `{ name: null, organizationPrompt: null,
 * customerLogoPath: null }`. The admin setup wizard's branding step
 * writes to it; `composePrompt` reads `organizationPrompt` for the
 * org-level prompt layer.
 */

export const OrganizationSettingSchema = z.object({
  name: z.string().nullable(),
  organizationPrompt: z.string().nullable(),
  customerLogoPath: z.string().nullable(),
});

export type OrganizationSetting = z.infer<typeof OrganizationSettingSchema>;

export const UpdateOrganizationSettingSchema = OrganizationSettingSchema.partial();

export type UpdateOrganizationSettingInput = z.infer<
  typeof UpdateOrganizationSettingSchema
>;

const EMPTY: OrganizationSetting = {
  name: null,
  organizationPrompt: null,
  customerLogoPath: null,
};

/**
 * Read + validate the organization row. Returns the empty shape when the
 * row is missing or malformed (the seed always installs it, so "missing"
 * really only happens in a just-initialised fresh database before the
 * seed row has been applied).
 */
export async function loadOrganization(
  supabase: SupabaseClient,
): Promise<OrganizationSetting> {
  const raw = await readSetting(supabase, 'organization');
  if (!raw) return EMPTY;
  const parsed = OrganizationSettingSchema.safeParse(raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn(
      '[organization] stored value is malformed; falling back to empty.',
      parsed.error.issues,
    );
    return EMPTY;
  }
  return parsed.data;
}
