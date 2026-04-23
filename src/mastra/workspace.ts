import 'server-only';

import type { RequestContext } from '@mastra/core/request-context';
import { Workspace, WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { S3Filesystem } from '@mastra/s3';

import { env } from '@/lib/env';

import { getResourceId } from './lib/request-context';

// See the matching comment in `lib/request-context.ts` — the workspace
// helpers are schema-agnostic readers, so they widen to `any` at the
// parameter type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRequestContext = RequestContext<any>;

/**
 * Workspace error classes.
 *
 * Defined here (the lowest layer) so both the workspace builder and
 * any higher-level CRUD helpers can throw the same types without a
 * circular import.
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

// ---------------------------------------------------------------------------
// `@mastra/s3` 0.3.0 workaround
// ---------------------------------------------------------------------------
//
// Upstream bug: `S3Filesystem.toKey(path)` does `prefix + path` with
// no normalisation, so a default `readdir('.')` becomes a
// ListObjectsV2 `Prefix` of `agents/.../user:xxx/./` and matches
// nothing on S3. Symptom: `writeFile('note.md')` lands correctly
// (explicit name concatenates cleanly), but every tree-listing from
// the agent's default cwd returns 0 files.
//
// Remove once upstream ships a fix.
function patchS3PathNormalisation(fs: S3Filesystem): S3Filesystem {
  type WithToKey = { toKey: (path: string) => string };
  const bag = fs as unknown as WithToKey;
  const original = bag.toKey.bind(fs);
  bag.toKey = (path) => {
    if (path === '.' || path === './') return original('');
    return original(path.replace(/^(?:\.\/)+/, ''));
  };
  return fs;
}

// ---------------------------------------------------------------------------
// Unprefixed singleton — mostly for admin utilities / debugging
// ---------------------------------------------------------------------------
//
// Returns `null` if S3 env vars are missing (e.g. early Phase-1 dev
// environments without Supabase running). Callers should handle null
// gracefully.

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

  cached = patchS3PathNormalisation(
    new S3Filesystem({
      bucket: 'workspaces',
      // SigV4 signing region. The old `<ref>.supabase.co/storage/v1/s3`
      // endpoint signed against `us-east-1` regardless of the project
      // region; the new `<ref>.storage.supabase.co/storage/v1/s3` one
      // signs against the actual project region (e.g. `eu-west-3`).
      // Read it from env with a safe fallback so both endpoint shapes
      // work.
      region: env.SUPABASE_S3_REGION ?? 'us-east-1',
      endpoint,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: true,
    }),
  );

  return cached;
}

// ---------------------------------------------------------------------------
// Per-request workspace factory
// ---------------------------------------------------------------------------
//
// Prefix shape: `agents/{agentId}/{resourceId}/`. The same structure
// works for personal agents (`user:{userId}`) and future global
// agents (`agent:{agentId}`).
//
// The agent file constructs `new Workspace({...})` itself; we hand out
// the filesystem and a stable workspace id. Mastra's Workspace
// primitive stays visible and the agent owns the tool-approval policy.

export function buildSupabaseS3FileSystem(
  agentId: string,
  requestContext: AnyRequestContext,
): S3Filesystem {
  const resourceId = getResourceId(requestContext);
  const endpoint = env.SUPABASE_S3_ENDPOINT;
  const accessKeyId = env.SUPABASE_S3_ACCESS_KEY_ID;
  const secretAccessKey = env.SUPABASE_S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new WorkspaceNotConfiguredError();
  }

  return patchS3PathNormalisation(
    new S3Filesystem({
      bucket: 'workspaces',
      region: 'us-east-1',
      endpoint,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: true,
      prefix: `agents/${agentId}/${resourceId}/`,
    }),
  );
}

/**
 * Stable workspace id so future Studio-like tooling can link to the
 * same workspace across reloads. Colons in the resourceId get replaced
 * with a character that's safe in URL path segments everywhere.
 */
export function workspaceIdFor(
  agentId: string,
  requestContext: AnyRequestContext,
): string {
  const resourceId = getResourceId(requestContext);
  const safeResource = resourceId.replace(/[^A-Za-z0-9]+/g, '_');
  return `${agentId}--${safeResource}`;
}

/**
 * Build a fresh per-request `Workspace` for the given agent, backed by
 * a prefixed `S3Filesystem`. Mastra auto-wires the standard workspace
 * tools (`mastra_workspace_read_file`, `_write_file`, `_list_files`,
 * `_grep`, …) into the agent and routes every key through the prefix
 * — there is no way for the agent to escape its scope at the
 * filesystem layer.
 *
 * Destructive and overwrite-style operations are gated behind
 * approval to align with the Personal Assistant's "never take
 * destructive action without explicit confirmation" rule.
 *
 * Defense in depth: the storage RLS policies (per the workspace
 * bucket migration) re-enforce access server-side, so a bug here
 * still cannot leak data across tenants.
 */
export function buildWorkspace(
  agentId: string,
  requestContext: AnyRequestContext,
): Workspace {
  const filesystem = buildSupabaseS3FileSystem(agentId, requestContext);
  return new Workspace({
    id: workspaceIdFor(agentId, requestContext),
    name: `${agentId} workspace`,
    filesystem,
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
