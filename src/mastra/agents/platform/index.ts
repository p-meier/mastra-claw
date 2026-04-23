import 'server-only';

import type { Agent } from '@mastra/core/agent';

/**
 * Platform-owned agents — upstream-managed. Never hand-edited in a
 * fork; `npm run sync-upstream` merges changes from the upstream
 * mastra-claw repo cleanly because this folder is entirely upstream's
 * territory.
 *
 * Add a platform agent by creating `src/mastra/agents/platform/<name>.ts`
 * and adding `<name>: await create<Name>()` below.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgent = Agent<string, any, any, any>;

export async function buildPlatformAgents(): Promise<Record<string, AnyAgent>> {
  return {};
}
