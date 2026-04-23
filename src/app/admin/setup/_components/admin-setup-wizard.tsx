'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
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

import { finalizeAdminSetupAction } from '../actions';
import { BrandingStep } from './branding-step';

/**
 * Six-stage admin setup wizard.
 *
 *   1. Branding (optional) — company name + organization prompt
 *   2. Text provider (required)
 *   3. Embedding provider (required) — semantic recall + RAG fail
 *      loudly without one
 *   4. Image/video provider (optional; auto-skipped when the text
 *      provider is Vercel AI Gateway — the gateway already covers
 *      image/video AND embedding, so those slots are pre-seeded)
 *   5. Voice provider (optional)
 *   6. Finalize → flip `app.setup_completed_at`, redirect to
 *      `/admin/settings`. No handoff screen (personal onboarding
 *      removed).
 *
 * Every provider step writes the moment the admin clicks Save inside
 * the form. Back navigation is allowed but does NOT roll back stored
 * configs — the admin can revisit a step to swap providers. The
 * providers are independently editable from `/admin/settings` after
 * setup.
 */

export type Stage =
  | 'branding'
  | 'text'
  | 'embedding'
  | 'image-video'
  | 'voice'
  | 'finalize';

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
  modelKind?: 'text' | 'embedding' | 'image' | 'video';
};

export type AdminSetupWizardProps = {
  textProviders: AddableProviderProps[];
  embeddingProviders: AddableProviderProps[];
  imageVideoProviders: AddableProviderProps[];
  voiceProviders: AddableProviderProps[];
  initialActive: {
    text: string | null;
    embedding: string | null;
    imageVideo: string | null;
    voice: string | null;
  };
  initialBranding: {
    name: string | null;
    organizationPrompt: string | null;
  };
};

const STAGE_ORDER: Stage[] = [
  'branding',
  'text',
  'embedding',
  'image-video',
  'voice',
  'finalize',
];

