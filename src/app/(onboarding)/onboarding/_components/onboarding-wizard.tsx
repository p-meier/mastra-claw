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
 * State machine after the channel-registry refactor:
 *
 *   1. tone           (form, no DB writes)
 *   2. bootstrap chat (LLM chat — terminal step; the chat's
 *                     complete_bootstrap tool fires the single atomic
 *                     commit)
 *
 * Channel bindings used to be captured here (the old "telegram" step).
 * They're now their own user-facing surface under /account/channels —
 * the user picks a channel, paste the platform identifier, picks an
 * agent. Personal onboarding is back to being purely about the user's
 * persona.
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

export type OnboardingWizardProps = Record<string, never>;

type Stage = 'tone' | 'bootstrap';

type Draft = {
  tone: Tone;
};

export function OnboardingWizard() {
  const [stage, setStage] = useState<Stage>('tone');
  const [draft, setDraft] = useState<Draft>({
    // Pre-select the most-common option so a hesitant user can just
    // click Continue. They can always pick a different one if they want.
    tone: 'casual',
  });
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<Draft>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  // Personal onboarding is now exactly two stages: pick a tone, then
  // run the bootstrap chat. Channel bindings live on /account/channels
  // and are not part of this flow.
  const totalSteps = 2;
  const stepNumber = stage === 'tone' ? 1 : totalSteps;

  const goNext = () => {
    setError(null);
    if (stage === 'tone') setStage('bootstrap');
  };

  const goBack = () => {
    setError(null);
    if (stage === 'bootstrap') setStage('tone');
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
            <InfoBox>
              <p>
                This sets the default communication style your assistant
                uses. You can fine-tune it later from settings.
              </p>
            </InfoBox>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => update({ tone: t.id })}
                  className={`rounded-xl border px-4 py-4 text-left text-sm transition-all ${
                    draft.tone === t.id
                      ? 'border-primary bg-primary/5 text-foreground ring-2 ring-primary/30'
                      : 'border-border bg-card text-foreground/75 hover:border-foreground/30 hover:bg-muted/40'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
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
  // committed the previous step before landing here), so we can safely
  // depend on its primitive fields.
  const wizardDraft = useMemo<WizardDraftWire>(
    () => ({ tone: draft.tone }),
    [draft.tone],
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
   * **Why we don't use `runtime.thread.exportExternalState()`:** that
   * helper is typed `any` and returns assistant-ui's internal repository
   * shape, not the AI SDK v6 `UIMessage[]` array our `/finalize` route
   * validates. The previous version of this code passed the repository
   * object straight through and the route rejected it with a 400 even
   * though the conversation itself was healthy.
   *
   * Instead we walk `runtime.thread.getState().messages` and convert
   * each ThreadMessage into a minimal AI SDK v6 UIMessage shape
   * (`{ id, role, parts: [{ type: 'text', text }] }`). The bootstrap
   * interview is text-only — no tool calls, no media — so a flat text
   * extraction is enough for `generateObject` on the server.
   */
  const handleFinishNow = async () => {
    if (isFinishing || completed) return;
    setIsFinishing(true);
    setCommitError(null);
    try {
      const messages = runtime.thread
        .getState()
        .messages.flatMap(threadMessageToUIMessage);
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
    // Light-mode shell, matching the rest of the app. Tokens (`bg-background`,
    // `text-foreground`, `border`) inherit the App theme so this surface
    // sits coherently next to the wizard step that precedes it.
    <div className="relative isolate flex h-svh min-h-0 flex-col overflow-x-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[400px] rounded-full opacity-[0.10] blur-3xl sm:size-[700px]"
        style={{
          background:
            'radial-gradient(closest-side, #f59e0b 0%, transparent 70%)',
        }}
      />

      {/* Compact header — small mascot, label, back + finish buttons.
          Uses flex-wrap so on narrow screens the buttons drop below the
          mascot/title block instead of pushing the layout wider than the
          viewport. */}
      <header className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur-xl sm:gap-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="size-10 shrink-0">
            <Mascot
              variant={isRunning ? 'thinking' : 'idle'}
              label={null}
              className="!gap-0 [&>div]:!size-10"
            />
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium text-foreground">
              Your Personal Assistant
            </span>
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
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
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 sm:h-10 sm:px-4 sm:text-sm"
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
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center text-sm text-emerald-700">
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
      <footer className="relative z-10 shrink-0 border-t bg-background/80 px-4 py-3 backdrop-blur-xl sm:px-6 sm:py-4">
        <div className="relative mx-auto w-full max-w-2xl">
          <ComposerPrimitive.Root className="flex w-full items-end gap-2 rounded-lg border bg-card p-2 focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/15">
            <ComposerPrimitive.Input
              rows={1}
              autoFocus
              placeholder={completed ? 'Done!' : 'Type a reply…'}
              disabled={completed}
              className="flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
            />
            <ThreadPrimitive.If running={false}>
              <ComposerPrimitive.Send asChild>
                <button
                  type="submit"
                  disabled={completed}
                  className="inline-flex size-9 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
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
                  className="inline-flex size-9 items-center justify-center rounded-md border bg-muted text-muted-foreground transition-colors hover:bg-muted/80"
                >
                  <span aria-hidden>■</span>
                  <span className="sr-only">Stop</span>
                </button>
              </ComposerPrimitive.Cancel>
            </ThreadPrimitive.If>
          </ComposerPrimitive.Root>
          {isThinking && !completed && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-start rounded-lg bg-background/70 pl-5 backdrop-blur-[2px]"
              aria-hidden
            >
              <ThinkingDots />
              <span className="ml-3 font-mono text-[11px] uppercase tracking-[0.18em] text-primary">
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
      <div className="max-w-[80%] break-words rounded-2xl bg-primary/10 px-4 py-2 text-sm text-foreground [overflow-wrap:anywhere]">
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
      <div className="max-w-[85%] break-words rounded-2xl border bg-card px-4 py-2 text-sm text-foreground [overflow-wrap:anywhere]">
        <MessagePrimitive.Parts>
          {({ part }) => (part.type === 'text' ? <MarkdownText /> : null)}
        </MessagePrimitive.Parts>
      </div>
    </MessagePrimitive.Root>
  );
}

/**
 * Convert one assistant-ui `ThreadMessage` to the AI SDK v6 `UIMessage`
 * shape the `/finalize` route's Zod schema expects. Strips everything
 * except text parts — the bootstrap interview is text-only, and we
 * skip the synthetic "(begin)" kickoff so the model isn't confused by
 * a stray empty user turn.
 */
function threadMessageToUIMessage(message: {
  id: string;
  role: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
}): Array<{
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: Array<{ type: 'text'; text: string }>;
}> {
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system') {
    return [];
  }
  const parts = message.content
    .filter((p) => p.type === 'text' && typeof p.text === 'string' && p.text.length > 0)
    .map((p) => ({ type: 'text' as const, text: String(p.text) }));
  if (parts.length === 0) return [];
  // Drop the hidden kickoff so /finalize doesn't see it as a real user
  // message — same logic the visible message component uses.
  if (
    message.role === 'user' &&
    parts.length === 1 &&
    parts[0].text.trim() === '(begin)'
  ) {
    return [];
  }
  return [
    {
      id: message.id,
      role: message.role,
      parts,
    },
  ];
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-xs text-destructive">
      {message}
    </div>
  );
}
