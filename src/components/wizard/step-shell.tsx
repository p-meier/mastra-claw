import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Mascot, type MascotAccessory } from './mascot';

/**
 * Wizard step chrome — mascot at top, "Step N of M" + dots, the question
 * heading, the body slot, and the Back / Continue footer. Used by both
 * the Admin Setup wizard and the Personal Onboarding wizard so they
 * share an identical visual language.
 */
export function StepShell({
  mascotLabel,
  step,
  totalSteps,
  question,
  children,
  footer,
  thinking,
  accessory,
}: {
  mascotLabel?: string | null;
  step: number;
  totalSteps: number;
  question: string;
  children: ReactNode;
  footer: ReactNode;
  thinking?: boolean;
  accessory?: MascotAccessory;
}) {
  return (
    <div className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-[#08080b] px-6 py-12 text-white">
      {/* Single warm amber bloom from the upper-left — the only accent
          on the page; everything else is neutral. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[700px] rounded-full opacity-[0.16] blur-3xl"
        style={{
          background:
            'radial-gradient(closest-side, #f59e0b 0%, transparent 70%)',
        }}
      />

      <main className="relative z-10 flex w-full max-w-[640px] flex-col items-center gap-8">
        <Mascot
          variant={thinking ? 'thinking' : 'idle'}
          label={mascotLabel}
          accessory={accessory}
        />

        {/* Step indicator */}
        <div className="flex flex-col items-center gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">
            Step {step} of {totalSteps}
          </p>
          <div className="flex gap-1.5" role="progressbar" aria-valuenow={step} aria-valuemax={totalSteps}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  i + 1 < step ? 'w-3 bg-white/60' : null,
                  i + 1 === step ? 'w-7 bg-white' : null,
                  i + 1 > step ? 'w-1.5 bg-white/15' : null,
                )}
              />
            ))}
          </div>
        </div>

        <h1 className="text-center text-2xl font-medium tracking-tight text-white md:text-3xl">
          {question}
        </h1>

        <div className="w-full">{children}</div>

        <div className="flex w-full items-center justify-between pt-2">{footer}</div>
      </main>
    </div>
  );
}

/**
 * Collapsible "What's this?" info panel. Each step uses this to explain
 * the concept in plain language for non-technical users (CEO test).
 */
export function InfoBox({
  title = "What's this?",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <details className="group mx-auto mt-2 max-w-prose rounded-lg border border-white/[0.08] bg-white/[0.025] px-4 py-3 text-sm text-white/70 transition-colors open:border-white/[0.16] open:bg-white/[0.04]">
      <summary className="cursor-pointer select-none font-mono text-[11px] uppercase tracking-[0.18em] text-white/50 group-open:text-white/70">
        {title}
      </summary>
      <div className="mt-3 space-y-2 leading-relaxed text-white/75">
        {children}
      </div>
    </details>
  );
}
