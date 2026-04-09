'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { BackButton } from '@/components/wizard/back-button';
import { InfoBox, StepShell } from '@/components/wizard/step-shell';

import {
  commitAdminSetupAction,
  probeComposioAction,
  probeElevenlabsAction,
  probeImageVideoAction,
  probeLlmAction,
  probeTelegramAction,
  type AdminSetupDraft,
} from '../actions';
import type { LlmProvider } from '@/lib/setup/probes';

/**
 * Single client component that drives the entire admin setup flow.
 *
 * All in-progress state lives in `useState` here. NO database writes
 * happen until the very last step (Composio) — at that point we call
 * `commitAdminSetupAction(draft)` which atomically writes everything
 * (Vault secrets + app_settings rows + setup_completed_at).
 *
 * Each step has a Back button that simply decrements `step` — no
 * server round-trip, no DB cleanup. Continue runs the relevant probe
 * server-side (which is pure — no writes), and only advances `step`
 * if the probe returns ok=true. Probe results that downstream steps
 * need (like the model list from step 2) are stored on the draft.
 */

type DraftState = AdminSetupDraft & {
  llmModels: string[];
  telegramBotUsername: string | null;
};

const PROVIDERS: Array<{
  id: LlmProvider;
  name: string;
  badge?: string;
  short: string;
  why: string;
}> = [
  {
    id: 'vercel-gateway',
    name: 'Vercel AI Gateway',
    badge: 'Recommended',
    short: 'Text + image + video + search, one key.',
    why: 'Vercel AI Gateway gives you Anthropic, OpenAI, Google, and OpenRouter through a single account — plus Perplexity & parallel.ai for search and image / video generation. One key, one bill, fewer accounts to manage.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    short: 'Direct Claude API.',
    why: 'Use Anthropic directly when you already have an account or need access to features that aren\'t on the gateway yet.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    short: 'Direct GPT API.',
    why: 'Use OpenAI directly for the GPT model family.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    short: 'Aggregator across many providers.',
    why: 'OpenRouter routes one key to dozens of providers — useful for experimentation, less curated than the Vercel gateway.',
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    short: 'Ollama, LM Studio, vLLM, private deployments.',
    why: 'Point at any OpenAI-compatible endpoint via base URL.',
  },
];

const PROVIDER_KEY_HELP: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  openrouter: 'https://openrouter.ai/keys',
  'vercel-gateway': 'https://vercel.com/dashboard/ai-gateway',
};

const TOTAL_STEPS = 7;

