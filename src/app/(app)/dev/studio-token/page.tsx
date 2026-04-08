import { notFound } from 'next/navigation';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const metadata = {
  title: 'Studio Token (dev) — MastraClaw',
};

/**
 * Dev-only page that prints the current user's Supabase access token so it
 * can be pasted into a `Authorization: Bearer <token>` header for the
 * Mastra Studio HTTP API on :4111.
 *
 * Production safety:
 *   - Hard 404 if NODE_ENV !== 'development'.
 *   - Admin-only via requireAdmin() (which throws AdminRequiredError for
 *     non-admin signed-in users).
 *   - Never indexed (no SEO).
 *
 * Why this exists: the Mastra HTTP server is gated by MastraAuthSupabase,
 * which expects a Bearer JWT. The Mastra Studio webapp on :4111 has no way
 * to share Next.js session cookies. The cleanest dev workflow is: log in
 * to Next.js, copy the token from this page, paste it into Studio's
 * Network → Headers (or use a browser extension to inject it).
 *
 * In production, Mastra Studio is not exposed at all — this page returning
 * 404 is the desired behavior.
 */
export default async function StudioTokenPage() {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }

  const currentUser = await requireAdmin();

  // Reach into the underlying session to get the access_token. This is
  // intentionally NOT done via getCurrentUser(), because that helper
  // returns a typed projection without the raw JWT.
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col items-stretch justify-center gap-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Mastra Studio access token (dev only)</CardTitle>
          <CardDescription>
            Signed in as {currentUser.email} ({currentUser.role}). Copy the
            token below and use it as
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
              Authorization: Bearer &lt;token&gt;
            </code>
            against
            <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-xs">
              http://localhost:4111/api
            </code>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          {session?.access_token ? (
            <textarea
              readOnly
              rows={6}
              className="font-mono w-full resize-none rounded-md border bg-muted/50 p-3 text-xs"
              value={session.access_token}
            />
          ) : (
            <p className="text-sm text-destructive">
              No active session found. Sign out and back in.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Tokens expire (default 1h). Refresh this page after sign-in to
            get the latest one. This page returns 404 in production.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
