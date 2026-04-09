import { redirect } from 'next/navigation';

import { AdminRequiredError, requireAdmin } from '@/lib/auth';
import { serializeFields } from '@/lib/descriptors/serialize';
import { getProvidersByCategory } from '@/lib/providers/registry';
import { resolveSettings } from '@/lib/settings/resolve';

import { AdminSetupWizard } from './_components/admin-setup-wizard';

export const metadata = {
  title: 'Admin setup — MastraClaw',
};

/**
 * Admin Setup wizard shell — Server Component.
 *
 * Always mounts the slimmed wizard. The wizard walks the admin through
 * three provider categories and then lands on the `finalize` step,
 * which both flips `app.setup_completed_at` and asks whether the admin
 * also wants to be a regular user (single-user mode → personal
 * onboarding) or just an administrator (skip → /admin/settings).
 *
 * If the admin reloads `/admin/setup` after the timestamp has already
 * been flipped (but before they've resolved the personal-onboarding
 * choice), we boot the wizard directly at the `finalize` stage so they
 * see the choice screen immediately instead of replaying the provider
 * picker.
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
      initialStage={setupCompleted ? 'finalize' : 'text'}
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
