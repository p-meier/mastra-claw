import 'server-only';

import { Mastra } from '@mastra/core/mastra';
import { MastraEditor } from '@mastra/editor';
import { PinoLogger } from '@mastra/loggers';
import {
  Observability,
  DefaultExporter,
  SensitiveDataFilter,
} from '@mastra/observability';

import { buildAllAgents } from './agents';
import { storage } from './storage';
import { allTools } from './tools';
import { allWorkflows } from './workflows';

/**
 * Process-wide Mastra singleton.
 *
 * Why `process` and not `globalThis`: under Next.js App Router, RSC
 * modules and Route Handler modules run in separate module scopes, and
 * under Turbopack/webpack server HMR a value stashed on `globalThis`
 * from one scope is not reliably visible to the other. `process` is
 * the same object in every server module scope in the same Node
 * process, so it's the only slot that works for a cross-boundary,
 * HMR-safe singleton.
 *
 * Why cache the Promise, not just the resolved Mastra: two concurrent
 * first-callers (e.g. RSC page + parallel route handler on cold start)
 * must share one build. If we only cached the resolved value, both
 * would race, each would call `new Mastra()`, and each would register
 * duplicate agents. Caching the Promise makes the second caller await
 * the first's build.
 */

const SLOT = Symbol.for('mastra-claw.singleton');

type Slot = { promise?: Promise<Mastra> };
type ProcessWithSlot = NodeJS.Process & { [SLOT]?: Slot };

function slot(): Slot {
  const p = process as ProcessWithSlot;
  if (!p[SLOT]) p[SLOT] = {};
  return p[SLOT]!;
}

export function getMastra(): Promise<Mastra> {
  const s = slot();
  if (!s.promise) s.promise = buildMastra();
  return s.promise;
}

async function buildMastra(): Promise<Mastra> {
  const agents = await buildAllAgents();

  // No `server.auth` provider. Mastra runs in-process behind
  // `withAuthenticatedRoute` (src/app/api/_lib/route-handler.ts) —
  // every caller authenticates at the Next.js boundary before reaching
  // the agent. The Hono HTTP surface is not exposed publicly, so
  // gating it with an auth provider would be cargo-culted. If a future
  // machine-to-machine surface is required, it lands as a Route
  // Handler with its own API-key check, not as a Hono provider.

  return new Mastra({
    agents,
    workflows: allWorkflows,
    tools: allTools,
    scorers: {},
    editor: new MastraEditor(),
    // Mastra calls storage.init() automatically and creates its mastra_*
    // tables on first request. PgVector is added later, attached to a
    // Memory instance — not at the top level.
    storage,
    logger: new PinoLogger({ name: 'Mastra', level: 'info' }),
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'mastra',
          exporters: [new DefaultExporter()],
          spanOutputProcessors: [new SensitiveDataFilter()],
        },
      },
    }),
  });
}
