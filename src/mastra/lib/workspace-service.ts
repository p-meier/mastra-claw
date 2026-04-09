import 'server-only';

import * as path from 'node:path';

import type { CurrentUser } from '@/lib/auth';
import {
  getWorkspaceFilesystem,
  WorkspaceNotConfiguredError,
  WorkspacePathError,
} from '@/mastra/workspace';

// Re-exported for call-site stability — the canonical definitions live
// in `@/mastra/workspace` so the lower-level `createUserAgentWorkspace`
// builder can throw the same types without a circular import.
export { WorkspaceNotConfiguredError, WorkspacePathError };

/**
 * Per-tenant workspace helpers wrapping the shared S3 filesystem.
 *
 * Every operation accepts a relative `path` within the user/agent
 * scope and resolves it against the `users/<userId>/agents/<agentId>/`
 * prefix. The resolved key is normalized via `path.posix.normalize`
 * and then strictly validated to start with the expected prefix —
 * anything that escapes (via `..`, leading `/`, embedded null bytes,
 * etc.) raises `WorkspacePathError` and is rejected before touching
 * S3.
 *
 * Defense in depth: the `_workspace_bucket.sql` migration also
 * enforces per-user isolation at the storage RLS layer, so a bug here
 * still cannot leak data across tenants.
 */

export type WorkspaceEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | null;
};

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export async function listWorkspace(
  user: CurrentUser,
  agentId: string,
  relativePath = '',
): Promise<WorkspaceEntry[]> {
  const fs = requireFs();
  const { absolute, prefix } = resolveKey(user, agentId, relativePath);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries = (await fs.readdir(absolute)) as any[];
  return entries.map((e) => ({
    name: e.name,
    path: stripPrefix(e.path ?? `${absolute}/${e.name}`, prefix),
    type: e.isDirectory ? 'directory' : 'file',
    size: typeof e.size === 'number' ? e.size : null,
  }));
}

export async function readWorkspaceFile(
  user: CurrentUser,
  agentId: string,
  relativePath: string,
): Promise<{ content: string; size: number }> {
  if (!relativePath) {
    throw new WorkspacePathError('empty path');
  }
  const fs = requireFs();
  const { absolute } = resolveKey(user, agentId, relativePath);
  const buf = await fs.readFile(absolute);
  const content = typeof buf === 'string' ? buf : buf.toString('utf-8');
  return { content, size: content.length };
}

export async function writeWorkspaceFile(
  user: CurrentUser,
  agentId: string,
  relativePath: string,
  content: string | Buffer,
): Promise<void> {
  if (!relativePath) {
    throw new WorkspacePathError('empty path');
  }
  const fs = requireFs();
  const { absolute } = resolveKey(user, agentId, relativePath);
  await fs.writeFile(absolute, content);
}

export async function deleteWorkspaceFile(
  user: CurrentUser,
  agentId: string,
  relativePath: string,
): Promise<void> {
  if (!relativePath) {
    throw new WorkspacePathError('empty path');
  }
  const fs = requireFs();
  const { absolute } = resolveKey(user, agentId, relativePath);
  await fs.deleteFile(absolute);
}

// ---------------------------------------------------------------------------
// Path resolution + traversal guard
// ---------------------------------------------------------------------------

const PREFIX_FOR = (userId: string, agentId: string) =>
  `users/${userId}/agents/${agentId}`;

/**
 * Resolve a user-supplied relative path inside the per-(user,agent)
 * workspace prefix. Throws `WorkspacePathError` if the resolved path
 * escapes the prefix.
 *
 * Rules:
 *  - userId must be a UUID-shaped string (already enforced by auth).
 *  - agentId must be a slug (`[a-z0-9-]+`) — the runtime check below
 *    rejects anything else, since `agentId` is taken from a URL param.
 *  - relativePath cannot start with `/`, contain `\0`, or contain
 *    URL-encoded escapes — those are normalized away from the input
 *    before we touch them.
 *  - After joining + normalizing, the result must start with
 *    `users/<userId>/agents/<agentId>/` (or equal that without trailing
 *    slash for the directory listing case).
 */
export function resolveKey(
  user: CurrentUser,
  agentId: string,
  relativePath: string,
): { absolute: string; prefix: string } {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(agentId)) {
    throw new WorkspacePathError(`invalid agent id: ${agentId}`);
  }

  // Reject obviously hostile inputs before normalization.
  if (relativePath.includes('\0')) {
    throw new WorkspacePathError('null byte in path');
  }

  // URL decoding is the caller's responsibility (route handler) — by
  // the time we see the path, it should be plain. Reject percent
  // sequences defensively.
  if (/%2e|%2f|%5c/i.test(relativePath)) {
    throw new WorkspacePathError('encoded separators in path');
  }

  // Reject Windows-style separators outright; we operate on POSIX keys.
  if (relativePath.includes('\\')) {
    throw new WorkspacePathError('backslash in path');
  }

  // Strip leading slashes — the prefix already provides absolute scope.
  const trimmed = relativePath.replace(/^\/+/, '');

  const prefix = PREFIX_FOR(user.userId, agentId);
  const joined = trimmed ? `${prefix}/${trimmed}` : prefix;
  const normalized = path.posix.normalize(joined);

  if (normalized !== prefix && !normalized.startsWith(`${prefix}/`)) {
    throw new WorkspacePathError(
      `escapes scope (resolved to "${normalized}")`,
    );
  }

  return { absolute: normalized, prefix };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function requireFs() {
  const fs = getWorkspaceFilesystem();
  if (!fs) throw new WorkspaceNotConfiguredError();
  return fs;
}

function stripPrefix(absolute: string, prefix: string): string {
  if (absolute === prefix) return '';
  if (absolute.startsWith(`${prefix}/`)) return absolute.slice(prefix.length + 1);
  return absolute;
}
