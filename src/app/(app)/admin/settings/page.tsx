import Link from 'next/link';

import { requireAdmin } from '@/lib/auth';
import { DEFAULTS } from '@/lib/defaults';
import { readOverride, resolveSettings } from '@/lib/settings/resolve';

import { SettingsRow } from './_components/settings-row';

/**
 * Admin Settings page. Lets the admin override Tier 0 (`src/lib/defaults.ts`)
 * values from the UI without redeploying — writes go to the
 * `app_settings` table (Tier 1, RLS-gated to admins).
 *
 * Layout:
 *   - LLM section: provider / model / base URL. These are wizard-managed
 *     (re-run /admin/setup to change them) and rendered read-only here.
 *   - Voice section: ElevenLabs voice ID and model ID. Editable inline,
 *     reset button falls back to Tier 0.
 *
 * The override resolver in `src/lib/settings/resolve.ts` is the single
 * source of truth for valid keys + per-key Zod validation.
 */
export const metadata = {
  title: 'Admin Settings — MastraClaw',
};

export default async function AdminSettingsPage() {
  await requireAdmin();
  const settings = await resolveSettings();

  // Read raw `app_settings` rows so we can render the "default" vs
  // "overridden" badge. `null` means no row → falling back to Tier 0.
  const [
    llmProviderOverride,
    llmModelOverride,
    llmBaseUrlOverride,
    voiceIdOverride,
    voiceModelOverride,
  ] = await Promise.all([
    readOverride('llm.default_provider'),
    readOverride('llm.default_text_model'),
    readOverride('llm.custom_base_url'),
    readOverride('elevenlabs.voice_id'),
    readOverride('elevenlabs.model_id'),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Override the deployment defaults shipped in{' '}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
            src/lib/defaults.ts
          </code>
          . Changes take effect immediately for every user — no redeploy
          required.
        </p>
      </header>

      <section>
        <h2 className="mb-2 text-base font-semibold">Language model</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Provider, default model, and custom base URL. These are managed
          by the{' '}
          <Link
            href="/admin/setup"
            className="underline underline-offset-2 hover:text-foreground"
          >
            setup wizard
          </Link>{' '}
          — re-run it to change them.
        </p>
        <div className="rounded-lg border">
          <div className="px-4">
            <SettingsRow
              settingKey="llm.default_provider"
              label="Default provider"
              description="Which LLM provider every user runs against by default."
              effectiveValue={settings.llm.provider}
              defaultValue={DEFAULTS.llm.provider}
              isOverridden={llmProviderOverride !== null}
              readOnly
            />
            <SettingsRow
              settingKey="llm.default_text_model"
              label="Default text model"
              description="Provider-prefixed model id, e.g. `anthropic/claude-sonnet-4-5`."
              effectiveValue={settings.llm.defaultTextModel}
              defaultValue={DEFAULTS.llm.defaultTextModel}
              isOverridden={llmModelOverride !== null}
              readOnly
            />
            <SettingsRow
              settingKey="llm.custom_base_url"
              label="Custom base URL"
              description="Only used when the provider is set to `custom`."
              effectiveValue={settings.llm.customBaseUrl ?? ''}
              defaultValue={DEFAULTS.llm.customBaseUrl ?? ''}
              isOverridden={llmBaseUrlOverride !== null}
              readOnly
            />
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">Voice (ElevenLabs)</h2>
        <p className="text-muted-foreground mb-4 text-sm">
          Defaults ship in source. Override here if you want a different
          voice without redeploying. The ElevenLabs API key itself lives
          in Vault and is set via the setup wizard.
        </p>
        <div className="rounded-lg border">
          <div className="px-4">
            <SettingsRow
              settingKey="elevenlabs.voice_id"
              label="Voice ID"
              description="ElevenLabs voice id used for TTS."
              effectiveValue={settings.elevenlabs.voiceId}
              defaultValue={DEFAULTS.elevenlabs.voiceId}
              isOverridden={voiceIdOverride !== null}
              placeholder={DEFAULTS.elevenlabs.voiceId}
            />
            <SettingsRow
              settingKey="elevenlabs.model_id"
              label="Model ID"
              description="ElevenLabs TTS model, e.g. `eleven_v3`."
              effectiveValue={settings.elevenlabs.modelId}
              defaultValue={DEFAULTS.elevenlabs.modelId}
              isOverridden={voiceModelOverride !== null}
              placeholder={DEFAULTS.elevenlabs.modelId}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
