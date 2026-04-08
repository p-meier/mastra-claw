import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';

/**
 * The shape every server-side authorization decision in MastraClaw uses.
 *
 * `userId` and `email` come from `auth.users`. `role` is read from
 * `app_metadata.role` (server-controlled, not user-editable — see the
 * Supabase skill security checklist).
 *
 * The future `mastraFor(currentUser)` factory takes exactly this object as
 * its argument.
 */
export type CurrentUser = {
  userId: string;
  email: string;
  role: 'admin' | 'user';
};

/**
 * Returns the currently signed-in user, or `null` if there is no session.
 *
 * Uses `supabase.auth.getUser()` (network call to the auth server, fully
 * validated) rather than `getClaims()` because we need the canonical role
 * from `app_metadata`, which is only guaranteed-fresh via the server-side
 * round-trip. The proxy already cached/refreshed the session cookie, so
 * the network call here is fast and serves as the authoritative check.
 *
 * Throws if Supabase itself errors out (network down, etc.) — callers
 * should treat that as "not authenticated" and either redirect or 401.
 */
/**
 * Wrapped in `React.cache` so that calling getCurrentUser() multiple times
 * during the same request (layout + page + nested component) only triggers
 * one network round-trip to the Supabase auth server.
 */
export const getCurrentUser = cache(
  async (): Promise<CurrentUser | null> => {
    const supabase = await createClient();

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) return null;

    const role = (user.app_metadata as { role?: string } | undefined)?.role;
    return {
      userId: user.id,
      email: user.email ?? '',
      role: role === 'admin' ? 'admin' : 'user',
    };
  },
);

/**
 * Strict variant: throws an `AdminRequiredError` if the current user is
 * missing or not an admin. Use this at the top of any Server Action /
 * Route Handler that performs admin-only operations.
 *
 * Per CLAUDE.md, this explicit check must appear at every admin entry
 * point even when the underlying factory would also gate it — defense in
 * depth makes the intent visible at the call site.
 */
export class AdminRequiredError extends Error {
  constructor() {
    super('Admin access required');
    this.name = 'AdminRequiredError';
  }
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    throw new AdminRequiredError();
  }
  return user;
}
