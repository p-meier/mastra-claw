'use client';

import { useState, useTransition } from 'react';

import {
  DescriptorConfigForm,
  type DescriptorFormSubmitResult,
} from '@/components/descriptors/descriptor-config-form';
import { BackButton } from '@/components/wizard/back-button';
import { InfoBox, StepShell } from '@/components/wizard/step-shell';
import {
  probeProviderAction,
  saveProviderConfigAction,
} from '@/lib/providers/actions';
import type { ProviderCategory } from '@/lib/providers/registry';

import {
  finalizeAdminSetupAction,
  handoffContinue,
  handoffSkip,
} from '../actions';
import { HandoffStep } from './handoff';

/**
 * Slimmed-down admin setup wizard.
 *
 * The old wizard hardcoded a step per credential type (LLM key, model
 * picker, image/video, ElevenLabs, Telegram, Composio) and then
 * committed everything at the end. Channels and Composio have moved
 * out to their own admin pages, and providers go through the shared
 * `descriptor-config-form` + per-step `saveProviderConfigAction`. What
 * remains is exactly what every fresh install needs:
 *
 *   1. Pick + configure a text-model provider (required)
 *   2. Pick + configure an image/video provider (optional;
 *      auto-skipped when the text provider was Vercel AI Gateway —
 *      the gateway already handles image/video)
 *   3. Pick + configure a TTS provider (optional)
 *   4. Finalize → flip `app.setup_completed_at`, hand off to personal
 *      onboarding
 *
 * Every provider step writes the moment the admin clicks Save inside
 * the form. Back navigation is allowed but does NOT roll back stored
 * configs — the admin can revisit a step to swap providers, but
 * leaving a step half-done means the previous save still stands. This
 * matches the new "providers are independently editable from
 * /admin/settings" model.
 */

export type Stage = 'text' | 'image-video' | 'voice' | 'finalize';

type AddableProviderProps = {
  id: string;
  displayName: string;
  blurb: string;
  badge?: string;
  fields: SerializableField[];
};

type SerializableField = {
  name: string;
  label: string;
  type:
    | 'password'
    | 'text'
    | 'url'
    | 'number'
    | 'boolean'
    | 'select'
    | 'string-array'
    | 'json'
    | 'model-select';
  required: boolean;
  secret: boolean;
  helpUrl?: string;
  helpText?: string;
  placeholder?: string;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
  showWhen?: { field: string; equals: string | string[] };
};

export type AdminSetupWizardProps = {
  textProviders: AddableProviderProps[];
  imageVideoProviders: AddableProviderProps[];
  voiceProviders: AddableProviderProps[];
  initialActive: {
    text: string | null;
    imageVideo: string | null;
    voice: string | null;
  };
  /**
   * When the admin reloads `/admin/setup` after `app.setup_completed_at`
   * has already been flipped (but before they've resolved their personal
   * onboarding choice), the page mounts the wizard directly at the
   * `finalize` stage so they can pick single-user vs admin-only.
   */
  initialStage?: Stage;
};

const STAGE_ORDER: Stage[] = ['text', 'image-video', 'voice', 'finalize'];

