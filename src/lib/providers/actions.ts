'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth';
import type { SecretFieldStatus } from '@/lib/descriptors/types';
import {
  readSetting,
  resolveSettings,
  upsertSetting,
} from '@/lib/settings/resolve';
import { createClient } from '@/lib/supabase/server';

import {
  type ProviderCategory,
  getProvider,
} from './registry';
import { providerSecrets } from './secrets';

/**
 * Server actions for the Provider registry — the DRY chokepoint shared
 * by the admin setup wizard and the `/admin/settings` page.
 *
 * Three concerns each action handles uniformly:
 *
 *   1. **`requireAdmin()`** at the top — defense in depth, even though
 *      Vault writes are gated again at the SQL function level.
 *
 *   2. **Stored-secret semantics**: when an admin edits an existing
 *      provider, the form sends an empty string for any secret field
 *      they didn't change. The action backfills those from Vault before
 *      running the descriptor probe, so a no-op edit doesn't force the
 *      admin to re-paste their API key.
 *
 *   3. **Probe-on-save**: every save re-runs the descriptor probe and
 *      refuses the write if the probe fails. The wizard already runs
 *      probes per step; this is the safety net for direct edits.
 */

export type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Probe action — pure validator, no writes
// ---------------------------------------------------------------------------

export async function probeProviderAction(
  category: ProviderCategory,
  providerId: string,
  rawValues: Record<string, string>,
): Promise<ActionResult<{ models?: string[]; voiceCount?: number; note?: string }>> {
  await requireAdmin();
  const descriptor = getProvider(category, providerId);
  if (!descriptor) {
    return { ok: false, error: `Unknown provider ${category}/${providerId}` };
  }

  const merged = await mergeStoredSecrets(category, providerId, rawValues);
  const result = await descriptor.probe(merged);
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    models: result.models,
    voiceCount: result.voiceCount,
    note: result.note,
  };
}

// ---------------------------------------------------------------------------
// Save action
// ---------------------------------------------------------------------------

