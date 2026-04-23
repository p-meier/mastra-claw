import 'server-only';

import type { LanguageModelV3 } from '@ai-sdk/provider-v6';
import type { Agent } from '@mastra/core/agent';
import type { StorageThreadType } from '@mastra/core/memory';
import type { UIMessage } from 'ai';

import type { CurrentUser } from '@/lib/auth';
import { channelSecrets } from '@/lib/channels/secrets';
import { loadProfile, type UserProfile } from '@/lib/onboarding/profile';
import { providerSecrets } from '@/lib/providers/secrets';
import { createClient } from '@/lib/supabase/server';
import { resolveSettings, type ResolvedSettings } from '@/lib/settings/resolve';

import {
  getAgentForUser,
  listAgentThreadsForUser,
  listAgentsForUser,
  loadThreadMessagesForUser,
} from './agents-service';
import { loadLlmCredentials, type LlmCredentials } from './llm-credentials';
import { resolveLanguageModel } from './resolve-language-model';
import { appSecrets, userSecrets } from './secret-service';

/**
 * Role-aware Mastra facade. Application code MUST go through this factory
 * instead of reaching for the raw Mastra instance — see CLAUDE.md
 * "Multi-tenancy & roles". The process-wide singleton is reserved for
 * `src/mastra/singleton.ts` and this file.
 *
 * Phase 1 surface (minimal — just enough to wire the onboarding wizards
 * and the chat route handler). Will grow as more user-facing features
 * land:
 *
 *     mastraFor(user).secrets         user-scoped Vault namespace
 *     mastraFor(user).appSecrets      admin-only Vault namespace
 *     mastraFor(user).profile()       loadProfile(user.userId)
 *     mastraFor(user).settings()      resolveSettings()
 *     mastraFor(user).getLlmCredentials()
 *     mastraFor(user).getImageVideoCredentials()
 *     mastraFor(user).getElevenlabs()
 *     mastraFor(user).agents          per-user agent enumeration
 *
 * The full editor facade (agents/prompts/skills/mcp/scorers CRUD with
 * authorId scoping) lands in a follow-up task once the wizards exist.
 */

// ---------------------------------------------------------------------------
// Re-exports — keep call sites pointing at this file
// ---------------------------------------------------------------------------

export { AppNotConfiguredError } from './llm-credentials';
export type { LlmCredentials } from './llm-credentials';
export type { TextProviderId as LlmProvider } from '@/lib/providers/text';

// ---------------------------------------------------------------------------
// Resolved-credential return types
// ---------------------------------------------------------------------------

export type ImageVideoCredentials = {
  provider: string;
  apiKey: string;
};

