import 'server-only';

import { createSlackAdapter } from '@chat-adapter/slack';

import type {
  DescriptorProbeExtras,
  ProbeResult,
} from '@/lib/descriptors/types';

import type { ChannelDescriptor } from './registry';

async function probeSlackSingleWorkspace(
  botToken: string,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!botToken) return { ok: false, error: 'Bot token is empty' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${botToken}` },
        signal: ctrl.signal,
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        team?: string;
        user?: string;
        error?: string;
      };
      if (!json.ok) {
        return {
          ok: false,
          error: `Slack rejected the bot token: ${json.error ?? 'unknown error'}`,
        };
      }
      return {
        ok: true,
        note: `Connected to ${json.team ?? 'Slack workspace'} as ${json.user ?? 'bot'}`,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Slack connection failed: ${msg}` };
  }
}

export const SLACK_CHANNEL: ChannelDescriptor = {
  id: 'slack',
  displayName: 'Slack',
  blurb:
    'Slack app — single workspace bot or multi-workspace OAuth distribution. Supports DMs, mentions, threads, slash commands, and Block Kit cards.',
  modeFieldName: 'mode',
  fields: [
    {
      name: 'mode',
      label: 'Installation mode',
      type: 'select',
      required: true,
      secret: false,
      options: [
        { value: 'single-workspace', label: 'Single workspace' },
        { value: 'oauth', label: 'Multi-workspace OAuth distribution' },
      ],
      helpText:
        'Use single workspace if your bot is only ever installed in one Slack team. Use OAuth if you distribute the app to multiple teams.',
    },
    {
      name: 'signingSecret',
      label: 'Signing secret',
      type: 'password',
      required: true,
      secret: true,
      helpUrl: 'https://api.slack.com/apps',
      helpText:
        'From Basic Information → App Credentials. Required in both modes.',
    },
    // Single-workspace mode fields
    {
      name: 'botToken',
      label: 'Bot user OAuth token (xoxb-…)',
      type: 'password',
      required: true,
      secret: true,
      showWhen: { field: 'mode', equals: 'single-workspace' },
      helpText: 'From OAuth & Permissions → Install to Workspace.',
    },
    // OAuth mode fields
    {
      name: 'clientId',
      label: 'Client ID',
      type: 'text',
      required: true,
      secret: false,
      showWhen: { field: 'mode', equals: 'oauth' },
      helpText: 'From Basic Information → App Credentials.',
    },
    {
      name: 'clientSecret',
      label: 'Client secret',
      type: 'password',
      required: true,
      secret: true,
      showWhen: { field: 'mode', equals: 'oauth' },
      helpText: 'From Basic Information → App Credentials.',
    },
    {
      name: 'encryptionKey',
      label: 'Encryption key (optional)',
      type: 'password',
      required: false,
      secret: true,
      showWhen: { field: 'mode', equals: 'oauth' },
      helpText:
        'Base64-encoded 32-byte key for encrypting per-workspace bot tokens at rest. Generate with `openssl rand -base64 32`.',
    },
  ],
  probe: async (values) => {
    const mode = String(values.mode ?? 'single-workspace');
    if (!values.signingSecret) {
      return { ok: false, error: 'Signing secret is required' };
    }
    if (mode === 'oauth') {
      // Real validation only happens at the first install — surface this
      // limitation in the UI via `note` so the admin understands.
      if (!values.clientId || !values.clientSecret) {
        return {
          ok: false,
          error: 'OAuth mode requires both Client ID and Client Secret',
        };
      }
      return {
        ok: true,
        note: 'OAuth credentials look valid. The first workspace install will perform the live verification.',
      };
    }
    return probeSlackSingleWorkspace(String(values.botToken ?? ''));
  },
  capabilities: {
    directMessage: true,
    mention: true,
    voice: false,
    requiresPublicWebhook: true,
  },
  externalIdLabel: 'Slack user ID (U…)',
  buildAdapter: (creds) => {
    if (creds.mode === 'oauth') {
      return createSlackAdapter({
        clientId: String(creds.clientId),
        clientSecret: String(creds.clientSecret),
        signingSecret: String(creds.signingSecret),
        encryptionKey: creds.encryptionKey
          ? String(creds.encryptionKey)
          : undefined,
      });
    }
    return createSlackAdapter({
      botToken: String(creds.botToken),
      signingSecret: String(creds.signingSecret),
    });
  },
};
