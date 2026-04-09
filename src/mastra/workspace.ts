import 'server-only';

import { Workspace, WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { S3Filesystem } from '@mastra/s3';

import { env } from '@/lib/env';

/**
 * Workspace error classes.
 *
 * Defined here (the lowest layer) so both `createUserAgentWorkspace`
 * and the higher-level `workspace-service.ts` CRUD helpers can throw
 * the same types without a circular import. `workspace-service.ts`
 * re-exports these for call-site stability.
 */
export class WorkspaceNotConfiguredError extends Error {
  constructor() {
    super('Workspace storage is not configured (Supabase S3 env vars missing)');
    this.name = 'WorkspaceNotConfiguredError';
  }
}

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(`Workspace path rejected: ${message}`);
    this.name = 'WorkspacePathError';
  }
}

/**
 * Single shared `S3Filesystem` instance for the `workspaces` bucket.
 *
 * Wired against the Supabase Storage S3-compatible endpoint — same
 * codepath in dev (local MinIO inside the `supabase start` stack) and
 * prod (`*.supabase.co/storage/v1/s3`). The credentials come from
 * Layer A env vars.
 *
 * The bucket is created by the `_workspace_bucket.sql` migration. The
 * filesystem itself does NOT enforce per-tenant isolation — that's the
 * job of `workspace-service.ts`, which prefixes every key with
 * `users/<userId>/agents/<agentId>/` and validates against path
 * traversal. A second layer of defense lives in the storage RLS
 * policies in the same migration.
 *
 * Returns `null` if S3 env vars are not configured (e.g. early
 * Phase-1 dev environments without local Supabase running). Callers
 * should handle this gracefully and surface a "Workspace not
 * configured" message rather than crashing.
 */
let cached: S3Filesystem | null | undefined;

export function getWorkspaceFilesystem(): S3Filesystem | null {
  if (cached !== undefined) return cached;

  const endpoint = env.SUPABASE_S3_ENDPOINT;
  const accessKeyId = env.SUPABASE_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.SUPABASE_S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    cached = null;
    return cached;
  }

  cached = new S3Filesystem({
    bucket: 'workspaces',
    // Supabase Storage requires `region: 'us-east-1'` in the SigV4
    // signature regardless of where the project actually lives. The
    // endpoint URL is what determines routing.
    region: 'us-east-1',
    endpoint,
    accessKeyId,
    secretAccessKey,
    // Path-style URLs are mandatory for Supabase Storage's S3 facade.
    forcePathStyle: true,
  });

  return cached;
}

// ---------------------------------------------------------------------------
// Per-(user, agent) workspace builder
// ---------------------------------------------------------------------------

/**
 * Build a fresh per-user, per-agent `Workspace` instance backed by a
 * `S3Filesystem` whose `prefix` pins it to
 * `users/<userId>/agents/<agentId>/`.
 *
 * This is what an `Agent`'s dynamic `workspace: ({ requestContext }) =>
 * ...` resolver returns. Mastra then auto-wires the standard workspace
 * tools (`mastra_workspace_read_file`, `_write_file`, `_list_files`,
 * `_grep`, …) into the agent and routes every key through the prefixed
 * S3 client — there is no way for the agent to escape its scope at the
 * filesystem layer.
 *
 * Defense in depth: the storage RLS policies in
 * `supabase/migrations/20260409103831_workspace_bucket.sql` re-enforce
 * the same `users/<userId>/agents/<agentId>/` prefix server-side, so a
 * bug here still cannot leak data across tenants.
 *
 * Returns `null` if the Layer A S3 env vars are not configured (e.g. an
 * early dev environment without `npx supabase start` running). The
 * agent's resolver should treat `null` as "no workspace for this
 * request" and let Mastra fall back to no workspace tools.
 *
 * Throws `WorkspacePathError` if `userId` or `agentId` fails the same
 * shape checks `workspace-service.ts:resolveKey` enforces — both inputs
 * land in the S3 key, so we validate at the boundary.
 */
export function createUserAgentWorkspace(
  userId: string,
  agentId: string,
): Workspace | null {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId,
    )
  ) {
    throw new WorkspacePathError(`invalid user id: ${userId}`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(agentId)) {
    throw new WorkspacePathError(`invalid agent id: ${agentId}`);
  }

  const endpoint = env.SUPABASE_S3_ENDPOINT;
  const accessKeyId = env.SUPABASE_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.SUPABASE_S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  // Fresh instance per (user, agent) — the singleton from
  // `getWorkspaceFilesystem()` is unprefixed and is intentionally not
  // reused here, since `S3Filesystem.prefix` is constructor-only.
  const filesystem = new S3Filesystem({
    bucket: 'workspaces',
    region: 'us-east-1',
    endpoint,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: true,
    prefix: `users/${userId}/agents/${agentId}/`,
  });

  return new Workspace({
    id: `user-${userId}-agent-${agentId}`,
    name: `${agentId} workspace`,
    filesystem,
    // Filesystem-only — no sandbox in Phase 1. Gate destructive and
    // overwrite-style operations behind approval; align with the
    // Personal Assistant's "never take destructive action without
    // explicit confirmation" rule.
    tools: {
      [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
        requireApproval: true,
        requireReadBeforeWrite: true,
      },
      [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
        requireApproval: true,
        requireReadBeforeWrite: true,
      },
      [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
        requireApproval: true,
      },
    },
  });
}
