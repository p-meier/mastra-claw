import { ProviderCategorySection } from '@/components/providers/provider-category-section';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { requireAdmin } from '@/lib/auth';
import { serializeFields } from '@/lib/descriptors/serialize';
import { getProviderSecretFieldStatus } from '@/lib/providers/actions';
import {
  PROVIDER_CATEGORIES,
  type ProviderCategory,
  categoryTitle,
  getProvidersByCategory,
} from '@/lib/providers/registry';
import { resolveSettings } from '@/lib/settings/resolve';

/**
 * Admin Settings page — the canonical edit surface for application
 * provider configuration. Replaces the read-only badge view with a
 * full descriptor-section per provider category.
 *
 * Layout: full-width `SidebarInset` shell, identical to the user
 * `account/settings` page. The four category sections stack vertically
 * — Text, Image & Video, Text-to-Speech, Speech-to-Text. Each section
 * lists the configured providers (with active badge + edit/delete
 * affordances) and an "Add provider" picker for the unconfigured ones.
 *
 * The runtime `Descriptor` objects contain server-only `probe`
 * functions and cannot cross into client components, so the page
 * shrinks each one into a serializable shape via `serializeFields()`
 * before passing it to `<ProviderCategorySection>`.
 */

export const metadata = {
  title: 'Admin Settings — MastraClaw',
};

export default async function AdminSettingsPage() {
  const currentUser = await requireAdmin();
  const settings = await resolveSettings();

  const sections = await Promise.all(
    PROVIDER_CATEGORIES.map((category) => buildCategoryProps(category, settings)),
  );

  return (
    <SidebarInset>
      <header className="bg-background sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
        <SidebarTrigger className="-ml-2" />
        <div className="ml-2 flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-semibold leading-none">
              Admin Settings
            </h1>
            <span className="text-muted-foreground truncate text-xs">
              {currentUser.email}
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Application providers</CardTitle>
            <CardDescription>
              Each category supports multiple providers; one is active at a
              time. Editing a provider runs a connection probe and only
              persists if it succeeds. Switching the active provider does not
              require re-entering credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-8">
            {sections.map((section) => (
              <ProviderCategorySection key={section.category} {...section} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Composio</CardTitle>
            <CardDescription>
              {settings.composio.configured
                ? 'Configured. Re-run the setup wizard to rotate the API key.'
                : 'Not configured. Run the setup wizard to add a Composio API key for tool federation.'}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </SidebarInset>
  );
}

async function buildCategoryProps(
  category: ProviderCategory,
  settings: Awaited<ReturnType<typeof resolveSettings>>,
) {
  const all = getProvidersByCategory(category);
  const slot = settings.providers[categoryKey(category)];

  // Each configured provider gets the full instance shape: serializable
  // fields, current config, and the per-field "is the secret already
  // stored in Vault" map for the edit form's stored-placeholder UI.
  const configured = await Promise.all(
    slot.configured.map(async (id) => {
      const descriptor = all.find((p) => p.id === id);
      if (!descriptor) return null;
      return {
        id,
        displayName: descriptor.displayName,
        blurb: descriptor.blurb,
        isActive: slot.active?.id === id,
        config: slot.active?.id === id ? (slot.active?.config ?? {}) : {},
        secretFieldStatus: await getProviderSecretFieldStatus(category, id),
        fields: serializeFields(descriptor.fields),
      };
    }),
  );

  const addable = all
    .filter((p) => !slot.configured.includes(p.id))
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      blurb: p.blurb,
      fields: serializeFields(p.fields),
    }));

  return {
    category,
    title: categoryTitle(category),
    description: descriptionFor(category),
    configured: configured.filter((c): c is NonNullable<typeof c> => c !== null),
    addable,
  };
}

function categoryKey(c: ProviderCategory) {
  switch (c) {
    case 'text':
      return 'text' as const;
    case 'image-video':
      return 'imageVideo' as const;
    case 'voice':
      return 'voice' as const;
  }
}

function descriptionFor(category: ProviderCategory): string {
  switch (category) {
    case 'text':
      return 'LLM provider used for chat, agent reasoning, and any other text generation.';
    case 'image-video':
      return 'Image and video generation. The Vercel AI Gateway covers both with a single key.';
    case 'voice':
      return 'Combined voice provider — Text-to-Speech for replies and Speech-to-Text for incoming voice messages, in one configuration.';
  }
}
