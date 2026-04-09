import Image from 'next/image';
import { redirect } from 'next/navigation';
import { AlertCircleIcon } from 'lucide-react';

import { getCurrentUser } from '@/lib/auth';
import { mapAuthError } from '@/lib/auth-errors';

import { signInAction } from './actions';

export const metadata = {
  title: 'Sign in — MastraClaw',
};

type SearchParams = Promise<{
  error?: string;
  next?: string;
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  // Already signed in? Jump straight to the destination.
  const user = await getCurrentUser();
  const params = await searchParams;
  if (user) redirect(params.next ?? '/');

  return (
    // The login screen is its own visual world: deep dark canvas, a single
    // atmospheric warm-amber bloom, a faint hexagonal lattice as a nod to
    // the logo's geometry, and a glassmorphic card carrying the form.
    // Single accent color — playfulness lives in the mascot, not here.
    <div className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-[#08080b] px-6 py-12 text-white">
      {/* Single warm-amber bloom from the upper-left */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[700px] rounded-full opacity-[0.18] blur-3xl"
        style={{
          background:
            'radial-gradient(closest-side, #f59e0b 0%, transparent 70%)',
        }}
      />
      {/* A second, fainter ember from the lower-right for depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -bottom-40 size-[700px] rounded-full opacity-[0.10] blur-3xl"
        style={{
          background:
            'radial-gradient(closest-side, #b45309 0%, transparent 70%)',
        }}
      />

      {/* Hexagonal lattice — the logo's geometric language, dialed way down */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full opacity-[0.05]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="hex"
            width="56"
            height="48.5"
            patternUnits="userSpaceOnUse"
            patternTransform="translate(0 0)"
          >
            <path
              d="M28 0 L56 16.17 L56 48.5 L28 64.67 L0 48.5 L0 16.17 Z"
              fill="none"
              stroke="white"
              strokeWidth="0.6"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hex)" />
      </svg>

      {/* Subtle film grain so the dark surface doesn't read as flat */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full opacity-[0.045] mix-blend-overlay"
        xmlns="http://www.w3.org/2000/svg"
      >
        <filter id="grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>

      {/* Vignette toward the bottom — keeps focus on the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/40"
      />

      <main className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-8">
        {/* Card */}
        <div className="relative w-full">
          {/* Gradient hairline along the top edge — signature accent */}
          <div
            aria-hidden
            className="absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent"
          />

          <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] px-8 py-10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
            {/* Header — logo + wordmark + eyebrow */}
            <div className="flex flex-col items-center gap-5">
              <div
                className="animate-in fade-in slide-in-from-bottom-2 duration-700"
                style={{
                  filter:
                    'drop-shadow(0 0 28px rgba(251, 191, 36, 0.40)) drop-shadow(0 0 14px rgba(245, 158, 11, 0.22))',
                }}
              >
                <Image
                  src="/logo.png"
                  alt="MastraClaw"
                  width={72}
                  height={72}
                  priority
                  className="size-[72px] rounded-xl object-contain"
                />
              </div>

              <div
                className="animate-in fade-in slide-in-from-bottom-2 flex flex-col items-center gap-1.5 duration-700"
                style={{ animationDelay: '100ms', animationFillMode: 'both' }}
              >
                <h1 className="text-[26px] font-medium leading-none tracking-tight text-white">
                  MastraClaw
                </h1>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
                  Enterprise AI Agent
                </p>
              </div>
            </div>

            {/* Divider */}
            <div
              className="animate-in fade-in mx-auto my-8 h-px w-16 bg-gradient-to-r from-transparent via-white/20 to-transparent duration-700"
              style={{ animationDelay: '200ms', animationFillMode: 'both' }}
            />

            {/* Form */}
            <form
              action={signInAction}
              className="flex flex-col gap-5"
              noValidate
            >
              <input
                type="hidden"
                name="next"
                value={params.next ?? '/'}
              />

              <div
                className="animate-in fade-in slide-in-from-bottom-1 flex flex-col gap-2 duration-700"
                style={{
                  animationDelay: '280ms',
                  animationFillMode: 'both',
                }}
              >
                <label
                  htmlFor="email"
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45"
                >
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  className="h-11 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 text-sm text-white/90 placeholder:text-white/25 outline-none transition-all focus:border-amber-400/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-amber-400/15"
                />
              </div>

              <div
                className="animate-in fade-in slide-in-from-bottom-1 flex flex-col gap-2 duration-700"
                style={{
                  animationDelay: '340ms',
                  animationFillMode: 'both',
                }}
              >
                <label
                  htmlFor="password"
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/45"
                >
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="h-11 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3.5 text-sm text-white/90 outline-none transition-all focus:border-amber-400/50 focus:bg-white/[0.06] focus:ring-4 focus:ring-amber-400/15"
                />
              </div>

              {params.error && (
                <div
                  role="alert"
                  className="animate-in fade-in flex items-start gap-2.5 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3.5 py-2.5 text-xs leading-relaxed text-rose-200/90 duration-300"
                >
                  <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0 text-rose-300" />
                  <span>{mapAuthError(params.error)}</span>
                </div>
              )}

              <button
                type="submit"
                className="group animate-in fade-in slide-in-from-bottom-1 relative mt-1 inline-flex h-11 items-center justify-center overflow-hidden rounded-lg bg-amber-500 text-sm font-semibold text-black shadow-[0_8px_32px_-8px_rgba(245,158,11,0.55)] transition-all duration-200 hover:bg-amber-400 hover:shadow-[0_12px_40px_-8px_rgba(245,158,11,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#08080b] active:scale-[0.99]"
                style={{
                  animationDelay: '420ms',
                  animationFillMode: 'both',
                }}
              >
                <span className="relative z-10">Sign in</span>
                <span
                  aria-hidden
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                />
              </button>
            </form>
          </div>
        </div>

        {/* Footer line */}
        <p
          className="animate-in fade-in font-mono text-[10px] uppercase tracking-[0.2em] text-white/25 duration-700"
          style={{ animationDelay: '520ms', animationFillMode: 'both' }}
        >
          MastraClaw · v0.1.0
        </p>
      </main>
    </div>
  );
}
