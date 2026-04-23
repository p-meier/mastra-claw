import 'server-only';

import type { RequestContext } from '@mastra/core/request-context';
import {
  MASTRA_RESOURCE_ID_KEY,
  MASTRA_THREAD_ID_KEY,
} from '@mastra/core/request-context';

// `RequestContext` is invariant in its schema generic, so a caller with
// a specific schema (e.g. the personal assistant's `userContextSchema`)
// cannot hand a `RequestContext<MySchema>` to a helper typed as
// `RequestContext<unknown>`. Using `any` on these helpers keeps them
// schema-agnostic without needing every call site to widen.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRequestContext = RequestContext<any>;

/**
 * Typed request-context keys for mastra-claw.
 *
 * `RC_RESOURCE_ID` / `RC_THREAD_ID` are Mastra-reserved — when the
 * entry point sets them in RequestContext, Mastra's Agent.stream /
 * Agent.generate picks them up automatically and prefers them over any
 * client-provided values. That closes the "client hijacks another
 * user's memory" attack surface by construction.
 */

export const RC_USER_ID = 'userId' as const;
export const RC_IS_ADMIN = 'isAdmin' as const;
export const RC_RESOURCE_ID = MASTRA_RESOURCE_ID_KEY;
export const RC_THREAD_ID = MASTRA_THREAD_ID_KEY;

// ═══════════════════════════════════════════════════════════════════════════
// Typed readers
// ═══════════════════════════════════════════════════════════════════════════
//
// Fail loudly on missing values — an agent invoked without the
// `withAuthenticatedRoute` chokepoint is a configuration bug and
// should surface immediately in dev, not silently read "" or "system"
// in prod.

function notSet(name: string): never {
  throw new Error(
    `[request-context] "${name}" is not set. ` +
      `The entry point (API route handler, cron, etc.) must call ` +
      `applyUserContext() before invoking the agent.`,
  );
}

export function getUserId(rc: AnyRequestContext): string {
  const value = rc.get(RC_USER_ID);
  if (typeof value !== 'string' || value.length === 0) notSet(RC_USER_ID);
  return value;
}

export function getResourceId(rc: AnyRequestContext): string {
  const value = rc.get(RC_RESOURCE_ID);
  if (typeof value !== 'string' || value.length === 0) notSet(RC_RESOURCE_ID);
  return value;
}

export function isAdmin(rc: AnyRequestContext): boolean {
  return rc.get(RC_IS_ADMIN) === true;
}
