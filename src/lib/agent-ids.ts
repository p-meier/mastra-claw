/**
 * Agent-id and resource-id prefix constants.
 *
 * Single source of truth for every piece of code that needs to either
 * *construct* or *recognise* the prefixed id strings the platform uses.
 * No Mastra runtime imports — this module is safe to import from the
 * web app, schemas, and scripts.
 *
 * ── Two separate namespaces ──────────────────────────────────────────
 *
 *   Agent id     — `personal-<name>`, `global-<name>`
 *                  Dash-separated. Embedded in URLs, logs.
 *
 *   Resource id  — `user:<userId>`, `agent:<id>`
 *                  Colon-separated. Mastra's `MASTRA_RESOURCE_ID_KEY`
 *                  value. Scopes memory/threads/semantic recall.
 *
 * They never overlap in separator or content, so there's no ambiguity
 * when one ends up in the other.
 *
 * ── Two kinds ────────────────────────────────────────────────────────
 *
 *   personal — user-scoped. The caller is the owner. Memory + workspace
 *              both keyed by `user:{userId}`. Only callable via JWT.
 *
 *   global   — no user. Memory + workspace (if any) keyed by
 *              `agent:{agentId}`. Callable by anyone authenticated.
 *              Use for stateless automation and platform-wide utilities.
 *
 * Teams are deliberately not modelled. If the platform ever adds a
 * team scope, it would plug in as a third kind here with a matching
 * resource-id prefix.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Prefix constants
// ═══════════════════════════════════════════════════════════════════════════

export const AGENT_ID_PREFIX = {
  PERSONAL: 'personal-',
  GLOBAL: 'global-',
} as const;

export const RESOURCE_ID_PREFIX = {
  USER: 'user:',
  AGENT: 'agent:',
} as const;

export type AgentKind = 'personal' | 'global';

// ═══════════════════════════════════════════════════════════════════════════
// Agent-id builders
// ═══════════════════════════════════════════════════════════════════════════
//
// Used in agent definitions:
//   new Agent({ id: personalAgent('assistant'), ... })
//
// The `*Agent` suffix on `globalAgent` avoids shadowing Node.js's
// top-level `global` binding. `personalAgent` follows the same pattern
// for API consistency.
//
// The helpers are the only sanctioned way to mint an id — grepping for
// `personalAgent(` / `globalAgent(` lists every registered agent.

export function personalAgent(name: string): string {
  return `${AGENT_ID_PREFIX.PERSONAL}${name}`;
}

export function globalAgent(name: string): string {
  return `${AGENT_ID_PREFIX.GLOBAL}${name}`;
}

/**
 * Classify an agent id into its kind, or `null` when the id doesn't
 * follow the convention. `null` is a platform-internal signal: it means
 * the caller is talking about an agent that was minted outside the
 * helpers above, which we treat as personal-like (user-scoped) by
 * default in the middleware.
 */
export function parseAgentKind(agentId: string): AgentKind | null {
  if (agentId.startsWith(AGENT_ID_PREFIX.PERSONAL)) return 'personal';
  if (agentId.startsWith(AGENT_ID_PREFIX.GLOBAL)) return 'global';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Resource-id builders + parser
// ═══════════════════════════════════════════════════════════════════════════
//
// The entry point sets Mastra's resourceId once per request by calling
// one of the builders below. Factories (workspace, prompt resolver)
// read it back with `parseResourceId`. No string slicing with magic
// numbers lives anywhere outside this file.

export function userResourceId(userId: string): string {
  return `${RESOURCE_ID_PREFIX.USER}${userId}`;
}

export function agentResourceId(agentId: string): string {
  return `${RESOURCE_ID_PREFIX.AGENT}${agentId}`;
}

export type ParsedResourceId =
  | { kind: 'user'; userId: string }
  | { kind: 'agent'; agentId: string };

/**
 * Decompose a resourceId back into its parts. `null` when the string
 * doesn't match any known prefix — callers decide whether that's an
 * error or a fallback.
 */
export function parseResourceId(resourceId: string): ParsedResourceId | null {
  if (resourceId.startsWith(RESOURCE_ID_PREFIX.USER)) {
    return {
      kind: 'user',
      userId: resourceId.substring(RESOURCE_ID_PREFIX.USER.length),
    };
  }
  if (resourceId.startsWith(RESOURCE_ID_PREFIX.AGENT)) {
    return {
      kind: 'agent',
      agentId: resourceId.substring(RESOURCE_ID_PREFIX.AGENT.length),
    };
  }
  return null;
}
