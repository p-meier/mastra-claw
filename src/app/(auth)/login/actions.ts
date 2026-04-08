'use server';

import { isAuthApiError } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * Server Action — sign in with email + password.
 *
 * Runs server-side, so credentials never touch any client bundle. On
 * success, the Supabase server client writes the session cookie via its
 * `setAll`, the proxy picks it up on the next request, and we redirect to
 * the originally requested page (`next`) or `/`.
 *
 * On failure we encode an error CODE (not a message) into the redirect
 * URL. The login page maps the code to user-facing copy via
 * `mapAuthError()`. This keeps user-visible text out of URLs, makes future
 * i18n trivial, and follows the Supabase docs guidance to identify errors
 * by `error.code`/`error.name` rather than by string-matching `error.message`.
 *
 * The full error is also logged server-side so it shows up in `next dev`
 * and Vercel logs for debugging.
 */
export async function signInAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');

  if (!email || !password) {
    redirectWithError('missing_credentials', next);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Server-side log so we never lose the diagnostic detail.
    console.error('[mastra-claw] signInWithPassword failed', {
      name: error.name,
      code: 'code' in error ? error.code : undefined,
      status: 'status' in error ? error.status : undefined,
      message: error.message,
    });

    // Prefer the typed `code` from AuthApiError. Fall back to `name` for
    // client-side errors (network down, etc.). Final fallback is `unknown`,
    // which the login page maps to a generic "try again" message.
    const code = isAuthApiError(error)
      ? error.code ?? 'unknown'
      : error.name ?? 'unknown';

    redirectWithError(code, next);
  }

  revalidatePath('/', 'layout');
  redirect(next);
}

function redirectWithError(code: string, next: string): never {
  const params = new URLSearchParams({ error: code, next });
  redirect(`/login?${params.toString()}`);
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
