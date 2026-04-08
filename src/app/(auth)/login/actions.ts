'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * Server Action — sign in with email + password.
 *
 * This runs server-side, so the credentials never touch any client bundle.
 * On success, the supabase client writes the session cookie via the server
 * client's `setAll`, the proxy picks it up on the next request, and we
 * redirect either to the originally requested page (`next` param) or `/`.
 *
 * On failure we encode the error in the redirect target so the form can
 * render it. We deliberately do not return error data — Server Actions
 * that throw inside a redirect/revalidate window can leak stack traces,
 * and a redirect-with-error is a well-trodden Next.js pattern.
 */
export async function signInAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');

  if (!email || !password) {
    redirect(`/login?error=missing_credentials&next=${encodeURIComponent(next)}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(
      `/login?error=${encodeURIComponent(error.message)}&next=${encodeURIComponent(next)}`,
    );
  }

  revalidatePath('/', 'layout');
  redirect(next);
}

/**
 * Server Action — sign out.
 * Wipes the Supabase session and refreshes the cached layout so any
 * cached server data is dropped.
 */
export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
