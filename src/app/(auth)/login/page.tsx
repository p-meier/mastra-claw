import Image from 'next/image';
import { redirect } from 'next/navigation';
import { AlertCircleIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getCurrentUser } from '@/lib/auth';
import { mapAuthError } from '@/lib/auth-errors';

import { signInAction } from './actions';

/**
 * Login page — restyled to use the App's theme tokens so it sits
 * coherently next to the new admin pages and the wizard restyle. The
 * previous version baked a custom dark color palette directly into
 * the markup; the new version inherits the App's light theme by
 * default and the same shadcn primitives (`Card`, `Input`, `Label`,
 * `Button`) used everywhere else.
 *
 * Visual identity is preserved: the warm amber bloom in the upper-left
 * is still there, just dialed for the light surface; the logo, the
 * eyebrow, and the hex motif are intact.
 */

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
  const user = await getCurrentUser();
  const params = await searchParams;
  if (user) redirect(params.next ?? '/');

  return (
    <div className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-background px-6 py-12 text-foreground">
      {/* Warm amber bloom from the upper-left — keeps the brand accent
          subtle on the light theme. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[700px] rounded-full opacity-[0.10] blur-3xl"
        style={{
          background: 'radial-gradient(closest-side, #f59e0b 0%, transparent 70%)',
        }}
      />

      {/* Hex lattice — keeps the geometric language of the logo */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full opacity-[0.04]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="hex"
            width="56"
            height="48.5"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M28 0 L56 16.17 L56 48.5 L28 64.67 L0 48.5 L0 16.17 Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.6"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#hex)" />
      </svg>

      <main className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-8">
        <Card className="w-full px-8 py-10">
          <div className="flex flex-col items-center gap-5">
            <Image
              src="/logo.png"
              alt="MastraClaw"
              width={72}
              height={72}
              priority
              className="size-[72px] rounded-xl object-contain"
              style={{
                filter:
                  'drop-shadow(0 0 22px rgba(245, 158, 11, 0.18))',
              }}
            />
            <div className="flex flex-col items-center gap-1.5">
              <h1 className="text-[26px] font-medium leading-none tracking-tight">
                MastraClaw
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Enterprise AI Agent
              </p>
            </div>
          </div>

          <div className="mx-auto my-8 h-px w-16 bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />

          <form action={signInAction} className="flex flex-col gap-5" noValidate>
            <input type="hidden" name="next" value={params.next ?? '/'} />

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>

            {params.error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-xs leading-relaxed text-destructive"
              >
                <AlertCircleIcon className="mt-0.5 size-3.5 shrink-0" />
                <span>{mapAuthError(params.error)}</span>
              </div>
            )}

            <Button type="submit" className="mt-1 h-11">
              Sign in
            </Button>
          </form>
        </Card>

        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          MastraClaw · v0.1.0
        </p>
      </main>
    </div>
  );
}
