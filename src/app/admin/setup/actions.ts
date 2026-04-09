'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  probeComposio,
  probeElevenlabs,
  probeLlm,
  probeTelegram,
  type LlmProvider,
} from '@/lib/setup/probes';
import { appSecrets, APP_SECRET_NAMES } from '@/mastra/lib/secret-service';

/**
 * Server actions for the Admin Setup wizard.
 *
 * Two surfaces:
 *
 *  1. **Probe actions** — pure validators. They take credentials, hit
 *     the provider's API to confirm the credential works, and return
 *     `{ ok, ... }`. They DO NOT write anything to Vault or app_settings.
 *     The client-side wizard component drives them step by step.
 *
 *  2. **Commit action** — `commitAdminSetupAction(draft)`. This is the
 *     single transaction that runs at the very end of the wizard, after
 *     the admin has clicked through every step (or skipped optional
 *     ones). It re-runs every probe one more time as defense in depth,
 *     then writes all secrets to Vault and all flags to app_settings,
 *     and finally sets `app.setup_completed_at`. Once this returns
 *     ok=true, the proxy gate redirects the admin out of /admin/setup.
 *
 * Plus the unchanged `handoffContinue()` and `handoffSkip()` for the
 * post-commit handoff screen.
 */

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Probe actions — pure, no writes
// ---------------------------------------------------------------------------

export async function probeLlmAction(
  provider: LlmProvider,
  apiKey: string,
  customBaseUrl: string | null,
): Promise<ActionResult<{ models: string[] }>> {
  await requireAdmin();
  const res = await probeLlm(provider, apiKey, customBaseUrl);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, models: res.models };
}

export async function probeImageVideoAction(
  apiKey: string,
): Promise<ActionResult<{ models: string[] }>> {
  await requireAdmin();
  const res = await probeLlm('vercel-gateway', apiKey, null);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, models: res.models };
}

export async function probeElevenlabsAction(
  apiKey: string,
): Promise<ActionResult> {
  await requireAdmin();
  const res = await probeElevenlabs(apiKey);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

export async function probeTelegramAction(
  token: string,
): Promise<ActionResult<{ botUsername: string }>> {
  await requireAdmin();
  const res = await probeTelegram(token);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, botUsername: res.botUsername };
}

export async function probeComposioAction(
  apiKey: string,
): Promise<ActionResult> {
  await requireAdmin();
  const res = await probeComposio(apiKey);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Commit action
// ---------------------------------------------------------------------------

export type AdminSetupDraft = {
  provider: LlmProvider;
  customBaseUrl: string | null;
  llmKey: string;
  defaultTextModel: string;

  imageVideoSkipped: boolean;
  imageVideoKey: string | null;

  elevenlabsSkipped: boolean;
  elevenlabsKey: string | null;

  telegramSkipped: boolean;
  telegramToken: string | null;

  composioSkipped: boolean;
  composioKey: string | null;
};

export async function commitAdminSetupAction(
  draft: AdminSetupDraft,
): Promise<ActionResult> {
  await requireAdmin();

  // 1. Defense-in-depth re-probe of every credential the draft claims is
  //    valid. A malicious client that bypasses the per-step probes still
  //    cannot persist garbage.
  const llmProbe = await probeLlm(
    draft.provider,
    draft.llmKey,
    draft.customBaseUrl,
  );
  if (!llmProbe.ok) {
    return { ok: false, error: `LLM key check failed: ${llmProbe.error}` };
  }
  if (!draft.defaultTextModel) {
    return { ok: false, error: 'No default model selected' };
  }
  if (!llmProbe.models.includes(draft.defaultTextModel)) {
    return {
      ok: false,
      error: `Selected model ${draft.defaultTextModel} not in provider's model list`,
    };
  }

  // Image/video is auto-skipped if the text provider is already Vercel
  // AI Gateway (the same key covers both — no second probe needed).
  const autoSkippedImageVideo = draft.provider === 'vercel-gateway';
  if (
    !draft.imageVideoSkipped &&
    !autoSkippedImageVideo &&
    draft.imageVideoKey
  ) {
    const res = await probeLlm('vercel-gateway', draft.imageVideoKey, null);
    if (!res.ok) {
      return { ok: false, error: `Image/video key check failed: ${res.error}` };
    }
  }

  if (!draft.elevenlabsSkipped && draft.elevenlabsKey) {
    const res = await probeElevenlabs(draft.elevenlabsKey);
    if (!res.ok) {
      return { ok: false, error: `ElevenLabs check failed: ${res.error}` };
    }
  }

  if (!draft.telegramSkipped && draft.telegramToken) {
    const res = await probeTelegram(draft.telegramToken);
    if (!res.ok) {
      return { ok: false, error: `Telegram check failed: ${res.error}` };
    }
  }

  if (!draft.composioSkipped && draft.composioKey) {
    const res = await probeComposio(draft.composioKey);
    if (!res.ok) {
      return { ok: false, error: `Composio check failed: ${res.error}` };
    }
  }

  // 2. Write secrets to Vault. Always write the LLM key (it's required).
  //    Optional ones only if the admin actually filled them in.
  await appSecrets.set(APP_SECRET_NAMES.llmApiKey, draft.llmKey);

  if (
    !draft.imageVideoSkipped &&
    !autoSkippedImageVideo &&
    draft.imageVideoKey
  ) {
    await appSecrets.set(
      APP_SECRET_NAMES.imageVideoApiKey,
      draft.imageVideoKey,
    );
  }
  if (!draft.elevenlabsSkipped && draft.elevenlabsKey) {
    await appSecrets.set(
      APP_SECRET_NAMES.elevenlabsApiKey,
      draft.elevenlabsKey,
    );
  }
  if (!draft.telegramSkipped && draft.telegramToken) {
    await appSecrets.set(
      APP_SECRET_NAMES.telegramBotToken,
      draft.telegramToken,
    );
  }
  if (!draft.composioSkipped && draft.composioKey) {
    await appSecrets.set(APP_SECRET_NAMES.composioApiKey, draft.composioKey);
  }

  // 3. Upsert all the app_settings rows in one batch.
  const supabase = await createClient();
  const rows: { key: string; value: unknown }[] = [
    { key: 'llm.default_provider', value: draft.provider },
    { key: 'llm.custom_base_url', value: draft.customBaseUrl },
    { key: 'llm.default_text_model', value: draft.defaultTextModel },
    {
      key: 'image_video.provider',
      value:
        draft.imageVideoSkipped && !autoSkippedImageVideo
          ? null
          : 'vercel-gateway',
    },
    { key: 'elevenlabs.configured', value: !draft.elevenlabsSkipped },
    { key: 'telegram.configured', value: !draft.telegramSkipped },
    { key: 'composio.configured', value: !draft.composioSkipped },
  ];

  const { error: upsertError } = await supabase
    .from('app_settings')
    .upsert(rows, { onConflict: 'key' });
  if (upsertError) {
    return {
      ok: false,
      error: `Failed to write app settings: ${upsertError.message}`,
    };
  }

  // 4. Mark setup complete LAST so the proxy gate flips only after every
  //    other write succeeded.
  const { error: completeError } = await supabase
    .from('app_settings')
    .upsert(
      { key: 'app.setup_completed_at', value: new Date().toISOString() },
      { onConflict: 'key' },
    );
  if (completeError) {
    return {
      ok: false,
      error: `Failed to mark setup complete: ${completeError.message}`,
    };
  }

  revalidatePath('/admin/setup');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Handoff
// ---------------------------------------------------------------------------

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
