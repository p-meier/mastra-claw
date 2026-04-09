import 'server-only';

import { createDiscordAdapter } from '@chat-adapter/discord';

import type {
  DescriptorProbeExtras,
  ProbeResult,
} from '@/lib/descriptors/types';

import type { ChannelDescriptor } from './registry';

async function probeDiscord(
  botToken: string,
  applicationId: string,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!botToken) return { ok: false, error: 'Bot token is empty' };
  if (!applicationId) {
    return { ok: false, error: 'Application ID is required' };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(
        'https://discord.com/api/v10/applications/@me',
        {
          method: 'GET',
          headers: { Authorization: `Bot ${botToken}` },
          signal: ctrl.signal,
        },
      );
      if (!res.ok) {
        return {
          ok: false,
          error: `Discord returned HTTP ${res.status}`,
        };
      }
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        name?: string;
      };
      if (json.id !== applicationId) {
        return {
          ok: false,
          error: `Token belongs to application ${json.id ?? '<unknown>'}, not ${applicationId}`,
        };
      }
      return { ok: true, note: `Connected as ${json.name ?? 'Discord app'}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Discord connection failed: ${msg}` };
  }
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export const DISCORD_CHANNEL: ChannelDescriptor = {
  id: 'discord',
  displayName: 'Discord',
  blurb:
    'Discord application with bot user. Supports DMs, slash commands, mentions, threads, and reactions.',
  fields: [
    {
      name: 'botToken',
      label: 'Bot token',
      type: 'password',
      required: true,
      secret: true,
      helpUrl: 'https://discord.com/developers/applications',
      helpText: 'From the Bot tab in your Discord application.',
    },
    {
      name: 'publicKey',
      label: 'Public key',
      type: 'password',
      required: true,
      secret: true,
      helpText:
        'From the General Information tab. Used to verify webhook signatures.',
    },
    {
      name: 'applicationId',
      label: 'Application ID',
      type: 'text',
      required: true,
      secret: false,
      helpText: 'From the General Information tab.',
    },
    {
      name: 'mentionRoleIds',
      label: 'Mention role IDs',
      type: 'string-array',
      required: false,
      secret: false,
      placeholder: '1457473602180878604, 1457473602180878605',
      helpText:
        'Optional. Comma-separated list of role IDs whose mentions should also trigger the bot.',
    },
  ],
  probe: async (values) =>
    probeDiscord(
      String(values.botToken ?? ''),
      String(values.applicationId ?? ''),
    ),
  capabilities: {
    directMessage: true,
    mention: true,
    voice: false,
    requiresPublicWebhook: true,
  },
  externalIdLabel: 'Discord user snowflake',
  buildAdapter: (creds) =>
    createDiscordAdapter({
      botToken: String(creds.botToken),
      publicKey: String(creds.publicKey),
      applicationId: String(creds.applicationId),
      mentionRoleIds: parseStringArray(creds.mentionRoleIds),
    }),
};
