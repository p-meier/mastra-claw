'use client';

import { useTransition } from 'react';
import { CheckCircle2, ArrowRight, FastForward } from 'lucide-react';

import { handoffContinue, handoffSkip } from '../actions';

export function Handoff() {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex w-full flex-col items-center gap-8">
      <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-emerald-200">
        <CheckCircle2 className="size-3.5" />
        Admin setup complete
      </div>
      <p className="max-w-md text-center text-white/65">
        This MastraClaw instance is now configured. Every user who logs in
        from here on can do their own personal onboarding.
      </p>

      <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => handoffContinue())}
          className="group relative flex flex-col items-start gap-2 rounded-2xl border border-amber-400/40 bg-amber-500/[0.10] p-6 text-left transition-all hover:border-amber-300/60 hover:bg-amber-500/[0.14] hover:shadow-[0_20px_60px_-20px_rgba(245,158,11,0.55)] disabled:opacity-50"
        >
          <ArrowRight className="size-5 text-amber-200" />
          <h3 className="text-lg font-medium text-white">
            Continue with my personal setup
          </h3>
          <p className="text-sm text-white/60">
            Set up your name, your assistant, and meet your AI partner for
            the first time. Takes about 3 minutes.
          </p>
        </button>

        <button
          type="button"
          disabled={isPending}
          onClick={() => startTransition(() => handoffSkip())}
          className="group relative flex flex-col items-start gap-2 rounded-2xl border border-white/[0.10] bg-white/[0.025] p-6 text-left transition-all hover:border-white/[0.25] hover:bg-white/[0.04] disabled:opacity-50"
        >
          <FastForward className="size-5 text-white/60" />
          <h3 className="text-lg font-medium text-white">
            Skip — I&apos;m just the administrator
          </h3>
          <p className="text-sm text-white/60">
            Go to the admin dashboard. Personal onboarding is for the
            actual end users — you can set yours up later from settings if
            you want.
          </p>
        </button>
      </div>
    </div>
  );
}
