import 'server-only';

import type { CurrentUser } from '@/lib/auth';
import { loadAppConfig, loadProfile, type AppConfig, type UserProfile } from '@/lib/onboarding/profile';
import { env } from '@/lib/env';

import { mastra } from '@/mastra';
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
 *     mastraFor(user).appConfig()     loadAppConfig()
 *     mastraFor(user).getLlmCredentials()
 *     mastraFor(user).getImageVideoCredentials()
 *     mastraFor(user).getElevenlabs()
 *     mastraFor(user).raw             escape hatch — pass-through to mastra
 *
 * The full editor facade (agents/prompts/skills/mcp/scorers CRUD with
 * authorId scoping) lands in a follow-up task once the wizards exist.
 */

// ---------------------------------------------------------------------------
// Resolved-credential return types
// ---------------------------------------------------------------------------

export type LlmProvider =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'vercel-gateway'
  | 'custom';

export type LlmCredentials = {
  provider: LlmProvider;
  apiKey: string;
  defaultModel: string;
  baseUrl: string | null;
};

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
// Custom error types
// ---------------------------------------------------------------------------

export class AppNotConfiguredError extends Error {
  constructor(what: string) {
    super(`MastraClaw is not yet configured: ${what} missing`);
    this.name = 'AppNotConfiguredError';
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function mastraFor(currentUser: CurrentUser) {
  const userId = currentUser.userId;

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

    /** Load the global app config row set (cached per request). */
    appConfig: (): Promise<AppConfig> => loadAppConfig(),

    /**
     * Resolve the active text-LLM credentials for this request.
     *
     * Lookup precedence:
     *   1. user-override secret (Layer C, future)            ← not yet exposed
     *   2. app-level secret (Layer B)                         ← Phase 1 default
     *
     * The provider, model, and base URL come from `app_settings` (Layer
     * B config table). Throws `AppNotConfiguredError` if any required
     * piece is missing — call sites should catch and either redirect to
     * the admin setup wizard or show an inline error.
     */
    getLlmCredentials: async (): Promise<LlmCredentials> => {
      const cfg = await loadAppConfig();
      if (!cfg.llm.provider || !cfg.llm.defaultTextModel) {
        throw new AppNotConfiguredError('LLM provider/model');
      }

      const apiKey = await appSecrets.get(APP_SECRET_NAMES.llmApiKey);
      if (!apiKey) {
        throw new AppNotConfiguredError('LLM API key');
      }

      return {
        provider: cfg.llm.provider,
        apiKey,
        defaultModel: cfg.llm.defaultTextModel,
        baseUrl: cfg.llm.customBaseUrl,
      };
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
      const cfg = await loadAppConfig();

      // Auto-share if text provider is already Vercel AI Gateway
      if (cfg.llm.provider === 'vercel-gateway') {
        const apiKey = await appSecrets.get(APP_SECRET_NAMES.llmApiKey);
        if (!apiKey) return null;
        return { provider: 'vercel-gateway', apiKey, baseUrl: cfg.imageVideo.baseUrl };
      }

      if (!cfg.imageVideo.provider) return null;
      const apiKey = await appSecrets.get(APP_SECRET_NAMES.imageVideoApiKey);
      if (!apiKey) return null;
      return {
        provider: cfg.imageVideo.provider,
        apiKey,
        baseUrl: cfg.imageVideo.baseUrl,
      };
    },

    /**
     * Resolve ElevenLabs credentials. Voice ID and model ID come from
     * env defaults but can be overridden by `app_settings` (admin-only).
     * Returns null if ElevenLabs was skipped during admin setup.
     */
    getElevenlabs: async (): Promise<ElevenlabsCredentials | null> => {
      const cfg = await loadAppConfig();
      if (!cfg.elevenlabs.configured) return null;

      const apiKey = await appSecrets.get(APP_SECRET_NAMES.elevenlabsApiKey);
      if (!apiKey) return null;

      return {
        apiKey,
        voiceId: cfg.elevenlabs.voiceIdOverride ?? env.ELEVENLABS_VOICE_ID,
        modelId: cfg.elevenlabs.modelIdOverride ?? env.ELEVENLABS_MODEL_ID,
      };
    },

    /**
     * Resolve the company-wide Composio API key. Returns null if not
     * configured. Per-user OAuth connections happen via Composio Connect
     * Links at chat time — they don't go through this surface.
     */
    getComposioApiKey: async (): Promise<string | null> => {
      const cfg = await loadAppConfig();
      if (!cfg.composio.configured) return null;
      return appSecrets.get(APP_SECRET_NAMES.composioApiKey);
    },

    /**
     * Resolve the Telegram bot token. Returns null if Telegram was
     * skipped during admin setup.
     */
    getTelegramBotToken: async (): Promise<string | null> => {
      const cfg = await loadAppConfig();
      if (!cfg.telegram.configured) return null;
      return appSecrets.get(APP_SECRET_NAMES.telegramBotToken);
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
