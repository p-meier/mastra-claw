import 'server-only';

import { createTeamsAdapter } from '@chat-adapter/teams';

import type {
  DescriptorProbeExtras,
  ProbeResult,
} from '@/lib/descriptors/types';

import type { ChannelDescriptor } from './registry';

async function probeTeamsClientSecret(
  appId: string,
  appPassword: string,
  appTenantId: string | null,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!appId) return { ok: false, error: 'App ID is required' };
  if (!appPassword) return { ok: false, error: 'App password is required' };
  const tenant = appTenantId && appTenantId.length > 0 ? appTenantId : 'common';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: appId,
        client_secret: appPassword,
        scope: 'https://api.botframework.com/.default',
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: ctrl.signal,
      });
      const json = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        error_description?: string;
      };
      if (!res.ok || !json.access_token) {
        return {
          ok: false,
          error:
            json.error_description ??
            `Microsoft identity platform returned HTTP ${res.status}`,
        };
      }
      return { ok: true, note: `Acquired bot token for tenant ${tenant}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Microsoft identity platform error: ${msg}` };
  }
}

export const TEAMS_CHANNEL: ChannelDescriptor = {
  id: 'teams',
  displayName: 'Microsoft Teams',
  blurb:
    'Azure Bot Service-backed Teams app. Supports DMs, mentions, channel posts, adaptive cards, and Microsoft Graph history.',
  modeFieldName: 'authMethod',
  fields: [
    {
      name: 'appType',
      label: 'App type',
      type: 'select',
      required: true,
      secret: false,
      options: [
        { value: 'MultiTenant', label: 'Multi-tenant' },
        { value: 'SingleTenant', label: 'Single-tenant (recommended)' },
      ],
    },
    {
      name: 'appId',
      label: 'App ID',
      type: 'text',
      required: true,
      secret: false,
      helpUrl: 'https://portal.azure.com/',
      helpText: 'From Azure Bot resource → Configuration → Microsoft App ID.',
    },
    {
      name: 'appTenantId',
      label: 'Tenant ID',
      type: 'text',
      required: false,
      secret: false,
      showWhen: { field: 'appType', equals: 'SingleTenant' },
      helpText:
        'Required for single-tenant apps. From Azure Bot resource → Overview → Directory (tenant) ID.',
    },
    {
      name: 'authMethod',
      label: 'Authentication',
      type: 'select',
      required: true,
      secret: false,
      options: [
        { value: 'clientSecret', label: 'Client secret (default)' },
        { value: 'federated', label: 'Federated (workload identity)' },
      ],
    },
    {
      name: 'appPassword',
      label: 'App password',
      type: 'password',
      required: true,
      secret: true,
      showWhen: { field: 'authMethod', equals: 'clientSecret' },
      helpText:
        'From the App Registration → Certificates & secrets. Copy the value immediately — Azure shows it only once.',
    },
    {
      name: 'federatedClientId',
      label: 'Managed identity client ID',
      type: 'text',
      required: true,
      secret: false,
      showWhen: { field: 'authMethod', equals: 'federated' },
      helpText:
        'For environments with workload identities (e.g. Azure Kubernetes Service). The Bot Framework SDK exchanges this for tokens.',
    },
  ],
  probe: async (values) => {
    const authMethod = String(values.authMethod ?? 'clientSecret');
    const appType = String(values.appType ?? 'MultiTenant');
    if (!values.appId) {
      return { ok: false, error: 'App ID is required' };
    }
    if (appType === 'SingleTenant' && !values.appTenantId) {
      return {
        ok: false,
        error: 'Tenant ID is required for single-tenant apps',
      };
    }
    if (authMethod === 'federated') {
      if (!values.federatedClientId) {
        return {
          ok: false,
          error: 'Federated mode requires the managed identity client ID',
        };
      }
      return {
        ok: true,
        note: 'Federated credentials cannot be verified outside the Azure runtime — they will be checked when the first request hits the bot.',
      };
    }
    return probeTeamsClientSecret(
      String(values.appId),
      String(values.appPassword ?? ''),
      values.appTenantId ? String(values.appTenantId) : null,
    );
  },
  capabilities: {
    directMessage: true,
    mention: true,
    voice: false,
    requiresPublicWebhook: true,
  },
  externalIdLabel: 'Teams AAD object ID',
  buildAdapter: (creds) => {
    const appType =
      creds.appType === 'SingleTenant' ? 'SingleTenant' : 'MultiTenant';
    if (creds.authMethod === 'federated') {
      return createTeamsAdapter({
        appId: String(creds.appId),
        appType,
        appTenantId: creds.appTenantId
          ? String(creds.appTenantId)
          : undefined,
        federated: {
          clientId: String(creds.federatedClientId),
        },
      });
    }
    return createTeamsAdapter({
      appId: String(creds.appId),
      appType,
      appTenantId: creds.appTenantId ? String(creds.appTenantId) : undefined,
      appPassword: String(creds.appPassword),
    });
  },
};
