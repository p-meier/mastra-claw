import 'server-only';

import { createGoogleChatAdapter } from '@chat-adapter/gchat';

import type {
  DescriptorProbeExtras,
  ProbeResult,
} from '@/lib/descriptors/types';

import type { ChannelDescriptor } from './registry';

type ServiceAccountJson = {
  type?: string;
  project_id?: string;
  private_key?: string;
  client_email?: string;
};

function probeGoogleChatCredentials(
  rawCredentials: string,
): ProbeResult<DescriptorProbeExtras> {
  if (!rawCredentials) {
    return { ok: false, error: 'Service account credentials are empty' };
  }
  let parsed: ServiceAccountJson;
  try {
    parsed = JSON.parse(rawCredentials) as ServiceAccountJson;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Invalid JSON: ${msg}` };
  }
  if (parsed.type !== 'service_account') {
    return {
      ok: false,
      error: `Expected type "service_account", got "${parsed.type ?? 'unknown'}"`,
    };
  }
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    return {
      ok: false,
      error: 'Service account JSON is missing client_email, private_key, or project_id',
    };
  }
  return {
    ok: true,
    note: `Service account ${parsed.client_email} for project ${parsed.project_id}. Webhook reachability cannot be verified locally.`,
  };
}

export const GCHAT_CHANNEL: ChannelDescriptor = {
  id: 'gchat',
  displayName: 'Google Chat',
  blurb:
    'Google Workspace Chat app via service-account authentication. Supports mentions, ephemeral cards, and (with Pub/Sub) all-message events.',
  fields: [
    {
      name: 'credentials',
      label: 'Service account credentials (JSON)',
      type: 'json',
      required: true,
      secret: true,
      helpUrl:
        'https://console.cloud.google.com/iam-admin/serviceaccounts',
      helpText:
        'Paste the entire service-account JSON key file generated from GCP IAM.',
    },
    {
      name: 'pubsubTopic',
      label: 'Pub/Sub topic',
      type: 'text',
      required: false,
      secret: false,
      placeholder: 'projects/your-project/topics/chat-events',
      helpText:
        'Optional. Required for receiving all messages in spaces (otherwise only @-mentions arrive).',
    },
    {
      name: 'impersonateUser',
      label: 'Impersonate user (admin email)',
      type: 'text',
      required: false,
      secret: false,
      placeholder: 'admin@yourdomain.com',
      helpText:
        'Required for domain-wide delegation features (DMs, message history, Workspace Events subscriptions).',
    },
    {
      name: 'googleChatProjectNumber',
      label: 'GCP project number',
      type: 'text',
      required: false,
      secret: false,
      helpText:
        'Optional. Used to verify the JWT signature on direct webhooks.',
    },
    {
      name: 'pubsubAudience',
      label: 'Pub/Sub audience URL',
      type: 'url',
      required: false,
      secret: false,
      placeholder: 'https://your-domain.com/api/webhooks/gchat',
      helpText:
        'Optional. Audience claim configured on the Pub/Sub push subscription for OIDC verification.',
    },
  ],
  probe: async (values) =>
    probeGoogleChatCredentials(String(values.credentials ?? '')),
  capabilities: {
    directMessage: true,
    mention: true,
    voice: false,
    requiresPublicWebhook: true,
  },
  externalIdLabel: 'Google Chat user resource name',
  buildAdapter: (creds) =>
    createGoogleChatAdapter({
      credentials: JSON.parse(String(creds.credentials)),
      pubsubTopic: creds.pubsubTopic ? String(creds.pubsubTopic) : undefined,
      impersonateUser: creds.impersonateUser
        ? String(creds.impersonateUser)
        : undefined,
      googleChatProjectNumber: creds.googleChatProjectNumber
        ? String(creds.googleChatProjectNumber)
        : undefined,
      pubsubAudience: creds.pubsubAudience
        ? String(creds.pubsubAudience)
        : undefined,
    }),
};
