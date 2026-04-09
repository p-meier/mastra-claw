import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { Mascot, type MascotAccessory } from './mascot';

/**
 * Wizard step chrome — mascot at top, "Step N of M" + dots, the question
 * heading, the body slot, and the Back / Continue footer.
 *
 * Restyled to use the App's theme tokens (`bg-background`, `border`,
 * `text-foreground`, `text-muted-foreground`) instead of the previous
 * hardcoded dark color palette. The personal onboarding wizard wraps
 * its bootstrap stage in a `dark` class to scope dark mode to the
 * chat surface only; everything that uses this shell now respects the
 * theme it's rendered under, which means the admin setup wizard
 * inherits the App's light mode automatically.
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
    <div className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-background px-6 py-12 text-foreground">
      {/* Single warm amber bloom from the upper-left — the only accent
          on the page; everything else is neutral. Tuned down for the
          light theme so the bloom reads as a subtle highlight. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[700px] rounded-full opacity-[0.10] blur-3xl"
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
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Step {step} of {totalSteps}
          </p>
          <div
            className="flex gap-1.5"
            role="progressbar"
            aria-valuenow={step}
            aria-valuemax={totalSteps}
          >
            {Array.from({ length: totalSteps }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  i + 1 < step ? 'w-3 bg-foreground/60' : null,
                  i + 1 === step ? 'w-7 bg-foreground' : null,
                  i + 1 > step ? 'w-1.5 bg-foreground/15' : null,
                )}
              />
            ))}
          </div>
        </div>

        <h1 className="text-center text-2xl font-medium tracking-tight md:text-3xl">
          {question}
        </h1>

        <div className="w-full">{children}</div>

        <div className="flex w-full items-center justify-between pt-2">
          {footer}
        </div>
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
    <details className="group mx-auto mt-2 max-w-prose rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground transition-colors open:bg-muted/60">
      <summary className="cursor-pointer select-none font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground group-open:text-foreground">
        {title}
      </summary>
      <div className="mt-3 space-y-2 leading-relaxed text-foreground/80">
        {children}
      </div>
    </details>
  );
}
