import 'server-only';

import { z } from 'zod';

import type { CurrentUser } from '@/lib/auth';
import type { createClient } from '@/lib/supabase/server';

/**
 * Atomic commit of the personal onboarding wizard. Used by both:
 *
 *  - The bootstrap chat's `complete_bootstrap` tool, when the agent
 *    decides on its own that the interview is done.
 *  - The "Finish setup" button's `/api/onboarding/bootstrap/finalize`
 *    endpoint, when the user wants to wrap up immediately.
 *
 * Both paths converge here so the same row update + telegram link upsert
 * runs regardless of which path triggered the commit. Pure function,
 * not a server action — callers pass in their already-resolved Supabase
 * client and current user, which sidesteps the async-context fragility
 * we hit when calling 'use server' actions from inside `streamText`'s
 * tool execute closure.
 */

// Shared schema — also reused by the finalize endpoint's generateObject()
// call so structured output and the chat tool produce identical shapes.
//
// The bootstrap interview produces exactly two pieces of information:
// (1) how the assistant should address the user, (2) a free-form Markdown
// document about the user (identity, work, communication preferences).
// Modeled after Claude Desktop's "Personal Preferences" textarea — one
// string, no nested schema. Editable from /account/settings later.
//
// The agent's own name is intentionally NOT here. Agents are first-class
// entities in Mastra; their identity is their agent ID. Per-user agent
// renaming is a different feature for later.
export const personaSchema = z.object({
  nickname: z
    .string()
    .min(1)
    .describe(
      'How the assistant should address the user — typically a first name or chosen handle (e.g. "Patrick", "Pat", "boss").',
    ),
  user_preferences: z
    .string()
    .min(1)
    .describe(
      'A Markdown document describing the user — identity, work, communication preferences, anything else worth remembering long-term. Should be concise (under ~30 lines) but information-dense. Use H2 sections (## Identity, ## Work, ## Communication, ...) for structure.',
    ),
});

export type PersonaPayload = z.infer<typeof personaSchema>;

export type Tone = 'casual' | 'crisp' | 'friendly' | 'playful';

export type PersonalOnboardingDraft = {
  /**
   * Communication-style preference picked by the user in the wizard
   * before the chat starts. Passed into the bootstrap system prompt as
   * a hint, and merged by the model into the `## Communication Style`
   * section of the final `user_preferences` Markdown.
   */
  tone: Tone;
  telegramSkipped: boolean;
  telegramUserId: string | null;
};

export type CommitResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Run the atomic commit. Caller is responsible for having already
 * authenticated the user and constructed a Supabase client tied to that
 * user's session — both are passed in so this function does no
 * request-context I/O of its own.
 */
export async function commitPersonalOnboarding(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: CurrentUser,
  draft: PersonalOnboardingDraft,
  persona: PersonaPayload,
): Promise<CommitResult> {
  // Defensive validation (the form path should have caught all of this
  // already, but the tool/finalize paths are inputs from the model and
  // need an explicit guard).
  if (!persona.nickname?.trim()) {
    return { ok: false, error: 'Missing nickname' };
  }
  if (!persona.user_preferences?.trim()) {
    return { ok: false, error: 'Missing user preferences' };
  }
  if (!['casual', 'crisp', 'friendly', 'playful'].includes(draft.tone)) {
    return { ok: false, error: 'Invalid tone' };
  }
  if (
    !draft.telegramSkipped &&
    (!draft.telegramUserId || !/^\d+$/.test(draft.telegramUserId))
  ) {
    return { ok: false, error: 'Invalid Telegram user ID' };
  }

  // 1. user_profiles row update — nickname, preferences, completion timestamp
  const { error: profileError } = await supabase
    .from('user_profiles')
    .update({
      nickname: persona.nickname.trim(),
      user_preferences: persona.user_preferences.trim(),
      bootstrap_thread_id: null,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq('user_id', user.userId);

  if (profileError) {
    return {
      ok: false,
      error: `Failed to save profile: ${profileError.message}`,
    };
  }

  // 2. user_telegram_links row, if not skipped. The link itself is
  // what the channel input processor uses to map an inbound Telegram
  // message back to the MastraClaw user — channel↔agent routing is
  // handled by Mastra's `channels` config on the agent, not by a
  // database `bindings` table.
  if (!draft.telegramSkipped && draft.telegramUserId) {
    const telegramId = Number.parseInt(draft.telegramUserId, 10);
    const { error: linkError } = await supabase
      .from('user_telegram_links')
      .upsert(
        { user_id: user.userId, telegram_user_id: telegramId },
        { onConflict: 'user_id,telegram_user_id' },
      );
    if (linkError) {
      return {
        ok: false,
        error: `Failed to link Telegram: ${linkError.message}`,
      };
    }
  }

  return { ok: true };
}
