import 'server-only';

import { S3Filesystem } from '@mastra/s3';

import { env } from '@/lib/env';

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
