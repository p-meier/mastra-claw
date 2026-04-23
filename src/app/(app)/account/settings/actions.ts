'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Update the per-user profile preferences (preferred_name +
 * user_prompt Markdown). RLS on `public.user_profiles` enforces that
 * the calling user can only touch their own row, so the action just
 * runs an update tied to `user_id = current uid`.
 */

const inputSchema = z.object({
  preferredName: z.string().trim().min(1, 'Preferred name is required').max(100),
  userPrompt: z
    .string()
    .trim()
    .min(1, 'Preferences cannot be empty')
    .max(20_000, 'Preferences too long'),
});

export type UpdateProfilePreferencesInput = z.infer<typeof inputSchema>;

export type UpdateProfilePreferencesResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateProfilePreferencesAction(
  input: UpdateProfilePreferencesInput,
): Promise<UpdateProfilePreferencesResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: 'Not authenticated' };
  }

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join('; '),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('user_profiles')
    .update({
      preferred_name: parsed.data.preferredName,
      user_prompt: parsed.data.userPrompt,
    })
    .eq('user_id', user.userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath('/account/settings');
  return { ok: true };
}
