import { Card } from '@/components/ui/card';
import { SignOutButton } from '@/components/sign-out-button';
import { Mascot } from '@/components/wizard/mascot';
import { getCurrentUser } from '@/lib/auth';

export const metadata = {
  title: 'Not configured — MastraClaw',
};

/**
 * "Not configured" landing page — shown when a non-admin user lands
 * on the app before the admin has run the setup wizard. Restyled to
 * use the App's theme tokens so it sits coherently with the wizard
 * and admin pages.
 */
export default async function NotConfiguredPage() {
  const user = await getCurrentUser();

  return (
    <div className="relative isolate flex min-h-svh items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[400px] rounded-full opacity-[0.10] blur-3xl sm:size-[700px]"
        style={{
          background:
            'radial-gradient(closest-side, #f59e0b 0%, transparent 70%)',
        }}
      />
      <main className="relative z-10 flex w-full max-w-md flex-col items-center gap-6 text-center">
        <Mascot variant="thinking" label={null} />
        <Card className="w-full px-6 py-8">
          <h1 className="text-2xl font-medium tracking-tight">
            Not yet configured
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This MastraClaw instance hasn&apos;t been set up yet. An
            administrator needs to complete the initial configuration
            (LLM and embedding providers, at minimum) before the app is
            ready to use.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Please reach out to your administrator. You can come back
            here once they let you know it&apos;s ready.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3 border-t pt-4">
            {user && (
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Signed in as {user.email}
              </p>
            )}
            <SignOutButton />
          </div>
        </Card>
      </main>
    </div>
  );
}
