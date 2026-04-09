'use client';

import { CheckCircle2, ArrowRight, FastForward } from 'lucide-react';

/**
 * Body of the wizard's fifth step. Rendered inside `StepShell` by the
 * admin setup wizard once `app.setup_completed_at` has been flipped.
 *
 * The two buttons hand control back to the wizard via callbacks instead
 * of calling the server actions directly, so the wizard owns the
 * pending state and can keep all transitions on a single `useTransition`.
 */
export function HandoffStep({
  pending,
  onContinue,
  onSkip,
}: {
  pending: boolean;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-8">
      <div className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-700">
        <CheckCircle2 className="size-3.5" />
        Admin setup complete
      </div>
      <p className="max-w-md text-center text-muted-foreground">
        This MastraClaw instance is now configured. Every user who logs
        in from here on can do their own personal onboarding. What about
        you?
      </p>

      <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
        <button
          type="button"
          disabled={pending}
          onClick={onContinue}
          className="group relative flex flex-col items-start gap-2 rounded-2xl border-2 border-primary bg-primary/5 p-6 text-left transition-all hover:bg-primary/10 disabled:opacity-50"
        >
          <ArrowRight className="size-5 text-primary" />
          <h3 className="text-lg font-medium text-foreground">
            I&apos;m the admin <em>and</em> a user
          </h3>
          <p className="text-sm text-muted-foreground">
            Single-user mode. Continue with personal onboarding now —
            set up your name, your assistant, and meet your AI partner
            for the first time. Takes about 3 minutes.
          </p>
        </button>

        <button
          type="button"
          disabled={pending}
          onClick={onSkip}
          className="group relative flex flex-col items-start gap-2 rounded-2xl border bg-card p-6 text-left transition-all hover:border-foreground/30 hover:bg-muted/40 disabled:opacity-50"
        >
          <FastForward className="size-5 text-muted-foreground" />
          <h3 className="text-lg font-medium text-foreground">
            I&apos;m only the admin
          </h3>
          <p className="text-sm text-muted-foreground">
            Skip personal onboarding entirely and jump straight into the
            admin area. This account will be marked as an administrator
            account that isn&apos;t intended to be used as a personal
            assistant user.
          </p>
        </button>
      </div>
    </div>
  );
}
