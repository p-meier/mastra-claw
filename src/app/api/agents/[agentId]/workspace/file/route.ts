import 'server-only';

import { NextResponse } from 'next/server';

import { withAuthenticatedRoute } from '@/app/api/_lib';
import {
  deleteWorkspaceFile,
  readWorkspaceFile,
  writeWorkspaceFile,
} from '@/mastra/lib/workspace-service';

/**
 * GET /api/agents/[agentId]/workspace/file?path=foo.md
 *
 * Read a single file from the workspace as text.
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

    const relativePath = requirePathParam(req);
    if (relativePath instanceof Response) return relativePath;

    const { content, size } = await readWorkspaceFile(
      user,
      params.agentId,
      relativePath,
    );
    return NextResponse.json({ path: relativePath, content, size });
  },
});

/**
 * PUT /api/agents/[agentId]/workspace/file?path=foo.md
 *
 * Write a file. Body is the raw content as text. Phase 1 keeps things
 * simple — multipart binary uploads land later.
 */
export const PUT = withAuthenticatedRoute<{ agentId: string }>({
  handler: async ({ req, user, facade, params }) => {
    const agent = await facade.agents.get(params.agentId);
    if (!agent) {
      return NextResponse.json(
        { error: `Agent not found: ${params.agentId}` },
        { status: 404 },
      );
    }

    const relativePath = requirePathParam(req);
    if (relativePath instanceof Response) return relativePath;

    const content = await req.text();
    await writeWorkspaceFile(user, params.agentId, relativePath, content);
    return NextResponse.json({ ok: true });
  },
});

/**
 * DELETE /api/agents/[agentId]/workspace/file?path=foo.md
 */
export const DELETE = withAuthenticatedRoute<{ agentId: string }>({
  handler: async ({ req, user, facade, params }) => {
    const agent = await facade.agents.get(params.agentId);
    if (!agent) {
      return NextResponse.json(
        { error: `Agent not found: ${params.agentId}` },
        { status: 404 },
      );
    }

    const relativePath = requirePathParam(req);
    if (relativePath instanceof Response) return relativePath;

    await deleteWorkspaceFile(user, params.agentId, relativePath);
    return NextResponse.json({ ok: true });
  },
});

function requirePathParam(req: Request): string | Response {
  const url = new URL(req.url);
  const relativePath = url.searchParams.get('path') ?? '';
  if (!relativePath) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }
  return relativePath;
}
