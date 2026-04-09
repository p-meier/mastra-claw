'use client';

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAssistantRuntime,
  useMessage,
  useThread,
} from '@assistant-ui/react';
import {
  AssistantChatTransport,
  useChatRuntime,
} from '@assistant-ui/react-ai-sdk';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

import { MarkdownText } from '@/components/assistant-ui/markdown-text';
import { BackButton } from '@/components/wizard/back-button';
import { InfoBox, StepShell } from '@/components/wizard/step-shell';
import { Mascot, type MascotAccessory } from '@/components/wizard/mascot';
import { ThinkingDots } from '@/components/wizard/thinking-dots';

/**
 * Personal Onboarding wizard — single client component.
 *
 * State machine (dynamic — Telegram step only renders if the admin
 * configured a bot at the instance level):
 *
 *   1. tone           (form, no DB writes)
 *   2. telegram       (form, optional, only if telegramConfiguredOnInstance,
 *                     no DB writes)
 *   3. bootstrap chat (LLM chat — terminal step; the chat's
 *                     complete_bootstrap tool fires the single atomic
 *                     commit)
 *
 * The user's *nickname* is captured INSIDE the bootstrap chat as the
 * very first question — it's not a separate form step. Same for
 * everything else about the user; the chat is the single source of
 * truth for the persona Markdown that lands in user_profiles.
 *
 * Back navigation works between form steps freely. From the bootstrap
 * chat sub-view, the "Back to setup" link drops the user back into the
 * previous form step (draft preserved, chat thread cleared).
 *
 * Nothing is written to Supabase until the bootstrap chat tool fires.
 */

type Tone = 'casual' | 'crisp' | 'friendly' | 'playful';

const TONES: Array<{ id: Tone; label: string }> = [
  { id: 'casual', label: 'no caps, no stress' },
  { id: 'crisp', label: 'crisp & polished' },
  { id: 'friendly', label: 'like texting a friend' },
  { id: 'playful', label: 'delightfully unhinged' },
];

/**
 * Visual hint the mascot wears to mirror the chosen tone — gives the
 * "How should I write?" step some life. The mascot remounts the
 * accessory whenever this changes (see <Accessory key=… /> in
 * mascot.tsx) so the drop-in animation re-fires on every selection.
 */
const TONE_ACCESSORY: Record<Tone, MascotAccessory> = {
  casual: 'phone',
  crisp: 'briefcase',
  friendly: 'heart',
  playful: 'sparkles',
};

export type OnboardingWizardProps = {
  /** Whether the admin set up Telegram for this instance */
  telegramConfiguredOnInstance: boolean;
};

type Stage = 'tone' | 'telegram' | 'bootstrap';

type Draft = {
  tone: Tone;
  telegramSkipped: boolean;
  telegramUserId: string;
};

