import 'server-only';

import { channelSecrets } from '@/lib/channels/secrets';
import { getChannel, listChannels } from '@/lib/channels/registry';
import { resolveSettingsAsService } from '@/lib/settings/resolve';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Build the `channels.adapters` object for an agent at boot time.
 *
 * Walks the resolved settings, finds every channel that has a stored
 * configuration, hydrates its non-secret config + Vault-stored secret
 * fields, and calls the descriptor's `buildAdapter()` factory. The
 * resulting map is dropped straight into the Agent constructor's
 * `channels.adapters` slot.
 *
 * Today every agent gets every configured channel — there is no
 * per-(agent, channel) selection in `app_settings`, only the global
 * "is this channel configured" flag. The user-side
 * `user_channel_bindings` table determines *which user* a channel
 * message routes to, but at the framework level a channel is either
 * on or off for all agents that opt in.
 *
 * The `voice` flag passed to each `buildAdapter` reflects the channel's
 * own `voiceEnabled` toggle and is true only when a TTS provider is
 * also active — channels cannot enable voice without a backing
 * speech-synthesis stack.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildAgentChannels(): Promise<Record<string, any>> {
  const supabase = createServiceClient();
  const settings = await resolveSettingsAsService(supabase);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapters: Record<string, any> = {};

  const voiceActive = settings.providers.voice.active !== null;

  for (const channel of listChannels()) {
    const channelState = settings.channels[channel.id];
    if (!channelState?.configured) continue;

    // Hydrate every secret field this descriptor declares.
    const credentials: Record<string, unknown> = { ...channelState.config };
    for (const field of channel.fields) {
      if (!field.secret) continue;
      const value = await channelSecrets.get(channel.id, field.name);
      if (value) credentials[field.name] = value;
    }

    // A channel can request voice but the runtime can only honor it
    // when a voice provider (TTS + STT) is currently active. Voice
    // without it would crash the channel adapter on the first audio
    // exchange.
    const voice = channelState.config.voiceEnabled === true && voiceActive;

    try {
      adapters[channel.id] = channel.buildAdapter(credentials, { voice });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[agent-channels] failed to build ${channel.id} adapter: ${msg}`,
      );
    }
  }

  return adapters;
}

/** Convenience helper used by the `personal-assistant` constructor. */
export async function buildPersonalAssistantChannels() {
  const adapters = await buildAgentChannels();
  if (Object.keys(adapters).length === 0) return undefined;
  return { adapters };
}

/**
 * For diagnostics / future hot-reload: tells you which channels would
 * be built if `buildAgentChannels()` ran right now, without actually
 * instantiating any adapters or touching Vault.
 */
export async function listConfiguredChannelIds(): Promise<string[]> {
  const supabase = createServiceClient();
  const settings = await resolveSettingsAsService(supabase);
  return Object.entries(settings.channels)
    .filter(([id, state]) => state.configured && getChannel(id))
    .map(([id]) => id);
}