export function AdminSetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7>(1);
  const [draft, setDraft] = useState<DraftState>({
    provider: 'vercel-gateway',
    customBaseUrl: null,
    llmKey: '',
    llmModels: [],
    defaultTextModel: '',
    imageVideoSkipped: false,
    imageVideoKey: null,
    elevenlabsSkipped: false,
    elevenlabsKey: null,
    telegramSkipped: false,
    telegramToken: null,
    telegramBotUsername: null,
    composioSkipped: false,
    composioKey: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const update = (patch: Partial<DraftState>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const goBack = () => {
    setError(null);
    if (step === 1) return;
    // Auto-skipped image/video step (when text provider is Vercel AI
    // Gateway): skip back over it too.
    if (step === 5 && draft.provider === 'vercel-gateway') {
      setStep(3);
      return;
    }
    setStep((step - 1) as typeof step);
  };

  const advance = (skipImageVideo: boolean) => {
    setError(null);
    if (step === 7) return;
    if (step === 3 && skipImageVideo) {
      setStep(5);
      return;
    }
    setStep((step + 1) as typeof step);
  };

  // ----- Step 1: provider -----
  const onContinueProvider = () => {
    setError(null);
    if (!draft.provider) {
      setError('Pick a provider');
      return;
    }
    if (draft.provider === 'custom' && !draft.customBaseUrl) {
      setError('Custom provider requires a base URL');
      return;
    }
    advance(false);
  };

  // ----- Step 2: LLM key -----
  const onContinueLlmKey = () => {
    setError(null);
    if (!draft.llmKey.trim()) {
      setError('API key is empty');
      return;
    }
    startTransition(async () => {
      const res = await probeLlmAction(
        draft.provider,
        draft.llmKey.trim(),
        draft.customBaseUrl,
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Pre-select a sensible default model from the returned list
      const defaultGuess =
        res.models.find((m) => /sonnet|gpt-4o|gpt-5|claude-3-5/i.test(m)) ??
        res.models[0] ??
        '';
      update({ llmModels: res.models, defaultTextModel: defaultGuess });
      advance(false);
    });
  };

  // ----- Step 3: model -----
  const onContinueModel = () => {
    setError(null);
    if (!draft.defaultTextModel) {
      setError('Pick a model');
      return;
    }
    // Auto-skip image/video if the text provider is already AI Gateway
    advance(draft.provider === 'vercel-gateway');
  };

  // ----- Step 4: image/video -----
  const onContinueImageVideo = (skip: boolean) => {
    setError(null);
    if (skip) {
      update({ imageVideoSkipped: true, imageVideoKey: null });
      advance(false);
      return;
    }
    if (!draft.imageVideoKey?.trim()) {
      setError('API key is empty');
      return;
    }
    startTransition(async () => {
      const res = await probeImageVideoAction(draft.imageVideoKey!.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      update({ imageVideoSkipped: false });
      advance(false);
    });
  };

  // ----- Step 5: ElevenLabs -----
  const onContinueElevenlabs = (skip: boolean) => {
    setError(null);
    if (skip) {
      update({ elevenlabsSkipped: true, elevenlabsKey: null });
      advance(false);
      return;
    }
    if (!draft.elevenlabsKey?.trim()) {
      setError('API key is empty');
      return;
    }
    startTransition(async () => {
      const res = await probeElevenlabsAction(draft.elevenlabsKey!.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      update({ elevenlabsSkipped: false });
      advance(false);
    });
  };

  // ----- Step 6: Telegram -----
  const onContinueTelegram = (skip: boolean) => {
    setError(null);
    if (skip) {
      update({
        telegramSkipped: true,
        telegramToken: null,
        telegramBotUsername: null,
      });
      advance(false);
      return;
    }
    if (!draft.telegramToken?.trim()) {
      setError('Bot token is empty');
      return;
    }
    startTransition(async () => {
      const res = await probeTelegramAction(draft.telegramToken!.trim());
      if (!res.ok) {
        setError(res.error);
        return;
      }
      update({ telegramSkipped: false, telegramBotUsername: res.botUsername });
      advance(false);
    });
  };

  // ----- Step 7: Composio + final commit -----
  const onFinishComposio = (skip: boolean) => {
    setError(null);
    const next: DraftState = skip
      ? { ...draft, composioSkipped: true, composioKey: null }
      : draft;

    if (!skip && !next.composioKey?.trim()) {
      setError('API key is empty');
      return;
    }

    startTransition(async () => {
      if (!skip) {
        const res = await probeComposioAction(next.composioKey!.trim());
        if (!res.ok) {
          setError(res.error);
          return;
        }
      }

      // Final commit — single atomic write of everything
      const { llmModels: _, telegramBotUsername: __, ...committable } = next;
      const commit = await commitAdminSetupAction(committable);
      if (!commit.ok) {
        setError(commit.error);
        return;
      }
      // Proxy gate now sees app.setup_completed_at and will route us
      // off /admin/setup → handoff screen on the next navigation.
      router.refresh();
    });
  };

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  // The first step has nothing to go back to — BackButton omits itself
  // entirely when canGoBack is false.
  const footer = (
    backDisabled: boolean,
    onContinue: () => void,
    continueDisabled: boolean,
    continueLabel: string = 'Continue',
    skipButton?: ReactNode,
  ) => (
    <>
      <div className="flex items-center gap-4">
        <BackButton
          onClick={goBack}
          disabled={isPending}
          canGoBack={!backDisabled}
        />
        {skipButton}
      </div>
      <button
        type="button"
        onClick={onContinue}
        disabled={continueDisabled || isPending}
        className="inline-flex h-10 items-center rounded-lg bg-amber-500 px-5 text-sm font-semibold text-black shadow-[0_8px_32px_-8px_rgba(245,158,11,0.5)] transition-all hover:bg-amber-400 disabled:pointer-events-none disabled:opacity-40"
      >
        {isPending ? 'Working…' : continueLabel}
      </button>
    </>
  );

  // Render-step lookup keeps the JSX flat
  switch (step) {
    case 1:
      return (
        <StepShell
          mascotLabel="MastraClaw"
          step={1}
          totalSteps={TOTAL_STEPS}
          question="Pick your AI brain"
          footer={footer(true, onContinueProvider, !draft.provider)}
        >
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => update({ provider: p.id })}
                  className={`group relative flex flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition-all ${
                    draft.provider === p.id
                      ? 'border-amber-400/60 bg-amber-500/[0.08] ring-2 ring-amber-400/30'
                      : 'border-white/[0.08] bg-white/[0.025] hover:border-white/[0.18] hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      {p.name}
                    </span>
                    {p.badge ? (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.15em] text-amber-200">
                        {p.badge}
                      </span>
                    ) : null}
                  </div>
                  <span className="text-xs text-white/55">{p.short}</span>
                </button>
              ))}
            </div>

            {draft.provider === 'custom' && (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="customBaseUrl"
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45"
                >
                  Base URL
                </label>
                <input
                  id="customBaseUrl"
                  type="url"
                  placeholder="https://your-endpoint.example/v1"
                  value={draft.customBaseUrl ?? ''}
                  onChange={(e) =>
                    update({ customBaseUrl: e.target.value || null })
                  }
                  className="h-11 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 text-sm text-white/90 placeholder:text-white/25 outline-none transition-all focus:border-amber-400/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-amber-400/15"
                />
              </div>
            )}

            <InfoBox>
              <p>
                We recommend <strong>Vercel AI Gateway</strong> because it
                gives you access to Claude, GPT, Gemini, image generation,
                video generation, and even search providers like Perplexity
                and parallel.ai —{' '}
                <em>through one single account and one key</em>. You can
                change this later.
              </p>
              <p className="text-white/55">
                {PROVIDERS.find((p) => p.id === draft.provider)?.why}
              </p>
            </InfoBox>

            {error && <ErrorBox message={error} />}
          </div>
        </StepShell>
      );

    case 2:
      return (
        <StepShell
          mascotLabel="MastraClaw"
          step={2}
          totalSteps={TOTAL_STEPS}
          question="Drop in your API key"
          footer={footer(
            false,
            onContinueLlmKey,
            !draft.llmKey.trim(),
            'Test & Continue',
          )}
          thinking={isPending}
        >
          <div className="flex flex-col gap-5">
            <KeyInput
              label="API Key"
              placeholder={
                draft.provider === 'anthropic'
                  ? 'sk-ant-…'
                  : draft.provider === 'vercel-gateway'
                    ? 'gw_…'
                    : 'sk-…'
              }
              helpHref={PROVIDER_KEY_HELP[draft.provider]}
              value={draft.llmKey}
              onChange={(v) => update({ llmKey: v })}
              disabled={isPending}
            />
            <InfoBox>
              <p>
                Paste the API key for your selected provider. We hit their
                /models endpoint to make sure the key works <em>before</em>{' '}
                advancing — if the test fails, you stay on this screen with
                an inline error.
              </p>
              <p className="text-white/55">
                Nothing is written to the database during the wizard. The
                key is held in memory until you finish the last step, at
                which point everything is saved at once.
              </p>
            </InfoBox>
            {error && <ErrorBox message={error} />}
          </div>
        </StepShell>
      );

    case 3:
      return (
        <StepShell
          mascotLabel="MastraClaw"
          step={3}
          totalSteps={TOTAL_STEPS}
          question="Pick a default model"
          footer={footer(false, onContinueModel, !draft.defaultTextModel)}
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="model"
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45"
              >
                Default text model
              </label>
              <select
                id="model"
                value={draft.defaultTextModel}
                onChange={(e) => update({ defaultTextModel: e.target.value })}
                className="h-11 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 text-sm text-white/90 outline-none transition-all focus:border-amber-400/50"
              >
                {draft.llmModels.length === 0 ? (
                  <option value="">— no models available —</option>
                ) : (
                  draft.llmModels.map((m) => (
                    <option key={m} value={m} className="bg-[#08080b]">
                      {m}
                    </option>
                  ))
                )}
              </select>
            </div>
            <InfoBox>
              <p>
                Pick the default model your assistant uses for chat. You
                can override this later per agent or per request.
              </p>
            </InfoBox>
            {error && <ErrorBox message={error} />}
          </div>
        </StepShell>
      );

    case 4:
      return (
        <StepShell
          mascotLabel="MastraClaw"
          step={4}
          totalSteps={TOTAL_STEPS}
          question="Image &amp; video generation"
          footer={footer(
            false,
            () => onContinueImageVideo(false),
            !draft.imageVideoKey?.trim(),
            'Test & Continue',
            <button
              type="button"
              onClick={() => onContinueImageVideo(true)}
              disabled={isPending}
              className="text-sm text-white/50 transition-colors hover:text-white/80 disabled:opacity-40"
            >
              Skip — I don&apos;t need image/video
            </button>,
          )}
          thinking={isPending}
        >
          <div className="flex flex-col gap-5">
            <KeyInput
              label="Vercel AI Gateway API Key"
              placeholder="gw_…"
              helpHref="https://vercel.com/dashboard/ai-gateway"
              value={draft.imageVideoKey ?? ''}
              onChange={(v) => update({ imageVideoKey: v || null })}
              disabled={isPending}
            />
            <InfoBox>
              <p>
                Image and video generation use Vercel AI Gateway as a
                separate, optional capability. Skip this step if you only
                need text — you can come back later from settings.
              </p>
            </InfoBox>
            {error && <ErrorBox message={error} />}
          </div>
        </StepShell>
      );

    case 5:
      return (
        <StepShell
          mascotLabel="MastraClaw"
          step={5}
          totalSteps={TOTAL_STEPS}
          question="Want a voice?"
          footer={footer(
            false,
            () => onContinueElevenlabs(false),
            !draft.elevenlabsKey?.trim(),
            'Test & Continue',
            <button
              type="button"
              onClick={() => onContinueElevenlabs(true)}
              disabled={isPending}
              className="text-sm text-white/50 transition-colors hover:text-white/80 disabled:opacity-40"
            >
              Skip — no voice for now
            </button>,
          )}
          thinking={isPending}
        >
          <div className="flex flex-col gap-5">
            <KeyInput
              label="ElevenLabs API Key"
              placeholder="sk_…"
              helpHref="https://elevenlabs.io/app/settings/api-keys"
              value={draft.elevenlabsKey ?? ''}
              onChange={(v) => update({ elevenlabsKey: v || null })}
              disabled={isPending}
            />
            <InfoBox>
              <p>
                ElevenLabs powers your assistant&apos;s voice (text-to-speech).
                Without a key, voice mode stays off — the chat UI still
                works.
              </p>
              <p className="text-white/55">
                Voice ID and model ID are pre-configured as deployment
                defaults. An admin can override them later from settings.
              </p>
            </InfoBox>
            {error && <ErrorBox message={error} />}
          </div>
        </StepShell>
      );

    case 6:
      return (
        <StepShell
          mascotLabel="MastraClaw"
          step={6}
          totalSteps={TOTAL_STEPS}
          question="Telegram bot"
          footer={footer(
            false,
            () => onContinueTelegram(false),
            !draft.telegramToken?.trim(),
            'Test & Continue',
            <button
              type="button"
              onClick={() => onContinueTelegram(true)}
              disabled={isPending}
              className="text-sm text-white/50 transition-colors hover:text-white/80 disabled:opacity-40"
            >
              Skip — no Telegram
            </button>,
          )}
          thinking={isPending}
        >
          <div className="flex flex-col gap-5">
            <KeyInput
              label="Telegram bot token"
              placeholder="123456789:ABC-DEF1234ghIkl…"
              helpHref="https://core.telegram.org/bots/tutorial"
              value={draft.telegramToken ?? ''}
              onChange={(v) => update({ telegramToken: v || null })}
              disabled={isPending}
            />
            <InfoBox>
              <p>
                One Telegram bot for the entire company. Each user later
                links their personal Telegram account during their own
                onboarding.
              </p>
              <p className="text-white/55">
                Don&apos;t have a bot yet? Open Telegram, search for{' '}
                <strong>@BotFather</strong>, send{' '}
                <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px]">
                  /newbot
                </code>
                , answer two questions, paste the token here.
              </p>
            </InfoBox>
            {error && <ErrorBox message={error} />}
          </div>
        </StepShell>
      );

    case 7:
      return (
        <StepShell
          mascotLabel="MastraClaw"
          step={7}
          totalSteps={TOTAL_STEPS}
          question="Composio integrations"
          footer={footer(
            false,
            () => onFinishComposio(false),
            !draft.composioKey?.trim(),
            'Finish setup',
            <button
              type="button"
              onClick={() => onFinishComposio(true)}
              disabled={isPending}
              className="text-sm text-white/50 transition-colors hover:text-white/80 disabled:opacity-40"
            >
              Skip & finish
            </button>,
          )}
          thinking={isPending}
        >
          <div className="flex flex-col gap-5">
            <KeyInput
              label="Composio API key"
              placeholder="ck_…"
              helpHref="https://platform.composio.dev/settings"
              value={draft.composioKey ?? ''}
              onChange={(v) => update({ composioKey: v || null })}
              disabled={isPending}
            />
            <InfoBox title="What is Composio?">
              <p>
                Composio is how your assistant talks to Gmail, Google
                Calendar, Slack, GitHub, Notion, and dozens of other tools
                — without you having to wire each one up by hand or store
                anyone&apos;s password.
              </p>
              <p>
                <strong>One Composio project = your whole company.</strong>{' '}
                This single API key represents the entire MastraClaw
                deployment. Every user who logs in later will connect their
                own Gmail/Slack/etc. accounts under their own private
                namespace inside this one project.
              </p>
              <p className="text-white/65">
                <strong>You don&apos;t connect any accounts here.</strong>{' '}
                This step only saves the company-level key. The actual
                &quot;connect my Gmail&quot; step happens later for each
                user the first time their assistant needs that tool, via a
                one-click OAuth link Composio hosts for you.
              </p>
              <p className="text-white/55">
                No Composio account yet? Sign up at composio.dev, create
                one project, copy the API key, paste it below.
              </p>
            </InfoBox>
            {error && <ErrorBox message={error} />}
          </div>
        </StepShell>
      );
  }
}

// ---------------------------------------------------------------------------
// Tiny presentational helpers
// ---------------------------------------------------------------------------

function KeyInput({
  label,
  placeholder,
  helpHref,
  value,
  onChange,
  disabled,
}: {
  label: string;
  placeholder?: string;
  helpHref?: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
          {label}
        </label>
        {helpHref ? (
          <a
            href={helpHref}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300/70 hover:text-amber-200"
          >
            Where do I get one? ↗
          </a>
        ) : null}
      </div>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="h-11 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 text-sm text-white/90 placeholder:text-white/25 outline-none transition-all focus:border-amber-400/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-amber-400/15"
      />
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3.5 py-2.5 text-xs text-rose-200/90">
      {message}
    </div>
  );
}