export function AdminSetupWizard({
  textProviders,
  embeddingProviders,
  imageVideoProviders,
  voiceProviders,
  initialActive,
  initialBranding,
}: AdminSetupWizardProps) {
  const [stage, setStage] = useState<Stage>('branding');
  const [pickedText, setPickedText] = useState<string | null>(initialActive.text);
  const [pickedEmbedding, setPickedEmbedding] = useState<string | null>(
    initialActive.embedding,
  );
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
    // Auto-skip embedding + image-video when the text provider is
    // Vercel AI Gateway. The gateway's key was already fanned out to
    // both slots by `saveProviderConfigAction`, so the admin doesn't
    // need to redo anything.
    if (pickedText === 'vercel-gateway') {
      if (next === 'embedding') {
        setStage('voice');
        return;
      }
      if (next === 'image-video') {
        setStage('voice');
        return;
      }
    }
    setStage(next);
  }

  function goBack(): void {
    setError(null);
    const idx = STAGE_ORDER.indexOf(stage);
    if (idx <= 0) return;
    let prev = STAGE_ORDER[idx - 1];
    // Mirror the Gateway auto-skip on the way back.
    if (
      pickedText === 'vercel-gateway' &&
      (prev === 'image-video' || prev === 'embedding')
    ) {
      prev = 'text';
    }
    setStage(prev);
  }

  function handleFinalize(): void {
    setError(null);
    startTransition(async () => {
      const result = await finalizeAdminSetupAction();
      // A successful action redirects before returning; we only land
      // here on failure.
      if (result && !result.ok) {
        setError(result.error);
      }
    });
  }

  if (stage === 'branding') {
    return (
      <StepShell
        mascotLabel="MastraClaw"
        step={stepNumber}
        totalSteps={totalSteps}
        question="Brand this instance (optional)"
        footer={null}
      >
        <BrandingStep
          initialName={initialBranding.name}
          initialOrganizationPrompt={initialBranding.organizationPrompt}
          onContinue={() => setStage('text')}
          onSkip={() => setStage('text')}
        />
      </StepShell>
    );
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
            providers or swap voices without coming back here.
          </p>
          <ul className="ml-4 list-disc space-y-1">
            <li>
              Text provider:{' '}
              <strong>{pickedText ?? 'not configured'}</strong>
            </li>
            <li>
              Embedding provider:{' '}
              <strong>
                {pickedText === 'vercel-gateway'
                  ? 'shared with Vercel AI Gateway'
                  : (pickedEmbedding ?? 'not configured')}
              </strong>
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

          <div className="flex items-center justify-end gap-3">
            <Button onClick={handleFinalize} disabled={pending}>
              {pending ? 'Finishing…' : 'Finish setup'}
            </Button>
          </div>

          {error && <p className="text-destructive">{error}</p>}
        </div>
      </StepShell>
    );
  }

  const config = stageConfig[stage];
  const providers =
    stage === 'text'
      ? textProviders
      : stage === 'embedding'
        ? embeddingProviders
        : stage === 'image-video'
          ? imageVideoProviders
          : voiceProviders;
  const picked =
    stage === 'text'
      ? pickedText
      : stage === 'embedding'
        ? pickedEmbedding
        : stage === 'image-video'
          ? pickedImageVideo
          : pickedVoice;
  const setPicked =
    stage === 'text'
      ? setPickedText
      : stage === 'embedding'
        ? setPickedEmbedding
        : stage === 'image-video'
          ? setPickedImageVideo
          : setPickedVoice;

  const pickedDescriptor = providers.find((p) => p.id === picked);

  const stepRequired = stage === 'text' || stage === 'embedding';

  return (
    <StepShell
      mascotLabel="MastraClaw"
      step={stepNumber}
      totalSteps={totalSteps}
      question={config.question}
      footer={
        <>
          <BackButton onClick={goBack} canGoBack />
          {!stepRequired && (
            <button
              type="button"
              onClick={() => goNext(nextStage(stage))}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Skip this step
            </button>
          )}
          {!pickedDescriptor && stepRequired && (
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

function stageCategory(
  stage: Exclude<Stage, 'branding' | 'finalize'>,
): ProviderCategory {
  switch (stage) {
    case 'text':
      return 'text';
    case 'embedding':
      return 'embedding';
    case 'image-video':
      return 'image-video';
    case 'voice':
      return 'voice';
  }
}

function nextStage(stage: Stage): Stage {
  switch (stage) {
    case 'branding':
      return 'text';
    case 'text':
      return 'embedding';
    case 'embedding':
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
  Exclude<Stage, 'branding' | 'finalize'>,
  { question: string; helpTitle: string; helpBody: React.ReactNode }
> = {
  text: {
    question: 'Pick a text-model provider',
    helpTitle: 'What is this?',
    helpBody: (
      <p>
        The text model is the LLM your assistant uses for chat,
        reasoning, and tool use. Vercel AI Gateway is the recommended
        option because a single key unlocks Anthropic, OpenAI, Google,
        and the OpenRouter catalog — and it also covers embedding and
        image/video generation, so the next steps skip automatically.
      </p>
    ),
  },
  embedding: {
    question: 'Pick an embedding provider',
    helpTitle: 'Why is this required?',
    helpBody: (
      <p>
        Semantic recall (cross-thread memory) and any RAG workflow
        require an embedding model. We fail loudly if none is
        configured, rather than silently degrading. Embedding providers
        are independent from text providers because not every text
        provider exposes embeddings (Anthropic doesn&apos;t).
      </p>
    ),
  },
  'image-video': {
    question: 'Image and video provider (optional)',
    helpTitle: 'When do I need this?',
    helpBody: (
      <p>
        Configure this only if you want the assistant to generate or
        edit images and videos. You can skip and add it later from the
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
        listen (Speech-to-Text). We only carry providers that do both
        directions, so one configuration covers the full voice
        round-trip. Skip if you only need text.
      </p>
    ),
  },
};