export async function saveProviderConfigAction(
  category: ProviderCategory,
  providerId: string,
  rawValues: Record<string, string>,
  options: { setActive?: boolean } = {},
): Promise<ActionResult> {
  await requireAdmin();
  const descriptor = getProvider(category, providerId);
  if (!descriptor) {
    return { ok: false, error: `Unknown provider ${category}/${providerId}` };
  }

  // Backfill empty secret fields from existing Vault entries so a
  // no-op edit can keep the stored secret without re-entry.
  const merged = await mergeStoredSecrets(category, providerId, rawValues);

  // Reject required-field gaps after backfill — the form already
  // checked them, but we re-check here because it's the security-
  // facing boundary.
  for (const field of descriptor.fields) {
    if (!field.required) continue;
    if (!isFieldVisible(field.showWhen, merged)) continue;
    const value = merged[field.name];
    if (value === undefined || value === null || String(value).length === 0) {
      return { ok: false, error: `Field "${field.label}" is required` };
    }
  }

  // Defense-in-depth re-probe — refuse the write if the probe fails.
  const probe = await descriptor.probe(merged);
  if (!probe.ok) {
    return { ok: false, error: probe.error };
  }

  // Persist secrets first so the new config row never references a
  // missing Vault entry.
  for (const field of descriptor.fields) {
    if (!field.secret) continue;
    if (!isFieldVisible(field.showWhen, merged)) continue;
    const newValue = rawValues[field.name];
    if (newValue && newValue.length > 0) {
      await providerSecrets.set(category, providerId, field.name, newValue);
    }
  }

  // Persist the non-secret config row.
  const supabase = await createClient();
  const config: Record<string, unknown> = {};
  for (const field of descriptor.fields) {
    if (field.secret) continue;
    if (!isFieldVisible(field.showWhen, merged)) continue;
    if (merged[field.name] !== undefined) {
      config[field.name] = merged[field.name];
    }
  }
  await upsertSetting(
    supabase,
    `providers.${category}.${providerId}.config`,
    config,
  );

  // Optionally promote this provider to "active". The wizard always
  // sets active; the admin page lets the admin add a provider without
  // switching the active pointer.
  if (options.setActive) {
    await upsertSetting(supabase, `providers.${category}.active`, providerId);
  } else {
    // If no provider is active in this category yet, become the
    // active one automatically. Otherwise leave the existing active
    // pointer alone.
    const current = await readSetting(
      supabase,
      `providers.${category}.active`,
    );
    if (!current) {
      await upsertSetting(
        supabase,
        `providers.${category}.active`,
        providerId,
      );
    }
  }

  // Multi-category fan-out for combined providers.
  //
  // The Vercel AI Gateway exposes text, embedding, image, *and* video
  // models behind one key. When the admin configures it as a text
  // provider we seed the same credentials into the `embedding` and
  // `image-video` slots so the gateway is automatically usable for
  // those modalities without a second pass through the wizard. Each
  // slot stays independent in `platform_settings` so the admin can
  // swap one out later without affecting the others.
  //
  // The seed only creates the Vault key + an empty config row. It
  // does NOT set the fan-out target as "active" if another provider
  // is already active in that category, and it does NOT overwrite an
  // existing Gateway config.
  if (category === 'text' && providerId === 'vercel-gateway') {
    const apiKey = String(merged.apiKey ?? '');
    if (apiKey.length > 0) {
      await seedGatewayFanout(supabase, 'embedding', apiKey);
      await seedGatewayFanout(supabase, 'image-video', apiKey);
    }
  }

  revalidatePath('/admin/settings');
  revalidatePath('/admin/setup');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Set-active action — switch between already-configured providers
// ---------------------------------------------------------------------------

export async function setActiveProviderAction(
  category: ProviderCategory,
  providerId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const descriptor = getProvider(category, providerId);
  if (!descriptor) {
    return { ok: false, error: `Unknown provider ${category}/${providerId}` };
  }

  const settings = await resolveSettings();
  if (!settings.providers[catKey(category)].configured.includes(providerId)) {
    return {
      ok: false,
      error: `Provider ${providerId} is not configured for ${category}`,
    };
  }

  const supabase = await createClient();
  await upsertSetting(supabase, `providers.${category}.active`, providerId);
  revalidatePath('/admin/settings');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Delete action — only when not active
// ---------------------------------------------------------------------------

export async function deleteProviderConfigAction(
  category: ProviderCategory,
  providerId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const settings = await resolveSettings();
  if (settings.providers[catKey(category)].active?.id === providerId) {
    return {
      ok: false,
      error: `Cannot delete ${providerId}: it is the active ${category} provider. Switch to a different provider first.`,
    };
  }

  await providerSecrets.deleteAll(category, providerId);
  const supabase = await createClient();
  await upsertSetting(
    supabase,
    `providers.${category}.${providerId}.config`,
    null,
  );

  revalidatePath('/admin/settings');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Read-side helper for the edit form
// ---------------------------------------------------------------------------

/**
 * Look up "is each secret field already stored?" so the edit form can
 * render `"•••••• stored"` placeholders without ever transmitting the
 * secret value to the client.
 */
export async function getProviderSecretFieldStatus(
  category: ProviderCategory,
  providerId: string,
): Promise<SecretFieldStatus> {
  await requireAdmin();
  const descriptor = getProvider(category, providerId);
  if (!descriptor) return {};

  const stored = new Set(await providerSecrets.listFields(category, providerId));
  const out: SecretFieldStatus = {};
  for (const field of descriptor.fields) {
    if (!field.secret) continue;
    out[field.name] = stored.has(field.name) ? 'stored' : 'missing';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function catKey(
  c: ProviderCategory,
): 'text' | 'embedding' | 'imageVideo' | 'voice' {
  switch (c) {
    case 'text':
      return 'text';
    case 'embedding':
      return 'embedding';
    case 'image-video':
      return 'imageVideo';
    case 'voice':
      return 'voice';
  }
}

function isFieldVisible(
  showWhen: { field: string; equals: string | string[] } | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!showWhen) return true;
  const driver = String(values[showWhen.field] ?? '');
  if (Array.isArray(showWhen.equals)) {
    return showWhen.equals.includes(driver);
  }
  return driver === showWhen.equals;
}

async function seedGatewayFanout(
  supabase: Awaited<ReturnType<typeof createClient>>,
  targetCategory: Exclude<ProviderCategory, 'text' | 'voice'>,
  apiKey: string,
): Promise<void> {
  // Seed the Vault key.
  await providerSecrets.set(targetCategory, 'vercel-gateway', 'apiKey', apiKey);

  // Ensure an empty config row exists (idempotent — overwrites an
  // empty one, leaves a populated one alone).
  const existing = await readSetting(
    supabase,
    `providers.${targetCategory}.vercel-gateway.config`,
  );
  if (
    !existing ||
    (typeof existing === 'object' &&
      Object.keys(existing as Record<string, unknown>).length === 0)
  ) {
    await upsertSetting(
      supabase,
      `providers.${targetCategory}.vercel-gateway.config`,
      {},
    );
  }

  // Set as active only if no provider is active yet in this category.
  const currentActive = await readSetting(
    supabase,
    `providers.${targetCategory}.active`,
  );
  if (!currentActive) {
    await upsertSetting(
      supabase,
      `providers.${targetCategory}.active`,
      'vercel-gateway',
    );
  }
}

async function mergeStoredSecrets(
  category: ProviderCategory,
  providerId: string,
  rawValues: Record<string, string>,
): Promise<Record<string, unknown>> {
  const descriptor = getProvider(category, providerId);
  if (!descriptor) return { ...rawValues };

  const merged: Record<string, unknown> = { ...rawValues };
  for (const field of descriptor.fields) {
    if (!field.secret) continue;
    const submitted = rawValues[field.name];
    if (submitted && submitted.length > 0) continue;
    // Empty secret submission → fill from Vault if available.
    const stored = await providerSecrets.get(category, providerId, field.name);
    if (stored) merged[field.name] = stored;
  }
  return merged;
}
