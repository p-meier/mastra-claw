import { redirect } from 'next/navigation';

import { requireAdmin, AdminRequiredError } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { StepShell } from '@/components/wizard/step-shell';

import { AdminSetupWizard } from './_components/admin-setup-wizard';
import { Handoff } from './_components/handoff';

export const metadata = {
  title: 'Admin setup — MastraClaw',
};

/**
 * Admin Setup wizard shell.
 *
 * Server Component that gates by admin role and decides between two
 * branches:
 *
 *   - app.setup_completed_at IS NULL → mount the wizard client component
 *     which holds all in-progress state and commits atomically at the end
 *   - already completed → render the handoff screen (Continue with personal
 *     setup vs. Skip — I'm just the administrator)
 *
 * The proxy gate already redirects fully-onboarded users away from this
 * route, so reaching it post-handoff implies the admin came back via a
 * direct URL — in that case the redirect to / catches them.
 */
export default async function AdminSetupPage() {
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof AdminRequiredError) {
      redirect('/not-configured');
    }
    throw err;
  }

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'app.setup_completed_at')
    .maybeSingle();

  const setupCompleted =
    settings?.value !== null && settings?.value !== undefined;

  if (setupCompleted) {
    return (
      <StepShell
        mascotLabel="MastraClaw"
        step={8}
        totalSteps={8}
        question="You're all set"
        footer={null}
      >
        <Handoff />
      </StepShell>
    );
  }

  return <AdminSetupWizard />;
}
