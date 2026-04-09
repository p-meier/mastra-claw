import 'server-only';

/**
 * Tier 0 — code defaults for every non-secret deployment setting.
 *
 * The single source of truth for settings that ship as part of the
 * codebase and don't belong in env vars. The lookup order at runtime
 * is **per-user override → app_settings (admin UI) → these defaults**;
 * see `src/lib/settings/resolve.ts`.
 *
 * Rule: a setting lives here if it is **not** a secret and **not**
 * needed before Postgres is reachable. Bootstrap secrets (Supabase URL,
 * service role key, S3 endpoint, …) stay in `src/lib/env.ts`. Per-user
 * secrets stay in Vault. Everything else lives here so a fresh `git
 * clone` can bring up the dev server with zero env knobs beyond the
 * Supabase ones, and so an admin can override any of these from the UI
 * without redeploying.
 *
 * Adding a new setting? Three places to touch:
 *   1. Add the default value here.
 *   2. Add the key + Zod shape to `settingValueSchema` in
 *      `src/lib/settings/resolve.ts`.
 *   3. Wire it into the resolved object in the same file.
 */
export const DEFAULTS = {
  llm: {
    /**
     * Provider used until the admin runs the setup wizard. The matching
     * API key still needs to be in Vault before chat works — this is
     * just the wizard's pre-selection.
     */
    provider: 'anthropic' as const,
    defaultTextModel: 'anthropic/claude-sonnet-4-5',
    customBaseUrl: null as string | null,
  },
  imageVideo: {
    provider: null as 'vercel-gateway' | null,
    baseUrl: null as string | null,
  },
  elevenlabs: {
    /**
     * SHIFT/MastraClaw default voice. Override per deployment via the
     * admin settings page.
     */
    voiceId: 'rKiu7lQ4c5P3az3745s3',
    modelId: 'eleven_v3',
  },
  telegram: {
    pollingIntervalMs: 1000,
  },
} as const;
