import { redirect } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { getCurrentUser } from '@/lib/auth';
import { listChannels } from '@/lib/channels/registry';
import { listMyBindingsAction } from '@/lib/channels/user-bindings-actions';
import { mastraFor } from '@/mastra/lib/mastra-for';
import { resolveSettings } from '@/lib/settings/resolve';

import { BindingsManager } from './_components/bindings-manager';

/**
 * Connected accounts (per-user channel bindings) page.
 *
 * Each binding ties one external platform identity (e.g. a Telegram
 * numeric user ID) to a Mastra agent for the signed-in user. The
 * runtime channel handler resolves an incoming message via this table.
 *
 * Visible options:
 *   - **Channel dropdown**: only channels the admin has configured
 *     under `/admin/channels`. Non-configured channels do not appear,
 *     so a user can never bind themselves to a platform that has no
 *     credentials.
 *   - **Agent dropdown**: every agent the user has access to (today
 *     just `personal-assistant`).
 */

export const metadata = {
  title: 'Connected accounts — MastraClaw',
};

export default async function AccountChannelsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect('/login');

  const settings = await resolveSettings();
  const bindingsResult = await listMyBindingsAction();
  if (!bindingsResult.ok) {
    throw new Error(`Failed to load bindings: ${bindingsResult.error}`);
  }

  const channelOptions = listChannels()
    .filter((c) => settings.channels[c.id]?.configured)
    .map((c) => ({
      id: c.id,
      displayName: c.displayName,
      externalIdLabel: c.externalIdLabel,
    }));

  const agents = await mastraFor(currentUser).agents.list();
  const agentOptions = agents.map((a) => ({
    id: a.id,
    displayName: a.name ?? a.id,
  }));

  return (
    <SidebarInset>
      <header className="bg-background sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6">
        <SidebarTrigger className="-ml-2" />
        <div className="ml-2 flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-semibold leading-none">
              Connected accounts
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
            <CardTitle>Channel bindings</CardTitle>
            <CardDescription>
              Tie an external messaging account to one of your agents. The
              channel itself must be configured by an admin first; the
              binding maps your platform identity to the right MastraClaw
              account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BindingsManager
              initialBindings={bindingsResult.bindings}
              channelOptions={channelOptions}
              agentOptions={agentOptions}
            />
          </CardContent>
        </Card>
      </div>
    </SidebarInset>
  );
}