export function OnboardingWizard({
  telegramConfiguredOnInstance,
}: OnboardingWizardProps) {
  const [stage, setStage] = useState<Stage>('tone');
  const [draft, setDraft] = useState<Draft>({
    // Pre-select the most-common option so a hesitant user can just
    // click Continue. They can always pick a different one if they want.
    tone: 'casual',
    telegramSkipped: false,
    telegramUserId: '',
  });
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<Draft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  // Total form steps before the bootstrap chat: 1 (just tone) or 2
  // (tone + telegram). Used by the StepShell progress dots so they
  // reflect actual progress, not a hardcoded count.
  const totalSteps = telegramConfiguredOnInstance ? 3 : 2;
  const stepNumber = (() => {
    if (stage === 'tone') return 1;
    if (stage === 'telegram') return 2;
    return totalSteps; // bootstrap is always the last step
  })();

  const goNext = () => {
    setError(null);
    if (stage === 'tone') {
      // Skip telegram step if admin didn't configure it
      setStage(telegramConfiguredOnInstance ? 'telegram' : 'bootstrap');
    } else if (stage === 'telegram') {
      if (
        !draft.telegramSkipped &&
        (!draft.telegramUserId.trim() || !/^\d+$/.test(draft.telegramUserId))
      ) {
        setError('Telegram user ID must be a number, or click Skip');
        return;
      }
      setStage('bootstrap');
    }
  };

  const goBack = () => {
    setError(null);
    if (stage === 'telegram') setStage('tone');
    else if (stage === 'bootstrap') {
      setStage(telegramConfiguredOnInstance ? 'telegram' : 'tone');
    }
  };

  // ----- bootstrap stage renders the chat sub-view -----
  if (stage === 'bootstrap') {
    return <BootstrapStage draft={draft} onBack={goBack} />;
  }

  // ----- form stages -----
  // Step 1 (tone) has nothing to go back to — BackButton omits itself
  // entirely when canGoBack is false.
  const footer = (
    onContinue: () => void,
    continueDisabled: boolean,
    skipButton?: ReactNode,
  ) => (
    <>
      <div className="flex items-center gap-4">
        <BackButton onClick={goBack} canGoBack={stage !== 'tone'} />
        {skipButton}
      </div>
      <button
        type="button"
        onClick={onContinue}
        disabled={continueDisabled}
        className="inline-flex h-10 items-center rounded-lg bg-amber-500 px-5 text-sm font-semibold text-black shadow-[0_8px_32px_-8px_rgba(245,158,11,0.5)] transition-all hover:bg-amber-400 disabled:pointer-events-none disabled:opacity-40"
      >
        Continue
      </button>
    </>
  );

  switch (stage) {
    case 'tone':
      return (
        <StepShell
          mascotLabel="Your Personal Assistant"
          accessory={TONE_ACCESSORY[draft.tone]}
          step={stepNumber}
          totalSteps={totalSteps}
          question="How should I write to you?"
          footer={footer(goNext, false)}
        >
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => update({ tone: t.id })}
                  className={`rounded-xl border px-4 py-4 text-left text-sm transition-all ${
                    draft.tone === t.id
                      ? 'border-amber-400/60 bg-amber-500/[0.08] text-white ring-2 ring-amber-400/30'
                      : 'border-white/[0.10] bg-white/[0.025] text-white/75 hover:border-white/[0.20] hover:bg-white/[0.04]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <InfoBox>
              <p>
                This sets the default communication style your assistant
                uses. You can fine-tune it later from settings.
              </p>
            </InfoBox>
            {error && <ErrorBox message={error} />}
          </div>
        </StepShell>
      );

    case 'telegram':
      return (
        <StepShell
          mascotLabel="Your Personal Assistant"
          accessory="phone"
          step={stepNumber}
          totalSteps={totalSteps}
          question="Telegram access"
          footer={footer(
            goNext,
            !draft.telegramSkipped && !draft.telegramUserId.trim(),
            <button
              type="button"
              onClick={() => {
                update({ telegramSkipped: true, telegramUserId: '' });
                setStage('bootstrap');
              }}
              className="text-sm text-white/50 transition-colors hover:text-white/80"
            >
              Skip — no Telegram for me
            </button>,
          )}
        >
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label
                htmlFor="telegramUserId"
                className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45"
              >
                Your Telegram User ID (numeric)
              </label>
              <input
                id="telegramUserId"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={draft.telegramUserId}
                onChange={(e) =>
                  update({
                    telegramUserId: e.target.value,
                    telegramSkipped: false,
                  })
                }
                placeholder="2083759357"
                className="h-11 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 text-sm text-white/90 placeholder:text-white/25 outline-none transition-all focus:border-amber-400/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-amber-400/15"
              />
            </div>
            <InfoBox>
              <p>
                Your assistant lives behind a single Telegram bot for the
                whole company. To allow it to talk to you specifically,
                paste your numeric Telegram User ID below.
              </p>
              <p className="text-white/55">
                Don&apos;t know your ID? Open Telegram and message
                @userinfobot — it replies with your numeric ID.
              </p>
            </InfoBox>
            {error && <ErrorBox message={error} />}
          </div>
        </StepShell>
      );
  }
}

// ---------------------------------------------------------------------------
// Bootstrap chat sub-view
// ---------------------------------------------------------------------------

type BootstrapStageProps = {
  draft: Draft;
  onBack: () => void;
};

type WizardDraftWire = {
  tone: Tone;
  telegramSkipped: boolean;
  telegramUserId: string | null;
};

/**
 * Set up the assistant-ui runtime once for this stage and provide it to
 * the inner shell. We deliberately split the runtime creation from the
 * shell so the shell can call `useAssistantRuntime()` / `useThread()`
 * inside the provider — those hooks throw outside an
 * `AssistantRuntimeProvider`.
 *
 * Pattern (and rationale) mirrors `src/components/agent/agent-chat.tsx`,
 * which is the canonical Mastra-agent chat surface. Same library, same
 * primitives — onboarding is just a `streamText` route instead of a
 * Mastra agent, but the wire format is the same AI SDK v6 UI message
 * stream so `AssistantChatTransport` works against it unchanged.
 */
function BootstrapStage({ draft, onBack }: BootstrapStageProps) {
  const router = useRouter();
  const [completed, setCompleted] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);

  // Memoize so the transport instance survives re-renders. The wizard
  // draft never changes inside the bootstrap stage (the user already
  // committed those steps before landing here), so we can safely depend
  // on its primitive fields.
  const wizardDraft = useMemo<WizardDraftWire>(
    () => ({
      tone: draft.tone,
      telegramSkipped: draft.telegramSkipped,
      telegramUserId: draft.telegramSkipped
        ? null
        : draft.telegramUserId || null,
    }),
    [draft.tone, draft.telegramSkipped, draft.telegramUserId],
  );

  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: '/api/onboarding/bootstrap',
        body: { wizardDraft },
      }),
    [wizardDraft],
  );

  const runtime = useChatRuntime({ transport });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <BootstrapShell
        onBack={onBack}
        completed={completed}
        setCompleted={setCompleted}
        commitError={commitError}
        setCommitError={setCommitError}
        isFinishing={isFinishing}
        setIsFinishing={setIsFinishing}
        wizardDraft={wizardDraft}
        router={router}
      />
    </AssistantRuntimeProvider>
  );
}

type BootstrapShellProps = {
  onBack: () => void;
  completed: boolean;
  setCompleted: (v: boolean) => void;
  commitError: string | null;
  setCommitError: (v: string | null) => void;
  isFinishing: boolean;
  setIsFinishing: (v: boolean) => void;
  wizardDraft: WizardDraftWire;
  router: ReturnType<typeof useRouter>;
};

function BootstrapShell({
  onBack,
  completed,
  setCompleted,
  commitError,
  setCommitError,
  isFinishing,
  setIsFinishing,
  wizardDraft,
  router,
}: BootstrapShellProps) {
  const runtime = useAssistantRuntime();
  // `useThread` keeps this component reactive to thread state changes
  // (running/idle), so the header mascot + thinking overlay update on
  // every stream tick without us having to subscribe by hand.
  const isRunning = useThread((t) => t.isRunning);
  const isThinking = isRunning || isFinishing;

  // Send a hidden kickoff so the assistant introduces itself first.
  // `runtime.thread.append({...})` posts a user message and starts a
  // run; the empty thread becomes a real conversation immediately.
  const initSentRef = useRef(false);
  useEffect(() => {
    if (initSentRef.current) return;
    initSentRef.current = true;
    runtime.thread.append({
      role: 'user',
      content: [{ type: 'text', text: '(begin)' }],
    });
  }, [runtime]);

  // Watch for the `complete_bootstrap` tool result. The runtime fires
  // `subscribe` on every state change; we walk the latest assistant
  // message and look at its tool-call parts. Same semantics as the old
  // `onFinish` callback, just expressed via the runtime's reactive API.
  // We need BOTH that the tool was called AND that the result reported
  // ok=true — earlier (in the useChat era) we triggered success on call
  // alone, which hid commit failures behind a green "All set!" message.
  useEffect(() => {
    return runtime.thread.subscribe(() => {
      if (completed) return;
      const messages = runtime.thread.getState().messages;
      // Walk back from the end — the tool we care about will be in the
      // most recent assistant message.
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role !== 'assistant') continue;
        const toolPart = msg.content.find(
          (p) => p.type === 'tool-call' && p.toolName === 'complete_bootstrap',
        );
        if (!toolPart || toolPart.type !== 'tool-call') break;
        const result = toolPart.result as
          | { ok?: boolean; error?: string }
          | undefined;
        if (result === undefined) break; // still streaming — wait
        if (result.ok === true) {
          setCompleted(true);
          setTimeout(() => router.push('/'), 2000);
        } else if (result.ok === false) {
          setCommitError(result.error ?? 'Failed to save your assistant.');
        }
        break;
      }
    });
  }, [runtime, completed, router, setCompleted, setCommitError]);

  /**
   * Force-finish path — bypasses the chat tool entirely. Posts the full
   * conversation history to /api/onboarding/bootstrap/finalize, which
   * runs generateObject() against the persona schema and commits
   * deterministically. Use when the model is dragging on or stuck.
   *
   * The /finalize route accepts AI SDK UIMessage shape; assistant-ui's
   * AI SDK runtime exports the same shape via `exportExternalState()`.
   */
  const handleFinishNow = async () => {
    if (isFinishing || completed) return;
    setIsFinishing(true);
    setCommitError(null);
    try {
      const messages = runtime.thread.exportExternalState();
      const res = await fetch('/api/onboarding/bootstrap/finalize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages, wizardDraft }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setCommitError(json.error ?? `Finalize failed (HTTP ${res.status})`);
        setIsFinishing(false);
        return;
      }
      setCompleted(true);
      setTimeout(() => router.push('/'), 1500);
    } catch (err) {
      setCommitError(
        err instanceof Error ? err.message : 'Failed to finalize setup',
      );
      setIsFinishing(false);
    }
  };

  return (
    // Fixed-height (svh) flex column: header + thread (flex-1, internal
    // scroll) + composer footer. The page itself never scrolls
    // horizontally — overflow-x-hidden enforces that.
    //
    // The `dark` class scopes the shadcn theme variables to dark mode
    // for this view so the assistant-ui primitives render in white text
    // on the dark background instead of falling back to the light
    // theme's near-black foreground.
    <div className="dark relative isolate flex h-svh min-h-0 flex-col overflow-x-hidden bg-[#08080b] text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[400px] rounded-full opacity-[0.16] blur-3xl sm:size-[700px]"
        style={{
          background:
            'radial-gradient(closest-side, #f59e0b 0%, transparent 70%)',
        }}
      />

      {/* Compact header — small mascot, label, back + finish buttons.
          Uses flex-wrap so on narrow screens the buttons drop below the
          mascot/title block instead of pushing the layout wider than the
          viewport. */}
      <header className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-[#08080b]/80 px-4 py-3 backdrop-blur-xl sm:gap-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="size-10 shrink-0">
            <Mascot
              variant={isRunning ? 'thinking' : 'idle'}
              label={null}
              className="!gap-0 [&>div]:!size-10"
            />
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium text-white">
              Your Personal Assistant
            </span>
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
              Personal setup interview
            </span>
          </div>
        </div>
        {!completed && (
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <BackButton onClick={onBack} canGoBack label="Back" />
            <button
              type="button"
              onClick={handleFinishNow}
              disabled={isFinishing || isThinking}
              title="Summarize what we've talked about and finish setup right now"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-500 px-3 text-xs font-semibold text-black shadow-[0_8px_32px_-8px_rgba(245,158,11,0.5)] transition-all hover:bg-amber-400 disabled:pointer-events-none disabled:opacity-50 sm:h-10 sm:px-4 sm:text-sm"
            >
              {isFinishing ? 'Finalizing…' : 'Finish setup'}
            </button>
          </div>
        )}
      </header>

      {/* Scrollable thread — the only thing that scrolls. */}
      <ThreadPrimitive.Root className="relative z-10 flex min-h-0 flex-1 flex-col">
        <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4 sm:gap-6 sm:px-6 sm:py-6">
            <ThreadPrimitive.Messages
              components={{
                UserMessage: BootstrapUserMessage,
                AssistantMessage: BootstrapAssistantMessage,
              }}
            />
            {commitError && <ErrorBox message={commitError} />}
            {completed && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-center text-sm text-emerald-200">
                All set! Taking you to your dashboard…
              </div>
            )}
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>

      {/* Sticky input — never moves. While the assistant is thinking, an
          overlay covers the input with a 3-dot animation so the user
          can't type, but instead of a flat greyed-out box they see a
          clear "the model is responding" indicator. */}
      <footer className="relative z-10 shrink-0 border-t border-white/[0.06] bg-[#08080b]/80 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4">
        <div className="relative mx-auto w-full max-w-2xl">
          <ComposerPrimitive.Root className="flex w-full items-end gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] p-2 focus-within:border-amber-400/50 focus-within:bg-white/[0.06] focus-within:ring-4 focus-within:ring-amber-400/15">
            <ComposerPrimitive.Input
              rows={1}
              autoFocus
              placeholder={completed ? 'Done!' : 'Type a reply…'}
              disabled={completed}
              className="flex-1 resize-none bg-transparent px-2 py-2 text-sm text-white/90 placeholder:text-white/25 outline-none disabled:opacity-50"
            />
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send asChild>
                <button
                  type="submit"
                  disabled={completed}
                  className="inline-flex size-9 items-center justify-center rounded-md bg-amber-500 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:pointer-events-none disabled:opacity-40"
                >
                  <span aria-hidden>↑</span>
                  <span className="sr-only">Send</span>
                </button>
              </ComposerPrimitive.Send>
            </ThreadPrimitive.If>
            <ThreadPrimitive.If running>
              <ComposerPrimitive.Cancel asChild>
                <button
                  type="button"
                  className="inline-flex size-9 items-center justify-center rounded-md border border-white/[0.10] bg-white/[0.04] text-white/70 transition-colors hover:bg-white/[0.08]"
                >
                  <span aria-hidden>■</span>
                  <span className="sr-only">Stop</span>
                </button>
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
          </ComposerPrimitive.Root>
          {isThinking && !completed && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-start rounded-lg bg-[#08080b]/70 pl-5 backdrop-blur-[2px]"
              aria-hidden
            >
              <ThinkingDots />
              <span className="ml-3 font-mono text-[11px] uppercase tracking-[0.18em] text-amber-200/70">
                Thinking…
              </span>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

/**
 * Custom user message component for the bootstrap thread. Hides the
 * very first user message (the hidden "(begin)" kickoff) so the user
 * sees the assistant's intro as the first thing in the thread, not
 * their own invisible nudge.
 *
 * `useMessage` is reactive — `index` and `role` come straight from the
 * MessageState that the runtime provides per message slot.
 */
function BootstrapUserMessage() {
  const isHiddenKickoff = useMessage((m) => {
    if (m.index !== 0 || m.role !== 'user') return false;
    const text = m.content
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('')
      .trim();
    return text === '(begin)';
  });
  if (isHiddenKickoff) return null;
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[80%] break-words rounded-2xl bg-amber-500/[0.12] px-4 py-2 text-sm text-amber-50 [overflow-wrap:anywhere]">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

/**
 * Custom assistant message component for the bootstrap thread. Renders
 * text parts via the shared `MarkdownText` (streamdown + Shiki +
 * Mermaid), same as the per-agent chat surface.
 */
function BootstrapAssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="max-w-[85%] break-words rounded-2xl bg-white/[0.04] px-4 py-2 text-sm text-white/90 [overflow-wrap:anywhere]">
        <MessagePrimitive.Parts>
          {({ part }) => (part.type === 'text' ? <MarkdownText /> : null)}
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3.5 py-2.5 text-xs text-rose-200/90">
      {message}
    </div>
  );
}
