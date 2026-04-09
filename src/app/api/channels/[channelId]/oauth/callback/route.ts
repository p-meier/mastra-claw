import { NextResponse } from 'next/server';

import { getChannel } from '@/lib/channels/registry';

/**
 * OAuth callback route stub.
 *
 * The full implementation will:
 *  1. Look up the channel descriptor
 *  2. Build the adapter from the stored admin credentials
 *  3. Call the adapter's `handleOAuthCallback(request)` method
 *  4. Persist the resulting installation in the Mastra state adapter
 *
 * Today the route exists so the start route + admin "install"
 * affordance round-trip without crashing. It returns 501 until the
 * adapter wiring is in place.
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
      error: 'OAuth callback handling is not yet implemented for this channel.',
      channel: channelId,
    },
    { status: 501 },
  );
}
