import { NextResponse } from 'next/server';

import { streamBrandingLogo } from '@/lib/branding';

/**
 * GET /branding/logo
 *
 * Streams the customer logo from the `branding` Supabase Storage
 * bucket. Returns 404 when no logo has been configured — the login
 * page and any fallback template should render the default MastraClaw
 * asset in that case.
 *
 * Public (no auth) on purpose: auth emails and the /login page load
 * this before the user has a session. The `branding` bucket's RLS
 * policies allow anonymous reads.
 *
 * Cache: short (60 s) so admin edits via `/admin/settings` propagate
 * quickly without per-request hits.
 */
export const revalidate = 60;

export async function GET() {
  const logo = await streamBrandingLogo();
  if (!logo) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(logo.body, {
    status: 200,
    headers: {
      'Content-Type': logo.contentType,
      'Cache-Control': 'public, max-age=60, must-revalidate',
    },
  });
}
