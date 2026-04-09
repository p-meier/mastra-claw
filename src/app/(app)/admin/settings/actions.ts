'use server';

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth';
import {
  SETTINGS_KEYS,
  writeOverride,
  type SettingKey,
} from '@/lib/settings/resolve';

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

function isSettingKey(key: string): key is SettingKey {
  return (SETTINGS_KEYS as readonly string[]).includes(key);
}

/**
 * Set an admin override for one settings key. The value is validated
 * against the per-key Zod schema in `src/lib/settings/resolve.ts`
 * before being written to `app_settings`. Pass `null` to clear the
 * override and fall back to the Tier 0 default.
 */
export async function saveSettingAction(
  key: string,
  rawValue: string | null,
): Promise<ActionResult> {
  await requireAdmin();

  if (!isSettingKey(key)) {
    return { ok: false, error: `Unknown settings key: ${key}` };
  }

  // Empty string from a form input means "clear" — delegate to clear.
  if (rawValue === null || rawValue.trim() === '') {
    try {
      await writeOverride(key, null);
      revalidatePath('/admin/settings');
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to clear override',
      };
    }
  }

  // Coerce primitive types where the schema demands them. The resolver
  // does the strict validation; here we just turn form strings into the
  // shape Zod expects.
  let coerced: unknown = rawValue;
  if (key === 'telegram.polling_interval_ms') {
    const n = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(n)) {
      return { ok: false, error: 'Must be an integer' };
    }
    coerced = n;
  } else if (
    key === 'elevenlabs.configured' ||
    key === 'telegram.configured' ||
    key === 'composio.configured'
  ) {
    coerced = rawValue === 'true';
  }

  try {
    await writeOverride(key, coerced);
    revalidatePath('/admin/settings');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to save',
    };
  }
}

export async function clearSettingAction(key: string): Promise<ActionResult> {
  return saveSettingAction(key, null);
}
