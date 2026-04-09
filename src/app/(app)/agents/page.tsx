import { BotIcon } from 'lucide-react';
import Link from 'next/link';

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SidebarInset, SidebarTrigger } from '@/components/ui/sidebar';
import { requireAdmin } from '@/lib/auth';
import { mastraFor } from '@/mastra/lib/mastra-for';

/**
 * Agents list — every agent the current user can see, rendered as a
 * grid of cards. Phase 1 surfaces the single code-defined
 * `personal-assistant`; future stored agents are merged in by the
 * `agents-service` without changes here.
 */
export default async function AgentsPage() {
  const user = await requireAdmin();
  const agents = await mastraFor(user).agents.list();

  return (
    <SidebarInset>
      <header className="bg-background sticky top-0 z-10 flex h-16 shrink-0 items-center gap-3 border-b px-6">
        <SidebarTrigger className="-ml-2" />
        <div className="ml-2 flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-sm font-semibold leading-none">Agents</h1>
          <span className="text-muted-foreground truncate text-xs">
            Your AI agents — chat, manage workspaces, inspect prior conversations.
          </span>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-6 p-6">
        {agents.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No agents available yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => {
              const description = agent.getDescription();
              return (
                <Link
                  key={agent.id}
                  href={`/agents/${encodeURIComponent(agent.id)}`}
                  className="group focus:outline-none"
                >
                  <Card className="group-hover:border-primary/40 group-focus-visible:ring-ring h-full transition group-focus-visible:ring-2">
                    <CardHeader>
                      <div className="bg-muted text-muted-foreground mb-3 inline-flex size-10 items-center justify-center rounded-lg">
                        <BotIcon className="size-5" />
                      </div>
                      <CardTitle className="text-base">{agent.name}</CardTitle>
                      {description ? (
                        <CardDescription className="line-clamp-3">
                          {description}
                        </CardDescription>
                      ) : null}
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </SidebarInset>
  );
}
