import 'server-only';

import type { Agent } from '@mastra/core/agent';

import { createPersonalAssistant } from './personal-assistant';

/**
 * Fork-owned agents — this fork's custom code. `npm run sync-upstream`
 * never touches this folder; any agent landed here is preserved
 * verbatim across upstream merges.
 *
 * Add a custom agent by creating `src/mastra/agents/custom/<name>.ts`
 * and adding `<name>: await create<Name>()` below.
 *
 * The `Record<string, Agent>` return type widens each agent's specific
 * `requestContextSchema` to `unknown` so the union builder stays
 * boundary-free. Mastra reads the schema at call time from the agent
 * instance itself, so the widening is purely about the builder's
 * collection type — no runtime impact.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAgent = Agent<string, any, any, any>;

export async function buildCustomAgents(): Promise<Record<string, AnyAgent>> {
  const personalAssistant = (await createPersonalAssistant()) as unknown as AnyAgent;
  return { personalAssistant };
}
