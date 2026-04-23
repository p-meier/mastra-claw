import 'server-only';

import type { Agent } from '@mastra/core/agent';
import type { StorageThreadType } from '@mastra/core/memory';
import type { UIMessage } from 'ai';
import { z } from 'zod';

import type { CurrentUser } from '@/lib/auth';
import { getMastra } from '@/mastra';

/**
 * Per-user agent enumeration. Phase 1 only has code-defined agents
 * (currently just `personal-assistant`); when stored agents land later,
 * this service merges code + DB results behind the same surface so call
 * sites don't need to change.
 *
 * Filtering today is a no-op: every authenticated user sees every
 * code-defined agent. Once we add stored agents with `authorId` columns,
 * the user-scoped path filters by `authorId = user.userId` (admins see
 * all).
 *
 * **Type rule (CLAUDE.md):** this file reuses Mastra's own types
 * (`Agent` from `@mastra/core/agent`, `StorageThreadType` from
 * `@mastra/core/memory`, `UIMessage` from `ai`) and does not invent
 * parallel DTOs. Custom narrow types only appear at boundaries that
 * genuinely need less than what Mastra returns — and in that case they
 * are derived (e.g. `Pick<>`) rather than hand-rolled.
 */

// ---------------------------------------------------------------------------
// Mastra DB message → AI SDK UIMessage validation
// ---------------------------------------------------------------------------
//
// `Memory.recall()` returns `MastraDBMessage[]` (V2 format with
// `content.parts` plus a legacy `content.content` string fallback).
// We validate the slice we actually consume here so a future Mastra
// version bump that changes the wire format fails noisily instead of
// silently dropping data into the chat UI.

const dbTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const dbMessageSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.object({
    parts: z.array(z.unknown()).optional(),
    content: z.string().optional(),
  }),
});

/**
 * Convert one Mastra DB message into an AI SDK v6 `UIMessage` suitable
 * for `useChatRuntime({ messages })`. Drops anything that isn't text in
 * Phase 1; returns `null` for messages that have no renderable text at
 * all (so the caller can filter them out).
 */
function dbMessageToUIMessage(raw: unknown): UIMessage | null {
  const parsed = dbMessageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const m = parsed.data;

  const textParts: Array<{ type: 'text'; text: string }> = [];
  for (const part of m.content.parts ?? []) {
    const tp = dbTextPartSchema.safeParse(part);
    if (tp.success && tp.data.text.length > 0) {
      textParts.push({ type: 'text' as const, text: tp.data.text });
    }
  }

  // Older format / streaming-edge: some assistant messages persist a
  // flat `content.content` string instead of parts. Fall back to that
  // so we don't drop the whole message.
  if (textParts.length === 0 && m.content.content && m.content.content.length > 0) {
    textParts.push({ type: 'text' as const, text: m.content.content });
  }

  if (textParts.length === 0) return null;

  return {
    id: m.id,
    role: m.role,
    parts: textParts,
  } satisfies UIMessage;
}

// ---------------------------------------------------------------------------
// listAgentsForUser
// ---------------------------------------------------------------------------

export async function listAgentsForUser(
  _user: CurrentUser,
): Promise<Agent[]> {
  // Phase 1: code-defined agents only. Every user sees every code agent.
  // TODO: when stored agents land, filter by authorId for the user
  // facade and merge with the code registry for admins.
  const mastra = await getMastra();
  return Object.values(mastra.listAgents());
}

// ---------------------------------------------------------------------------
// getAgentForUser
// ---------------------------------------------------------------------------

export async function getAgentForUser(
  _user: CurrentUser,
  agentId: string,
): Promise<Agent | null> {
  return findAgentById(agentId);
}

async function findAgentById(agentId: string): Promise<Agent | null> {
  const mastra = await getMastra();
  const registry = mastra.listAgents();
  for (const agent of Object.values(registry) as Agent[]) {
    if (agent.id === agentId) return agent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// listAgentThreadsForUser
// ---------------------------------------------------------------------------

/**
 * List the most recent conversation threads for `(user, agent)` pair,
 * scoped by `resource_id = user_<userId>`. Returns at most 50 — Phase 1
 * keeps pagination out of the UI.
 *
 * Returns `[]` if the agent has no memory configured or doesn't exist.
 */
export async function listAgentThreadsForUser(
  user: CurrentUser,
  agentId: string,
): Promise<StorageThreadType[]> {
  const agent = await findAgentById(agentId);
  if (!agent) return [];

  // `Agent.getMemory()` is async — see
  // node_modules/@mastra/memory/dist/docs/references/reference-memory-listThreads.md
  const memory = await agent.getMemory?.();
  if (!memory) return [];

  const resourceId = `user_${user.userId}`;
  const result = await memory.listThreads({
    filter: { resourceId },
    perPage: 50,
    page: 0,
    orderBy: { field: 'updatedAt', direction: 'DESC' },
  });

  return result?.threads ?? [];
}

// ---------------------------------------------------------------------------
// loadThreadMessagesForUser
// ---------------------------------------------------------------------------

/**
 * Load all messages for a thread, scoped by `resource_id = user_<userId>`,
 * and convert them into AI SDK v6 `UIMessage` records suitable for
 * seeding `useChatRuntime({ messages })`.
 *
 * Phase 1 only persists plain text (no tool calls, files, or
 * reasoning), so the conversion is intentionally minimal: every part
 * that isn't `text` is dropped, and any message that ends up with
 * zero parts is filtered out.
 *
 * Returns `null` if the thread doesn't belong to this user (Mastra's
 * own ownership check raises when `resourceId` mismatches), if the
 * agent has no memory configured, or if the agent doesn't exist.
 */
export async function loadThreadMessagesForUser(
  user: CurrentUser,
  agentId: string,
  threadId: string,
): Promise<UIMessage[] | null> {
  const agent = await findAgentById(agentId);
  if (!agent) return null;

  const memory = await agent.getMemory?.();
  if (!memory) return null;

  // Defense in depth: confirm the thread is owned by this user before
  // we hand back any content. Mastra's own resource enforcement will
  // also catch this, but checking here makes intent obvious at the
  // call site.
  const thread = await memory.getThreadById({ threadId });
  if (!thread) return null;
  const expectedResource = `user_${user.userId}`;
  if (thread.resourceId !== expectedResource) return null;

  const result = await memory.recall({
    threadId,
    perPage: false,
  });

  const dbMessages = result?.messages ?? [];
  const uiMessages: UIMessage[] = [];
  for (const m of dbMessages) {
    const ui = dbMessageToUIMessage(m);
    if (ui) uiMessages.push(ui);
  }
  return uiMessages;
}