export function AdminSetupWizard({
  textProviders,
  imageVideoProviders,
  voiceProviders,
  initialActive,
  initialStage = 'text',
}: AdminSetupWizardProps) {
  const [stage, setStage] = useState<Stage>(initialStage);
  const [pickedText, setPickedText] = useState<string | null>(initialActive.text);
  const [pickedImageVideo, setPickedImageVideo] = useState<string | null>(
    initialActive.imageVideo,
  );
  const [pickedVoice, setPickedVoice] = useState<string | null>(
    initialActive.voice,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const stepNumber = STAGE_ORDER.indexOf(stage) + 1;
  const totalSteps = STAGE_ORDER.length;

  function goNext(next: Stage): void {
    setError(null);
    // Auto-skip image/video when the active text provider is already
    // the Vercel AI Gateway — the same key covers both.
    if (next === 'image-video' && pickedText === 'vercel-gateway') {
      setStage('voice');
      return;
    }
    setStage(next);
  }

  function goBack(): void {
    setError(null);
    const idx = STAGE_ORDER.indexOf(stage);
    if (idx <= 0) return;
    let prev = STAGE_ORDER[idx - 1];
    if (prev === 'image-video' && pickedText === 'vercel-gateway') {
      prev = 'text';
    }
    setStage(prev);
  }

  function handleFinalizeAndContinue(): void {
    setError(null);
    startTransition(async () => {
      const result = await finalizeAdminSetupAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await handoffContinue();
    });
  }

  function handleFinalizeAndSkip(): void {
    setError(null);
    startTransition(async () => {
      const result = await finalizeAdminSetupAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await handoffSkip();
    });
  }

  if (stage === 'finalize') {
    return (
      <StepShell
        mascotLabel="MastraClaw"
        step={stepNumber}
        totalSteps={totalSteps}
        question="Ready to finish?"
        footer={<BackButton onClick={goBack} canGoBack />}
      >
        <div className="flex flex-col gap-6 text-sm text-muted-foreground">
          <p>
            You can change any of this later from the settings — switch
            providers, swap voices, or connect new messaging accounts
            without coming back here.
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              Text provider:{' '}
              <strong>{pickedText ?? 'not configured'}</strong>
            </li>
            <li>
              Image &amp; video:{' '}
              <strong>
                {pickedText === 'vercel-gateway'
                  ? 'shared with Vercel AI Gateway'
                  : (pickedImageVideo ?? 'skipped')}
              </strong>
            </li>
            <li>
              Voice (Speech ↔ Text):{' '}
              <strong>{pickedVoice ?? 'skipped'}</strong>
            </li>
          </ul>

          <HandoffStep
            pending={pending}
            onContinue={handleFinalizeAndContinue}
            onSkip={handleFinalizeAndSkip}
          />

          {error && <p className="text-destructive">{error}</p>}
        </div>
      </StepShell>
    );
  }

  const config = stageConfig[stage];
  const providers =
    stage === 'text'
      ? textProviders
      : stage === 'image-video'
        ? imageVideoProviders
        : voiceProviders;
  const picked =
    stage === 'text'
      ? pickedText
      : stage === 'image-video'
        ? pickedImageVideo
        : pickedVoice;
  const setPicked =
    stage === 'text'
      ? setPickedText
      : stage === 'image-video'
        ? setPickedImageVideo
        : setPickedVoice;

  const pickedDescriptor = providers.find((p) => p.id === picked);

  return (
    <StepShell
      mascotLabel="MastraClaw"
      step={stepNumber}
      totalSteps={totalSteps}
      question={config.question}
      footer={
        <>
          <BackButton onClick={goBack} canGoBack={stage !== 'text'} />
          {stage !== 'text' && (
            <button
              type="button"
              onClick={() => goNext(nextStage(stage))}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Skip this step
            </button>
          )}
          {!pickedDescriptor && stage === 'text' && (
            <span className="text-xs text-muted-foreground">
              Pick a provider to continue
            </span>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <InfoBox title={config.helpTitle}>{config.helpBody}</InfoBox>

        <ProviderPicker
          providers={providers}
          picked={picked}
          onPick={setPicked}
        />

        {pickedDescriptor && (
          <div className="rounded-xl border bg-card p-4">
            <DescriptorConfigForm
              descriptor={{
                id: pickedDescriptor.id,
                displayName: pickedDescriptor.displayName,
                fields: pickedDescriptor.fields,
              }}
              secretFieldStatus={{}}
              submitLabel="Save & continue"
              onSubmit={async (values) => {
                const result = await saveProviderConfigAction(
                  stageCategory(stage),
                  pickedDescriptor.id,
                  values,
                  { setActive: true },
                );
                if (result.ok) {
                  goNext(nextStage(stage));
                }
                return result;
              }}
              onProbe={async (values) =>
                (await probeProviderAction(
                  stageCategory(stage),
                  pickedDescriptor.id,
                  values,
                )) as DescriptorFormSubmitResult
              }
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </StepShell>
  );
}

// ---------------------------------------------------------------------------
// Provider picker
// ---------------------------------------------------------------------------

function ProviderPicker({
  providers,
  picked,
  onPick,
}: {
  providers: AddableProviderProps[];
  picked: string | null;
  onPick: (id: string) => void;
}) {
  if (providers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No providers available in this category yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {providers.map((p) => {
        const active = p.id === picked;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className={[
              'rounded-xl border px-4 py-4 text-left text-sm transition-all',
              active
                ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                : 'hover:border-foreground/30 hover:bg-muted/40',
            ].join(' ')}
          >
            <div className="flex items-center justify-between gap-2">
              <strong className="font-medium">{p.displayName}</strong>
              {p.badge && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                  {p.badge}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{p.blurb}</p>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage helpers
// ---------------------------------------------------------------------------

function stageCategory(stage: Stage): ProviderCategory {
  switch (stage) {
    case 'text':
      return 'text';
    case 'image-video':
      return 'image-video';
    case 'voice':
      return 'voice';
    case 'finalize':
      throw new Error('finalize has no category');
  }
}

function nextStage(stage: Stage): Stage {
  switch (stage) {
    case 'text':
      return 'image-video';
    case 'image-video':
      return 'voice';
    case 'voice':
      return 'finalize';
    case 'finalize':
      return 'finalize';
  }
}

const stageConfig: Record<
  Exclude<Stage, 'finalize'>,
  { question: string; helpTitle: string; helpBody: React.ReactNode }
> = {
  text: {
    question: 'Pick a text-model provider',
    helpTitle: 'What is this?',
    helpBody: (
      <>
        <p>
          The text model is the LLM your assistant uses for chat, reasoning,
          and tool use. Vercel AI Gateway is the recommended option because a
          single key unlocks Anthropic, OpenAI, Google, and the OpenRouter
          catalog — and it also covers image and video generation, so the
          next step skips automatically.
        </p>
      </>
    ),
  },
  'image-video': {
    question: 'Image and video provider (optional)',
    helpTitle: 'When do I need this?',
    helpBody: (
      <p>
        Configure this only if you want the assistant to generate or edit
        images and videos. You can skip and add it later from the
        settings.
      </p>
    ),
  },
  voice: {
    question: 'Voice provider (optional)',
    helpTitle: 'What is this for?',
    helpBody: (
      <p>
        A voice provider lets the assistant speak (Text-to-Speech) and
        listen (Speech-to-Text) on channels that support audio messages.
        We only carry providers that do both directions, so one
        configuration covers the full voice round-trip. Skip if you only
        need text — the voice toggle on each channel stays disabled until
        a voice provider is active.
      </p>
    ),
  },
};
