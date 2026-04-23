import 'server-only';

import type { Agent } from '@mastra/core/agent';
import type { StorageThreadType } from '@mastra/core/memory';
import type { UIMessage } from 'ai';

import type { CurrentUser } from '@/lib/auth';
import { providerSecrets } from '@/lib/providers/secrets';
import { resolveSettings, type ResolvedSettings } from '@/lib/settings/resolve';
import { loadProfile, type UserProfile } from '@/lib/user-profile';

import {
  getAgentForUser,
  listAgentThreadsForUser,
  listAgentsForUser,
  loadThreadMessagesForUser,
} from './agents-service';
import { appSecrets, userSecrets } from './secret-service';

/**
 * Role-aware Mastra facade. Application code MUST go through this
 * factory instead of reaching for the raw Mastra instance — see
 * CLAUDE.md "Multi-tenancy & roles". The process-wide singleton is
 * reserved for `src/mastra/singleton.ts` and this file.
 *
 * Current surface:
 *
 *     mastraFor(user).secrets                        user-scoped Vault namespace
 *     mastraFor(user).appSecrets                     admin-only Vault namespace
 *     mastraFor(user).profile()                      loadProfile(user.userId)
 *     mastraFor(user).settings()                     resolveSettings()
 *     mastraFor(user).getImageVideoCredentials()
 *     mastraFor(user).getElevenlabs()
 *     mastraFor(user).agents                         per-user agent enumeration
 *
 * Text-LLM access is **not** on this facade. Agents call
 * `buildTextModel(supabase)` from `@/lib/platform-providers` directly,
 * which caches model construction for 30 s and reads the active
 * provider out of `platform_settings` — no per-request credential
 * plumbing, no `process.env` mutation.
 */

// ---------------------------------------------------------------------------
// Re-exports — keep call sites pointing at this file
// ---------------------------------------------------------------------------

export { AppNotConfiguredError } from './llm-credentials';
export type { TextProviderId as LlmProvider } from '@/lib/providers/text';

// ---------------------------------------------------------------------------
// Resolved-credential return types (non-text categories only)
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

  return {
    /** Per-user Vault namespace (Layer C). */
    secrets: userSecrets,

    /**
     * App-level Vault namespace (Layer B). Calls fail at the database
     * if the current user is not admin — but every call site should
     * also do an explicit `requireAdmin()` first per CLAUDE.md
     * (defense in depth).
     */
    appSecrets,

    /** Load this user's profile row (cached per request via react.cache). */
    profile: (): Promise<UserProfile | null> => loadProfile(userId),

    /** Resolved app-level settings (Tier 1 over Tier 0 defaults, cached). */
    settings: (): Promise<ResolvedSettings> => resolveSettings(),

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
     * Resolve ElevenLabs credentials. The voice category can carry
     * multiple TTS+STT providers; we hand back values only when the
     * active voice provider is in fact `elevenlabs` — call sites that
     * need a specific implementation should switch on the active id
     * themselves.
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
     * Per-user agent enumeration. Phase 1 ships only code-defined
     * agents — every authenticated user sees the same registry. When
     * stored agents land later, this namespace gains `authorId`
     * filtering for the user facade and admins keep the unfiltered
     * view.
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