export type ElevenlabsCredentials = {
  apiKey: string;
  voiceId: string;
  ttsModelId: string;
  sttModelId: string;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function mastraFor(currentUser: CurrentUser) {
  const userId = currentUser.userId;

  /**
   * Resolve the active text-LLM credentials for this request.
   *
   * Routes through the shared `loadLlmCredentials()` helper so the
   * Telegram channel processor and any other headless entry point uses
   * the same lookup chain (Tier 1 `app_settings` → Tier 0 defaults → Vault
   * API key). Throws `AppNotConfiguredError` when the API key is missing
   * — call sites should catch and either redirect to the admin setup
   * wizard or show an inline error.
   */
  const getLlmCredentials = async (): Promise<LlmCredentials> => {
    const supabase = await createClient();
    return loadLlmCredentials(supabase);
  };

  return {
    /** Per-user Vault namespace (Layer C). */
    secrets: userSecrets,

    /**
     * App-level Vault namespace (Layer B). Calls fail at the database if
     * the current user is not admin — but every call site should also do
     * an explicit `requireAdmin()` first per CLAUDE.md (defense in depth).
     */
    appSecrets,

    /** Load this user's profile row (cached per request via react.cache). */
    profile: (): Promise<UserProfile | null> => loadProfile(userId),

    /** Resolved app-level settings (Tier 1 over Tier 0 defaults, cached). */
    settings: (): Promise<ResolvedSettings> => resolveSettings(),

    getLlmCredentials,

    /**
     * Resolve a fully-instantiated `LanguageModelV3` for this request.
     *
     * This is the **only** sanctioned way to obtain a Vercel AI SDK model
     * inside MastraClaw. It chains `getLlmCredentials()` → the central
     * `resolveLanguageModel()` factory, which uses per-call provider
     * factories (`createAnthropic({ apiKey })` etc.) so nothing ever
     * mutates `process.env`. Concurrent requests with different per-user
     * keys are isolated by construction.
     *
     * Throws `AppNotConfiguredError` (mapped to HTTP 503 by the API
     * boundary helper) if the admin setup wizard hasn't run yet.
     */
    getLanguageModel: async (): Promise<LanguageModelV3> => {
      const creds = await getLlmCredentials();
      return resolveLanguageModel({
        provider: creds.provider,
        apiKey: creds.apiKey,
        modelId: creds.defaultModel,
        baseUrl: creds.baseUrl,
      });
    },

    /**
     * Resolve image/video credentials for the active provider in that
     * category. Returns `null` if the admin hasn't configured an
     * image/video provider yet.
     */
    getImageVideoCredentials: async (): Promise<ImageVideoCredentials | null> => {
      const settings = await resolveSettings();
      const active = settings.providers.imageVideo.active;
      if (!active) return null;
      const apiKey = await providerSecrets.get(
        'image-video',
        active.id,
        'apiKey',
      );
      if (!apiKey) return null;
      return { provider: active.id, apiKey };
    },

    /**
     * Resolve ElevenLabs credentials. After the voice consolidation
     * ElevenLabs is one of (potentially several) combined TTS+STT
     * providers in `providers.voice`. We hand back the credentials
     * only when the active voice provider is in fact `elevenlabs` —
     * call sites that need a specific implementation should switch
     * on the active id themselves.
     */
    getElevenlabs: async (): Promise<ElevenlabsCredentials | null> => {
      const settings = await resolveSettings();
      const active = settings.providers.voice.active;
      if (!active || active.id !== 'elevenlabs') return null;
      const apiKey = await providerSecrets.get('voice', 'elevenlabs', 'apiKey');
      if (!apiKey) return null;
      return {
        apiKey,
        voiceId: String(active.config.voiceId ?? ''),
        ttsModelId: String(active.config.ttsModelId ?? ''),
        sttModelId: String(active.config.sttModelId ?? ''),
      };
    },

    /**
     * Resolve the company-wide Composio API key. Returns null if not
     * configured. Per-user OAuth connections happen via Composio Connect
     * Links at chat time — they don't go through this surface.
     *
     * Composio still uses the legacy single-secret name; it has not yet
     * been ported into the provider/channel registry pattern.
     */
    getComposioApiKey: async (): Promise<string | null> => {
      const settings = await resolveSettings();
      if (!settings.composio.configured) return null;
      return appSecrets.get('composio_api_key');
    },

    /**
     * Resolve the Telegram bot token. Returns null when the Telegram
     * channel hasn't been configured yet.
     */
    getTelegramBotToken: async (): Promise<string | null> => {
      const settings = await resolveSettings();
      if (!settings.channels.telegram?.configured) return null;
      return channelSecrets.get('telegram', 'botToken');
    },

    /**
     * Per-user agent enumeration. Phase 1 ships only code-defined agents
     * — every authenticated user sees the same registry. When stored
     * agents land later, this namespace gains `authorId` filtering for
     * the user facade and admins keep the unfiltered view.
     *
     * Returns `Agent` instances from `@mastra/core/agent` — the same
     * type Mastra itself uses. The route handlers extract just the
     * fields they need to JSON-serialize.
     */
    agents: {
      list: (): Promise<Agent[]> => listAgentsForUser(currentUser),
      get: (agentId: string): Promise<Agent | null> =>
        getAgentForUser(currentUser, agentId),
      listThreads: (agentId: string): Promise<StorageThreadType[]> =>
        listAgentThreadsForUser(currentUser, agentId),
      loadThreadMessages: (
        agentId: string,
        threadId: string,
      ): Promise<UIMessage[] | null> =>
        loadThreadMessagesForUser(currentUser, agentId, threadId),
    },

  } as const;
}

export type MastraForFacade = ReturnType<typeof mastraFor>;
