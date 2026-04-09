import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import { loadProfile } from '@/lib/onboarding/profile';
import { resolveSettings } from '@/lib/settings/resolve';

import { OnboardingWizard } from './_components/onboarding-wizard';

export const metadata = {
  title: 'Welcome — MastraClaw',
};

/**
 * Personal Onboarding wizard shell.
 *
 * Server Component. The proxy gate normally redirects users into the
 * correct flow before they reach this page, BUT `/onboarding` is on the
 * proxy's gate-bypass list (so the gate doesn't loop on the wizard
 * itself). That means a direct URL hit can bring an unprepared user
 * here. We therefore re-check the same three conditions inside the
 * page as a defense-in-depth layer:
 *
 *   1. Authenticated?              → no  ⇒ /login
 *   2. App setup completed?        → no  ⇒ admin: /admin/setup, user: /not-configured
 *   3. This user already onboarded? → yes ⇒ /
 *
 * Only if none of those bounce us do we mount the wizard.
 */
export default async function PersonalOnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const [profile, settings] = await Promise.all([
    loadProfile(user.userId),
    resolveSettings(),
  ]);

  // App-level setup not yet done. Without an LLM provider configured,
  // the bootstrap chat would just throw "LLM provider/model missing"
  // the moment the user starts talking — so block here instead.
  if (!settings.app.setupCompletedAt) {
    redirect(user.role === 'admin' ? '/admin/setup' : '/not-configured');
  }

  // Already done? The proxy gate would normally bounce us, but be
  // explicit too in case of direct URL access.
  if (profile?.onboardingCompletedAt) {
    redirect('/');
  }

  return (
    <OnboardingWizard
      telegramConfiguredOnInstance={settings.telegram.configured}
    />
  );
}
