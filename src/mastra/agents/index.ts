import 'server-only';

import type { Agent } from '@mastra/core/agent';

import { buildCustomAgents } from './custom';
import { buildPlatformAgents } from './platform';

/**
 * Union of platform-owned and fork-owned agents. `src/mastra/singleton.ts`
 * reads from here and passes the merged map into `new Mastra({ agents })`.
 *
 * Merge order: platform first, fork last. A fork that intentionally
 * wants to shadow a platform agent can register one with the same
 * exported key; the fork's entry wins.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgent = Agent<string, any, any, any>;

export async function buildAllAgents(): Promise<Record<string, AnyAgent>> {
  const [platform, custom] = await Promise.all([
    buildPlatformAgents(),
    buildCustomAgents(),
  ]);
  return { ...platform, ...custom };
}
