import { headers } from 'next/headers';

import { ChannelSection } from '@/components/channels/channel-section';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { requireAdmin } from '@/lib/auth';
import { getChannelSecretFieldStatus } from '@/lib/channels/actions';
import { listChannels } from '@/lib/channels/registry';
import { serializeFields } from '@/lib/descriptors/serialize';
import { resolveSettings } from '@/lib/settings/resolve';

/**
 * Admin Channels page — the surface where the admin configures every
 * messaging platform the assistants can talk on. The Channels admin is
 * deliberately separate from `/admin/settings` (model providers) and
 * from the user-side `/account/channels` (per-user identity bindings).
 *
 * Layout matches the user `account/settings` page: full-width
 * `SidebarInset`, sticky header, body cards.
 *
 * Each channel descriptor is rendered as either:
 *   - a configured card (with edit/delete/voice-toggle/webhook URL)
 *     when the admin has saved a configuration, OR
 *   - an "Add" entry under the section dropdown when it's still empty.
 *
 * The webhook URL displayed on each card is the Mastra-auto-generated
 * route `${origin}/api/agents/personal-assistant/channels/{id}/webhook`,
 * which the admin pastes into the platform's app configuration. We use
 * the personal-assistant agent id today because it's the only agent
 * that ships with channel adapters.
 */

export const metadata = {
  title: 'Channels — MastraClaw',
};

export default async function AdminChannelsPage() {
  const currentUser = await requireAdmin();
  const settings = await resolveSettings();
  const origin = await deriveOrigin();

  const ttsAvailable = settings.providers.voice.active !== null;
  const all = listChannels();

  const configured = await Promise.all(
    all
      .filter((c) => settings.channels[c.id]?.configured)
      .map(async (c) => {
        const state = settings.channels[c.id];
        return {
          id: c.id,
          displayName: c.displayName,
          blurb: c.blurb,
          fields: serializeFields(c.fields),
          config: state.config,
          secretFieldStatus: await getChannelSecretFieldStatus(c.id),
          capabilities: c.capabilities,
          voiceEnabled: state.config.voiceEnabled === true,
          webhookUrl: c.capabilities.requiresPublicWebhook
            ? `${origin}/api/agents/personal-assistant/channels/${c.id}/webhook`
            : null,
        };
      }),
  );

  const addable = all
    .filter((c) => !settings.channels[c.id]?.configured)
    .map((c) => ({
      id: c.id,
      displayName: c.displayName,
      blurb: c.blurb,
      fields: serializeFields(c.fields),
    }));

  return (
    <SidebarInset>
      <header className="bg-background sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
        <SidebarTrigger className="-ml-2" />
        <div className="ml-2 flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-semibold leading-none">
              Channels
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
            <CardTitle>Messaging platforms</CardTitle>
            <CardDescription>
              Configure the apps and bot accounts on each messaging platform.
              These credentials are global to the deployment. Per-user routing
              (which user maps to which platform identity, and which agent
              answers them) is configured under{' '}
              <code className="text-xs">/account/channels</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChannelSection
              configured={configured}
              addable={addable}
              ttsAvailable={ttsAvailable}
            />
          </CardContent>
        </Card>
      </div>
    </SidebarInset>
  );
}

async function deriveOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  return `${proto}://${host}`;
}
