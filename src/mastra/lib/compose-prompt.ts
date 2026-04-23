import 'server-only';

import type { RequestContext } from '@mastra/core/request-context';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { parseResourceId } from '@/lib/agent-ids';

import { getResourceId } from './request-context';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRequestContext = RequestContext<any>;

/**
 * Prompt composition + layered resolver.
 *
 * Two layers: the organisation-wide prompt and the per-user prompt.
 * Teams are out of scope in this codebase.
 *
 * `composePrompt(layers)` is a pure concatenator: `identity`, then the
 * optional org and user blocks under their section headers, separated
 * by blank lines. Empty / whitespace-only layers drop cleanly — no
 * bare heading.
 *
 * `resolveLayeredPrompt(supabase, rc)` reads the layers out of
 * Supabase. The resourceId on the RequestContext tells us the scope:
 *
 *   user:{userId}  → org + user
 *   agent:{id}     → org only
 *
 * A 30-second in-memory TTL cache per resourceId avoids hammering
 * Supabase when Mastra calls `instructions()` repeatedly during a
 * chatty session. Admin edits to an org or user prompt take up to one
 * TTL window to reach a live conversation; shorter than that hurts
 * Supabase throughput, longer than that hurts editing UX.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Organisation setting shape
// ═══════════════════════════════════════════════════════════════════════════
//
// Matches the shape seeded into `platform_settings.organization` and
// maintained by the admin branding step. Inlined here because the
// zod schema is small and this is the only reader today. If more
// consumers land later, it moves into `src/lib/schemas/organization.ts`.

const OrganizationSettingSchema = z.object({
  name: z.string().nullable(),
  organizationPrompt: z.string().nullable(),
  customerLogoPath: z.string().nullable(),
});

// ═══════════════════════════════════════════════════════════════════════════
// Prompt composer
// ═══════════════════════════════════════════════════════════════════════════

export interface ComposePromptLayers {
  identity: string;
  org?: string | null;
  user?: string | null;
}

const SECTION_HEADERS = {
  org: '## Organisation context',
  user: '## About the user',
} as const;

function normaliseLayer(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function composePrompt(layers: ComposePromptLayers): string {
  const parts: string[] = [layers.identity.trim()];
  const org = normaliseLayer(layers.org);
  const user = normaliseLayer(layers.user);
  if (org) parts.push(`${SECTION_HEADERS.org}\n${org}`);
  if (user) parts.push(`${SECTION_HEADERS.user}\n${user}`);
  return parts.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Layered prompt resolver
// ═══════════════════════════════════════════════════════════════════════════

export interface ResolvedPromptLayers {
  org: string | null;
  user: string | null;
}

const PROMPT_CACHE_TTL_MS = 30_000;

interface PromptCacheEntry {
  layers: ResolvedPromptLayers;
  expiresAt: number;
}

// Keyed by resourceId. Entries are independent — one user's edit never
// stales another user's cache, so there is no cross-invalidation
// concern.
const promptLayersCache = new Map<string, PromptCacheEntry>();

async function loadOrgPrompt(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'organization')
    .maybeSingle();
  if (error) {
    throw new Error(`[prompt] failed to read organization setting: ${error.message}`);
  }
  if (!data?.value) return null;
  const parsed = OrganizationSettingSchema.safeParse(data.value);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.warn(
      '[prompt] organization setting is malformed; treating as unset.',
      parsed.error.issues,
    );
    return null;
  }
  return normaliseLayer(parsed.data.organizationPrompt);
}

async function loadUserPrompt(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_prompt')
    .eq('user_id', userId)
    .maybeSingle<{ user_prompt: string | null }>();
  if (error) {
    throw new Error(
      `[prompt] failed to read user_prompt for user ${userId}: ${error.message}`,
    );
  }
  return normaliseLayer(data?.user_prompt);
}

export async function resolveLayeredPrompt(
  supabase: SupabaseClient,
  rc: AnyRequestContext,
): Promise<ResolvedPromptLayers> {
  const resourceId = getResourceId(rc);
  const now = Date.now();
  const cached = promptLayersCache.get(resourceId);
  if (cached && cached.expiresAt > now) return cached.layers;

  const layers = await loadLayersUncached(supabase, resourceId);
  promptLayersCache.set(resourceId, {
    layers,
    expiresAt: now + PROMPT_CACHE_TTL_MS,
  });
  return layers;
}

async function loadLayersUncached(
  supabase: SupabaseClient,
  resourceId: string,
): Promise<ResolvedPromptLayers> {
  const parsed = parseResourceId(resourceId);
  const orgPromise = loadOrgPrompt(supabase);

  if (parsed?.kind === 'user') {
    const [org, user] = await Promise.all([
      orgPromise,
      loadUserPrompt(supabase, parsed.userId),
    ]);
    return { org, user };
  }
  // agent-scope (global) or unrecognised prefix — only org applies.
  const org = await orgPromise;
  return { org, user: null };
}
