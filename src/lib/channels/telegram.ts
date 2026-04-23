import 'server-only';

import { createTelegramAdapter } from '@chat-adapter/telegram';

import type {
  DescriptorProbeExtras,
  ProbeResult,
} from '@/lib/descriptors/types';

import type { ChannelDescriptor } from './registry';

async function probeTelegram(
  botToken: string,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!botToken) return { ok: false, error: 'Bot token is empty' };
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    return {
      ok: false,
      error: 'Token format looks wrong. Expected: 123456789:ABC-DEF1234ghIkl…',
    };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${botToken}/getMe`,
        { method: 'GET', signal: ctrl.signal },
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        result?: { username?: string };
        description?: string;
      };
      if (!res.ok || !json.ok || !json.result?.username) {
        return {
          ok: false,
          error: json.description ?? `Telegram returned HTTP ${res.status}`,
        };
      }
      return { ok: true, note: `Connected as @${json.result.username}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Telegram connection failed: ${msg}` };
  }
}

export const TELEGRAM_CHANNEL: ChannelDescriptor = {
  id: 'telegram',
  displayName: 'Telegram',
  blurb:
    'Long-polling Telegram bot. Reaches users in DMs, groups, and channels with no public webhook required.',
  fields: [
    {
      name: 'botToken',
      label: 'Bot token',
      type: 'password',
      required: true,
      secret: true,
      helpUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
      helpText: 'Talk to @BotFather to create a bot and copy its token.',
    },
    {
      name: 'pollingIntervalMs',
      label: 'Polling interval (ms)',
      type: 'number',
      required: false,
      secret: false,
      placeholder: '1000',
      helpText:
        'How often the server polls Telegram for new updates. 1000 ms is a good default.',
    },
  ],
  probe: async (values) => probeTelegram(String(values.botToken ?? '')),
  capabilities: {
    directMessage: true,
    mention: true,
    voice: true,
    requiresPublicWebhook: false,
  },
  externalIdLabel: 'Telegram User ID (numeric)',
  externalIdHelp: {
    text:
      'Open Telegram and start a chat with @userinfobot — it replies with your numeric user ID. Paste that number here (just digits, no @username).',
    url: 'https://t.me/userinfobot',
  },
  buildAdapter: (creds) =>
    createTelegramAdapter({
      botToken: String(creds.botToken),
      mode: 'polling',
    }),
};
