import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

import { loadOrganization } from './organization';

/**
 * Branding-bucket helpers.
 *
 * The admin branding step stores the logo path (inside the `branding`
 * Supabase Storage bucket) on `platform_settings.organization.customerLogoPath`.
 * Dynamic routes call `streamBrandingLogo()` to resolve the object and
 * return the raw bytes.
 *
 * Upload wiring isn't hooked up yet (no sharp re-encode +
 * ImageCropUploader flow in the admin UI). Until that lands the path
 * is populated manually — the loader still returns null cleanly and
 * the login page / layout fall back to the default MastraClaw asset.
 */

export type BrandingLogo = {
  body: ArrayBuffer;
  contentType: string;
};

export async function loadBrandingLogoPath(): Promise<string | null> {
  const supabase = createServiceClient();
  const org = await loadOrganization(supabase);
  return org.customerLogoPath ?? null;
}

export async function streamBrandingLogo(): Promise<BrandingLogo | null> {
  const path = await loadBrandingLogoPath();
  if (!path) return null;

  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from('branding')
    .download(path);
  if (error || !data) return null;

  const buffer = await data.arrayBuffer();
  return {
    body: buffer,
    contentType: data.type || 'application/octet-stream',
  };
}
