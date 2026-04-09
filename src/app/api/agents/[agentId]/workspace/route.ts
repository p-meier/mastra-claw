import 'server-only';

import { NextResponse } from 'next/server';

import { withAuthenticatedRoute } from '@/app/api/_lib';
import { listWorkspace } from '@/mastra/lib/workspace-service';

/**
 * GET /api/agents/[agentId]/workspace?path=foo/bar
 *
 * List entries inside the (user, agent) workspace at the given
 * relative path. Defaults to the workspace root when `path` is omitted.
 *
 * `WorkspacePathError` and `WorkspaceNotConfiguredError` are mapped to
 * 400 / 503 by the central `toErrorResponse` in `@/app/api/_lib`.
 */
export const GET = withAuthenticatedRoute<{ agentId: string }>({
  handler: async ({ req, user, facade, params }) => {
    const agent = await facade.agents.get(params.agentId);
    if (!agent) {
      return NextResponse.json(
        { error: `Agent not found: ${params.agentId}` },
        { status: 404 },
      );
    }

    const url = new URL(req.url);
    const relativePath = url.searchParams.get('path') ?? '';

    const entries = await listWorkspace(user, params.agentId, relativePath);
    return NextResponse.json({ path: relativePath, entries });
  },
});
