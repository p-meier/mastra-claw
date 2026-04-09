'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth';
import type { SecretFieldStatus } from '@/lib/descriptors/types';
import { resolveSettings, upsertSetting } from '@/lib/settings/resolve';
import { createClient } from '@/lib/supabase/server';

import { getChannel } from './registry';
import { channelSecrets } from './secrets';

/**
 * Server actions for the Channel registry. Mirrors the provider actions
 * surface — same stored-secret semantics, same probe-on-save guard,
 * same `requireAdmin()` defense in depth.
 *
 * The extra wrinkle: channels carry a `voiceEnabled` meta flag that
 * lives outside the descriptor's normal field set. The save action
 * accepts it as a separate parameter and stitches it into the stored
 * config row. `toggleChannelVoiceAction` is a thin convenience for the
 * voice switch on the channel card without having to round-trip the
 * entire form.
 */

export type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Probe action
// ---------------------------------------------------------------------------

export async function probeChannelAction(
  channelId: string,
  rawValues: Record<string, string>,
): Promise<ActionResult<{ note?: string }>> {
  await requireAdmin();
  const descriptor = getChannel(channelId);
  if (!descriptor) {
    return { ok: false, error: `Unknown channel ${channelId}` };
  }
  const merged = await mergeStoredSecrets(channelId, rawValues);
  const result = await descriptor.probe(merged);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, note: result.note };
}

// ---------------------------------------------------------------------------
// Save action
// ---------------------------------------------------------------------------

export async function saveChannelConfigAction(
  channelId: string,
  rawValues: Record<string, string>,
  options: { voiceEnabled?: boolean } = {},
): Promise<ActionResult> {
  await requireAdmin();
  const descriptor = getChannel(channelId);
  if (!descriptor) {
    return { ok: false, error: `Unknown channel ${channelId}` };
  }

  const merged = await mergeStoredSecrets(channelId, rawValues);

  // Required-field check after backfill.
  for (const field of descriptor.fields) {
    if (!field.required) continue;
    if (!isFieldVisible(field.showWhen, merged)) continue;
    const value = merged[field.name];
    if (value === undefined || value === null || String(value).length === 0) {
      return { ok: false, error: `Field "${field.label}" is required` };
    }
  }

  // Defense-in-depth re-probe.
  const probe = await descriptor.probe(merged);
  if (!probe.ok) {
    return { ok: false, error: probe.error };
  }

  // Voice toggle: refuse to enable voice without an active voice provider.
  if (options.voiceEnabled === true) {
    const settings = await resolveSettings();
    if (!settings.providers.voice.active) {
      return {
        ok: false,
        error:
          'Cannot enable voice: configure a voice provider (TTS + STT) first.',
      };
    }
  }

  // Persist secrets.
  for (const field of descriptor.fields) {
    if (!field.secret) continue;
    if (!isFieldVisible(field.showWhen, merged)) continue;
    const newValue = rawValues[field.name];
    if (newValue && newValue.length > 0) {
      await channelSecrets.set(channelId, field.name, newValue);
    }
  }

  // Persist non-secret config + voiceEnabled.
  const supabase = await createClient();
  const config: Record<string, unknown> = {};
  for (const field of descriptor.fields) {
    if (field.secret) continue;
    if (!isFieldVisible(field.showWhen, merged)) continue;
    if (merged[field.name] !== undefined) {
      config[field.name] = merged[field.name];
    }
  }
  if (options.voiceEnabled !== undefined) {
    config.voiceEnabled = options.voiceEnabled;
  }

  await upsertSetting(supabase, `channels.${channelId}.config`, config);
  await upsertSetting(supabase, `channels.${channelId}.configured`, true);

  revalidatePath('/admin/channels');
  revalidatePath('/admin/setup');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Voice toggle — convenience for the channel card switch
// ---------------------------------------------------------------------------

export async function toggleChannelVoiceAction(
  channelId: string,
  voiceEnabled: boolean,
): Promise<ActionResult> {
  await requireAdmin();
  const descriptor = getChannel(channelId);
  if (!descriptor) {
    return { ok: false, error: `Unknown channel ${channelId}` };
  }

  const settings = await resolveSettings();
  const channelState = settings.channels[channelId];
  if (!channelState?.configured) {
    return {
      ok: false,
      error: `Channel ${channelId} is not configured yet`,
    };
  }
  if (voiceEnabled && !settings.providers.voice.active) {
    return {
      ok: false,
      error: 'Cannot enable voice: configure a voice provider (TTS + STT) first.',
    };
  }

  const supabase = await createClient();
  const next = { ...channelState.config, voiceEnabled };
  await upsertSetting(supabase, `channels.${channelId}.config`, next);

  revalidatePath('/admin/channels');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Delete action
// ---------------------------------------------------------------------------

export async function deleteChannelConfigAction(
  channelId: string,
): Promise<ActionResult> {
  await requireAdmin();
  const descriptor = getChannel(channelId);
  if (!descriptor) {
    return { ok: false, error: `Unknown channel ${channelId}` };
  }

  await channelSecrets.deleteAll(channelId);
  const supabase = await createClient();
  await upsertSetting(supabase, `channels.${channelId}.config`, null);
  await upsertSetting(supabase, `channels.${channelId}.configured`, false);

  revalidatePath('/admin/channels');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Read-side helper for the edit form
// ---------------------------------------------------------------------------

export async function getChannelSecretFieldStatus(
  channelId: string,
): Promise<SecretFieldStatus> {
  await requireAdmin();
  const descriptor = getChannel(channelId);
  if (!descriptor) return {};

  const stored = new Set(await channelSecrets.listFields(channelId));
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

async function mergeStoredSecrets(
  channelId: string,
  rawValues: Record<string, string>,
): Promise<Record<string, unknown>> {
  const descriptor = getChannel(channelId);
  if (!descriptor) return { ...rawValues };

  const merged: Record<string, unknown> = { ...rawValues };
  for (const field of descriptor.fields) {
    if (!field.secret) continue;
    const submitted = rawValues[field.name];
    if (submitted && submitted.length > 0) continue;
    const stored = await channelSecrets.get(channelId, field.name);
    if (stored) merged[field.name] = stored;
  }
  return merged;
}
