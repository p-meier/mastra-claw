'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentUser } from '@/lib/auth';
import { resolveSettings } from '@/lib/settings/resolve';
import { createClient } from '@/lib/supabase/server';

import { getChannel } from './registry';

/**
 * User-side actions for the `user_channel_bindings` table.
 *
 * Each binding maps an external platform identity (e.g. a Telegram
 * numeric user ID, a Slack U… ID) to a Mastra agent. A binding is
 * always owned by the user creating it; admins can manage anyone's
 * bindings via the admin overview (later).
 *
 * The Channel-runtime layer (`src/mastra/lib/channel-context-loader.ts`)
 * resolves an incoming message to a user via this exact table.
 */

export type ActionResult<T = Record<string, unknown>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export type UserChannelBinding = {
  id: string;
  channelId: string;
  externalId: string;
  agentId: string;
  displayName: string | null;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listMyBindingsAction(): Promise<
  ActionResult<{ bindings: UserChannelBinding[] }>
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_channel_bindings')
    .select('id, channel_id, external_id, agent_id, display_name, created_at')
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false });

  if (error) return { ok: false, error: error.message };

  const bindings: UserChannelBinding[] = (data ?? []).map((row) => ({
    id: row.id as string,
    channelId: row.channel_id as string,
    externalId: row.external_id as string,
    agentId: row.agent_id as string,
    displayName: (row.display_name as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
  return { ok: true, bindings };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createBindingAction(input: {
  channelId: string;
  externalId: string;
  agentId: string;
  displayName?: string | null;
}): Promise<ActionResult<{ binding: UserChannelBinding }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  // The channel must exist in the registry AND be admin-configured.
  const descriptor = getChannel(input.channelId);
  if (!descriptor) {
    return { ok: false, error: `Unknown channel ${input.channelId}` };
  }
  const settings = await resolveSettings();
  if (!settings.channels[input.channelId]?.configured) {
    return {
      ok: false,
      error: `${descriptor.displayName} is not configured by the admin yet.`,
    };
  }

  if (!input.externalId.trim()) {
    return { ok: false, error: `${descriptor.externalIdLabel} is required` };
  }
  if (!input.agentId.trim()) {
    return { ok: false, error: 'Agent is required' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_channel_bindings')
    .insert({
      user_id: user.userId,
      channel_id: input.channelId,
      external_id: input.externalId.trim(),
      agent_id: input.agentId.trim(),
      display_name: input.displayName ?? null,
    })
    .select('id, channel_id, external_id, agent_id, display_name, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        error: `Another account is already bound to ${descriptor.displayName} ID "${input.externalId}".`,
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath('/account/channels');
  return {
    ok: true,
    binding: {
      id: data.id as string,
      channelId: data.channel_id as string,
      externalId: data.external_id as string,
      agentId: data.agent_id as string,
      displayName: (data.display_name as string | null) ?? null,
      createdAt: data.created_at as string,
    },
  };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteBindingAction(
  bindingId: string,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('user_channel_bindings')
    .delete()
    .eq('id', bindingId)
    .eq('user_id', user.userId);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/account/channels');
  return { ok: true };
}
