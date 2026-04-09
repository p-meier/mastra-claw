import 'server-only';

/**
 * Tier 0 — code defaults.
 *
 * After the provider/channel refactor most provider and channel
 * configuration lives in `app_settings` + Vault. The values that
 * remain here are the **non-secret defaults** that pre-fill input
 * fields in the wizard / admin pages so the admin can click Save
 * without having to look anything up. Each provider/channel
 * descriptor pulls from this file via its `defaultValue` field
 * declarations — we never hardcode those literals at the descriptor
 * site.
 *
 * Adding a new default? Put the value here, then reference it from
 * the matching descriptor's `defaultValue`. That way a deployment
 * fork can override "the SHIFT default voice" by editing exactly one
 * file.
 */
export const DEFAULTS = {
  telegram: {
    pollingIntervalMs: 1000,
  },
  elevenlabs: {
    /**
     * SHIFT/MastraClaw default voice. Used as the pre-filled value in
     * the Voice provider form so the admin can save without having to
     * look up a voice id.
     */
    voiceId: 'rKiu7lQ4c5P3az3745s3',
    /** Default Text-to-Speech model. */
    ttsModelId: 'eleven_v3',
    /** Default Speech-to-Text model (ElevenLabs Scribe v2). */
    sttModelId: 'scribe_v2',
  },
} as const;
