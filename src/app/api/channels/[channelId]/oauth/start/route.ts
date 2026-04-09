import { NextResponse } from 'next/server';

import { getChannel } from '@/lib/channels/registry';

/**
 * OAuth start route stub.
 *
 * Slack-multi-workspace, Microsoft Teams, and Google Chat all distribute
 * via an OAuth or admin-consent flow. The proper implementation will
 * redirect the admin to the platform's authorize endpoint and then
 * round-trip back to `/api/channels/{channelId}/oauth/callback`.
 *
 * For this iteration the route exists so the channel admin page can
 * link to it without breaking the build, but it returns 501 until the
 * runtime install logic is wired up. The plan documents this as a
 * paved-road follow-up.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ channelId: string }> },
): Promise<Response> {
  const { channelId } = await ctx.params;
  const descriptor = getChannel(channelId);
  if (!descriptor) {
    return NextResponse.json({ error: 'unknown channel' }, { status: 404 });
  }
  return NextResponse.json(
    {
      error: 'OAuth install flow is not yet implemented for this channel.',
      channel: channelId,
    },
    { status: 501 },
  );
}
