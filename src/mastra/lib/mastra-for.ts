import 'server-only';

import type { LanguageModelV3 } from '@ai-sdk/provider-v6';
import type { Agent } from '@mastra/core/agent';
import type { StorageThreadType } from '@mastra/core/memory';
import type { UIMessage } from 'ai';

import type { CurrentUser } from '@/lib/auth';
import { loadProfile, type UserProfile } from '@/lib/onboarding/profile';
import { createClient } from '@/lib/supabase/server';
import { resolveSettings, type ResolvedSettings } from '@/lib/settings/resolve';

import { mastra } from '@/mastra';
import {
  getAgentForUser,
  listAgentThreadsForUser,
  listAgentsForUser,
  loadThreadMessagesForUser,
} from './agents-service';
import { loadLlmCredentials, type LlmCredentials } from './llm-credentials';
import { resolveLanguageModel } from './resolve-language-model';
import { appSecrets, userSecrets, APP_SECRET_NAMES } from './secret-service';

/**
 * Role-aware Mastra facade. Application code MUST go through this factory
 * instead of importing the raw `mastra` instance — see CLAUDE.md
 * "Multi-tenancy & roles". The raw instance is reserved for
 * `src/mastra/index.ts` and this file.
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
 *     mastraFor(user).raw             escape hatch — pass-through to mastra
 *
 * The full editor facade (agents/prompts/skills/mcp/scorers CRUD with
 * authorId scoping) lands in a follow-up task once the wizards exist.
 */

// ---------------------------------------------------------------------------
// Re-exports — keep call sites pointing at this file
// ---------------------------------------------------------------------------

export { AppNotConfiguredError } from './llm-credentials';
export type { LlmCredentials } from './llm-credentials';
export type { LlmProvider } from '@/lib/settings/resolve';

// ---------------------------------------------------------------------------
// Resolved-credential return types
// ---------------------------------------------------------------------------

export type ImageVideoCredentials = {
  provider: 'vercel-gateway';
  apiKey: string;
  baseUrl: string | null;
};

export type ElevenlabsCredentials = {
  apiKey: string;
  voiceId: string;
  modelId: string;
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
     * Resolve image/video credentials. Special-case: if the text provider
     * is already Vercel AI Gateway, the same key + gateway covers both —
     * we return the LLM key here too instead of forcing the admin to
     * enter it twice.
     *
     * Returns `null` if image/video was skipped during admin setup.
     */
    getImageVideoCredentials: async (): Promise<ImageVideoCredentials | null> => {
      const settings = await resolveSettings();

      // Auto-share if text provider is already Vercel AI Gateway
      if (settings.llm.provider === 'vercel-gateway') {
        const apiKey = await appSecrets.get(APP_SECRET_NAMES.llmApiKey);
        if (!apiKey) return null;
        return {
          provider: 'vercel-gateway',
          apiKey,
          baseUrl: settings.imageVideo.baseUrl,
        };
      }

      if (!settings.imageVideo.provider) return null;
      const apiKey = await appSecrets.get(APP_SECRET_NAMES.imageVideoApiKey);
      if (!apiKey) return null;
      return {
        provider: settings.imageVideo.provider,
        apiKey,
        baseUrl: settings.imageVideo.baseUrl,
      };
    },

    /**
     * Resolve ElevenLabs credentials. Voice ID and model ID come from
     * Tier 0 defaults (`src/lib/defaults.ts`) and can be overridden via
     * `app_settings` from /admin/settings — both layers go through
     * `resolveSettings()`, no env vars involved. Returns null if
     * ElevenLabs was skipped during admin setup.
     */
    getElevenlabs: async (): Promise<ElevenlabsCredentials | null> => {
      const settings = await resolveSettings();
      if (!settings.elevenlabs.configured) return null;

      const apiKey = await appSecrets.get(APP_SECRET_NAMES.elevenlabsApiKey);
      if (!apiKey) return null;

      return {
        apiKey,
        voiceId: settings.elevenlabs.voiceId,
        modelId: settings.elevenlabs.modelId,
      };
    },

    /**
     * Resolve the company-wide Composio API key. Returns null if not
     * configured. Per-user OAuth connections happen via Composio Connect
     * Links at chat time — they don't go through this surface.
     */
    getComposioApiKey: async (): Promise<string | null> => {
      const settings = await resolveSettings();
      if (!settings.composio.configured) return null;
      return appSecrets.get(APP_SECRET_NAMES.composioApiKey);
    },

    /**
     * Resolve the Telegram bot token. Returns null if Telegram was
     * skipped during admin setup.
     */
    getTelegramBotToken: async (): Promise<string | null> => {
      const settings = await resolveSettings();
      if (!settings.telegram.configured) return null;
      return appSecrets.get(APP_SECRET_NAMES.telegramBotToken);
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

    /**
     * Escape hatch — direct access to the raw Mastra instance. Use only
     * when calling read-only methods that don't need authorId scoping
     * (e.g. `mastra.getAgentById('personal-assistant')`). Anything that
     * mutates state should add a typed wrapper here instead.
     */
    raw: mastra,
  } as const;
}

export type MastraForFacade = ReturnType<typeof mastraFor>;
