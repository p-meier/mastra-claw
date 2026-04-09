import { redirect } from 'next/navigation';

import { StepShell } from '@/components/wizard/step-shell';
import { AdminRequiredError, requireAdmin } from '@/lib/auth';
import { serializeFields } from '@/lib/descriptors/serialize';
import { getProvidersByCategory } from '@/lib/providers/registry';
import { resolveSettings } from '@/lib/settings/resolve';

import { AdminSetupWizard } from './_components/admin-setup-wizard';
import { Handoff } from './_components/handoff';

export const metadata = {
  title: 'Admin setup — MastraClaw',
};

/**
 * Admin Setup wizard shell — Server Component.
 *
 * Two branches, gated by `app.setup_completed_at`:
 *
 *   - not yet completed → mount the slimmed wizard, which walks the
 *     admin through three provider categories and then calls
 *     `finalizeAdminSetupAction()`.
 *
 *   - already completed → render the handoff screen (Continue with
 *     personal setup vs. Skip).
 *
 * The provider descriptors live in `src/lib/providers/`. They contain
 * server-only `probe` functions that cannot cross into the client
 * component, so we serialize each one's fields here and pass the
 * trimmed view down.
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

  const settings = await resolveSettings();
  const setupCompleted = settings.app.setupCompletedAt !== null;

  if (setupCompleted) {
    return (
      <StepShell
        mascotLabel="MastraClaw"
        step={4}
        totalSteps={4}
        question="You're all set"
        footer={null}
      >
        <Handoff />
      </StepShell>
    );
  }

  const textProviders = getProvidersByCategory('text').map(serializeProvider);
  const imageVideoProviders = getProvidersByCategory('image-video').map(serializeProvider);
  const voiceProviders = getProvidersByCategory('voice').map(serializeProvider);

  return (
    <AdminSetupWizard
      textProviders={textProviders}
      imageVideoProviders={imageVideoProviders}
      voiceProviders={voiceProviders}
      initialActive={{
        text: settings.providers.text.active?.id ?? null,
        imageVideo: settings.providers.imageVideo.active?.id ?? null,
        voice: settings.providers.voice.active?.id ?? null,
      }}
    />
  );
}

function serializeProvider(p: ReturnType<typeof getProvidersByCategory>[number]) {
  return {
    id: p.id,
    displayName: p.displayName,
    blurb: p.blurb,
    badge: p.badge,
    fields: serializeFields(p.fields),
  };
}
