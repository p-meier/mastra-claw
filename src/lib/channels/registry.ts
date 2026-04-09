import 'server-only';

import type { Descriptor } from '@/lib/descriptors/types';

import { DISCORD_CHANNEL } from './discord';
import { GCHAT_CHANNEL } from './gchat';
import { SLACK_CHANNEL } from './slack';
import { TEAMS_CHANNEL } from './teams';
import { TELEGRAM_CHANNEL } from './telegram';

/**
 * Channel registry — every messaging platform MastraClaw can talk to.
 *
 * Adding a new channel means adding a `ChannelDescriptor` file in this
 * directory and importing it here. The admin Channels page, the user
 * bindings page, the runtime channel builder, and the OAuth callback
 * routes all read from this registry — no other code change is needed.
 */

export type ChannelCapabilities = {
  /** Bot can receive 1:1 direct messages. */
  directMessage: boolean;
  /** Bot reacts to @mentions in groups/channels. */
  mention: boolean;
  /** Channel can render audio replies (TTS) inline. */
  voice: boolean;
  /**
   * Channel needs a publicly reachable webhook URL on the MastraClaw
   * deployment. The admin Channels card displays the auto-generated
   * Mastra route so the admin can paste it into the platform's app
   * configuration.
   */
  requiresPublicWebhook: boolean;
};

export type ChannelDescriptor = Descriptor & {
  /**
   * Build the underlying Chat-SDK adapter from a fully resolved value
   * map. The runtime calls this on boot for every channel that has a
   * stored configuration. The `voice` flag tells the adapter whether
   * the agent will be wired with a TTS pipeline (the descriptor itself
   * does not need to enable any features per-channel — it's a hint for
   * adapters that gate audio handling on a flag).
   */
  buildAdapter: (
    creds: Record<string, unknown>,
    opts: { voice: boolean },
  ) => unknown;
  capabilities: ChannelCapabilities;
  /**
   * Human-readable label for the platform-specific user identifier
   * shown in the per-user bindings UI ("Telegram User ID", "Slack
   * user ID", …).
   */
  externalIdLabel: string;
  /**
   * If the descriptor uses conditional fields (`showWhen`), this names
   * the field whose value drives the visible field set. The form
   * component uses this to know which select acts as the mode switch
   * and to reset cross-mode field state when the user toggles it.
   */
  modeFieldName?: string;
};

export const CHANNELS: ChannelDescriptor[] = [
  TELEGRAM_CHANNEL,
  SLACK_CHANNEL,
  TEAMS_CHANNEL,
  GCHAT_CHANNEL,
  DISCORD_CHANNEL,
];

export function getChannel(id: string): ChannelDescriptor | undefined {
  return CHANNELS.find((c) => c.id === id);
}

export function listChannels(): ChannelDescriptor[] {
  return [...CHANNELS];
}

/** Vault namespace for channel credentials. */
export const CHANNEL_SECRET_NAMESPACE = 'channel';
