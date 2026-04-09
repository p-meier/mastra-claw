import 'server-only';

import type { RequestContext } from '@mastra/core/request-context';

import type { CurrentUser } from '@/lib/auth';
import { loadProfileAsService } from '@/lib/onboarding/profile';
import { createServiceClient } from '@/lib/supabase/service';

import { AppNotConfiguredError, loadLlmCredentials } from './llm-credentials';
import { applyUserContext } from './user-context';

/**
 * Channel → user context bridge.
 *
 * Mastra channels (Telegram, Slack, Discord, …) attach a `'channel'`
 * key to the request context with the platform user id of the sender.
 * Web requests don't carry it — they go through the chat route handler
 * which already calls `applyUserContext` directly.
 *
 * **Why this is a helper, not an input processor:** Mastra resolves an
 * agent's `model` *before* input processors run. The model resolver
 * needs `llm` already on the request context — so the channel-driven
 * path has to populate it lazily inside the model resolver itself, not
 * in a `BaseProcessor`. The previous attempt used an input processor
 * here and silently fell back to `process.env.ANTHROPIC_API_KEY`; this
 * helper makes the channel path correct end-to-end.
 *
 * Idempotent: if `userId` is already on the context (web path or a
 * second call within the same request), no DB lookups happen.
 *
 * On failure (unlinked Telegram user, missing profile, missing LLM
 * credentials) it throws — the channel adapter surfaces that as an
 * error reply. Friendly first-time-link UX lives upstream of this
 * helper.
 */
// `RequestContext<any>` matches the loose typing in `withUserContext`
// (`src/mastra/lib/user-context.ts`) — agents extend
// `userContextSchema` with their own keys, so this helper plugs into
// any of them without forcing a generic at the call site.
export async function loadChannelContextOnto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rc: RequestContext<any>,
): Promise<void> {
  // Idempotent: if applyUserContext already ran for this request, bail.
  if (rc.get('userId')) return;

  const channel = rc.get('channel') as
    | { platform: string; userId: string }
    | undefined;
  if (!channel?.userId) {
    throw new AppNotConfiguredError(
      'channel context (no `channel` key on request)',
    );
  }

  // The channel registry is the source of truth for which platforms
  // exist. Any descriptor with a `user_channel_bindings` row is
  // serviceable — there's no per-platform special case here anymore.
  const supabase = createServiceClient();

  const { data: binding, error: bindingError } = await supabase
    .from('user_channel_bindings')
    .select('user_id')
    .eq('channel_id', channel.platform)
    .eq('external_id', channel.userId)
    .maybeSingle();

  if (bindingError) {
    throw new Error(
      `loadChannelContextOnto: binding lookup failed: ${bindingError.message}`,
    );
  }
  if (!binding?.user_id) {
    throw new AppNotConfiguredError(
      `${channel.platform} user ${channel.userId} is not bound to any account`,
    );
  }

  const userId = binding.user_id as string;

  // Pull role from auth.users so the synthetic CurrentUser carries
  // the right value. service-role bypasses RLS.
  const { data: authUser, error: authError } =
    await supabase.auth.admin.getUserById(userId);
  if (authError || !authUser?.user) {
    throw new Error(
      `loadChannelContextOnto: auth lookup failed: ${authError?.message ?? 'no user'}`,
    );
  }
  const role: CurrentUser['role'] =
    (authUser.user.app_metadata as { role?: string } | undefined)?.role ===
    'admin'
      ? 'admin'
      : 'user';

  const profile = await loadProfileAsService(supabase, userId);
  if (!profile) {
    throw new AppNotConfiguredError(`no user_profiles row for ${userId}`);
  }

  // Same lookup the web chat route uses — `loadLlmCredentials()` walks
  // Tier 1 (`app_settings`) over Tier 0 defaults and reads the API key
  // from Vault. Service-role connection because channel requests carry
  // no JWT.
  const credentials = await loadLlmCredentials(supabase);

  applyUserContext(rc, {
    user: {
      userId,
      email: authUser.user.email ?? '',
      role,
    },
    profile,
    llm: {
      provider: credentials.provider,
      apiKey: credentials.apiKey,
      modelId: credentials.defaultModel,
      baseUrl: credentials.baseUrl,
    },
    // Don't override threadId — the channel layer manages its own
    // thread mapping (one Mastra thread per Telegram chat).
  });
}
