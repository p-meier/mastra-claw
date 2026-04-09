import { BotIcon } from 'lucide-react';
import Link from 'next/link';

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
    <main className="flex-1 px-8 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your AI agents. Click one to chat, manage its workspace, or
          inspect prior conversations.
        </p>
      </header>

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
    </main>
  );
}
