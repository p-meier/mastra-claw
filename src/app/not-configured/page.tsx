import { Mascot } from '@/components/wizard/mascot';
import { SignOutButton } from '@/components/sign-out-button';
import { getCurrentUser } from '@/lib/auth';

export const metadata = {
  title: 'Not configured — MastraClaw',
};

export default async function NotConfiguredPage() {
  // Best-effort: surface which email is signed in so the user can tell
  // whether they're on the wrong account. Page is publicly reachable
  // (in PUBLIC_PATHS), so an unauthenticated visit just shows nothing
  // here instead of redirecting.
  const user = await getCurrentUser();

  return (
    <div className="dark relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-[#08080b] px-4 py-12 text-white sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[400px] rounded-full opacity-[0.18] blur-3xl sm:size-[700px]"
        style={{
          background: 'radial-gradient(closest-side, #f59e0b 0%, transparent 70%)',
        }}
      />
      <main className="relative z-10 flex max-w-md flex-col items-center gap-6 text-center">
        <Mascot variant="thinking" label={null} />
        <h1 className="text-2xl font-medium tracking-tight">
          Not yet configured
        </h1>
        <p className="text-white/65">
          This MastraClaw instance hasn&apos;t been set up yet. An
          administrator needs to complete the initial configuration
          (LLM provider, model, and channels) before personal accounts
          can start the onboarding flow.
        </p>
        <p className="text-white/55 text-sm">
          Please reach out to your administrator. You can come back here
          once they let you know it&apos;s ready.
        </p>
        {user && (
          <div className="mt-2 flex flex-col items-center gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
              Signed in as {user.email}
            </p>
            <SignOutButton />
          </div>
        )}
      </main>
    </div>
  );
}
