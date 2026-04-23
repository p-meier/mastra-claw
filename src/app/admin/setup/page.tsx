import { redirect } from 'next/navigation';

import { AdminRequiredError, requireAdmin } from '@/lib/auth';
import { serializeFields } from '@/lib/descriptors/serialize';
import { loadOrganization } from '@/lib/organization';
import { getProvidersByCategory } from '@/lib/providers/registry';
import { resolveSettings } from '@/lib/settings/resolve';
import { createClient } from '@/lib/supabase/server';

import { AdminSetupWizard } from './_components/admin-setup-wizard';

export const metadata = {
  title: 'Admin setup — MastraClaw',
};

/**
 * Admin Setup wizard shell — Server Component.
 *
 * Mounts the six-stage wizard (branding, text, embedding, image-video,
 * voice, finalize). If the admin hits this page after
 * `app.setup_completed_at` has already been flipped, we redirect
 * directly to `/admin/settings` — the proxy normally bounces them, but
 * the defensive redirect covers the window between a session refresh
 * and the proxy check.
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
  if (settings.app.setupCompletedAt !== null) {
    redirect('/admin/settings');
  }

  const supabase = await createClient();
  const organization = await loadOrganization(supabase);

  const textProviders = getProvidersByCategory('text').map(serializeProvider);
  const embeddingProviders = getProvidersByCategory('embedding').map(serializeProvider);
  const imageVideoProviders = getProvidersByCategory('image-video').map(serializeProvider);
  const voiceProviders = getProvidersByCategory('voice').map(serializeProvider);

  return (
    <AdminSetupWizard
      textProviders={textProviders}
      embeddingProviders={embeddingProviders}
      imageVideoProviders={imageVideoProviders}
      voiceProviders={voiceProviders}
      initialActive={{
        text: settings.providers.text.active?.id ?? null,
        embedding: settings.providers.embedding.active?.id ?? null,
        imageVideo: settings.providers.imageVideo.active?.id ?? null,
        voice: settings.providers.voice.active?.id ?? null,
      }}
      initialBranding={{
        name: organization.name,
        organizationPrompt: organization.organizationPrompt,
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
