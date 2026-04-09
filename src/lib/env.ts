import { z } from 'zod';

/**
 * Layer A bootstrap env vars — the **only** ones MastraClaw reads at
 * process start.
 *
 * Rule: a value lives here only if it is **secret AND needed before
 * Postgres is reachable**. Everything else has a better home:
 *
 *   - Per-deployment defaults (model names, voice IDs, polling
 *     intervals, …) → `src/lib/defaults.ts` (Tier 0) with admin
 *     overrides in `app_settings` (Tier 1, see
 *     `src/lib/settings/resolve.ts`).
 *   - Per-user secrets (LLM API keys, ElevenLabs key, Telegram bot
 *     token, Composio key, …) → Supabase Vault via `SecretService`.
 *   - Per-user non-secret overrides → future `user_settings` table.
 *
 * See ARCHITECTURE.md §11 (Secrets — Two Layers) and CLAUDE.md.
 *
 * NEXT_PUBLIC_* vs server-only:
 * - The Supabase URL and the `sb_publishable_*` key are PUBLIC by design
 *   (Supabase issues the publishable key explicitly for client-side use, it
 *   carries no privileged access). They MUST be NEXT_PUBLIC_* so the browser
 *   client can use them.
 * - The service-role key, the database URL/password, and S3 secret keys are
 *   SECRET. They MUST NOT carry the NEXT_PUBLIC_* prefix — anything so
 *   prefixed lands in the browser bundle. CLAUDE.md enforces this.
 */

const booleanFromString = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1')
  .default(false);

const schema = z.object({
  // === Public (browser-safe) Supabase config ===
  // These are intentionally NEXT_PUBLIC_* so the browser client can read
  // them. They are not secrets — see file header.
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),

  // === Server-only Supabase secrets ===
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: booleanFromString,

  // === Optional: Supabase Storage / S3 ===
  // Becomes mandatory once the first Skill or Workspace lands and we wire
  // @mastra/s3 (or the AWS SDK).
  SUPABASE_S3_ENDPOINT: z.string().url().optional(),
  SUPABASE_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  SUPABASE_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(
    `[mastra-claw] Invalid environment variables:\n${issues}\n\n` +
      `→ Copy .env.local.example to .env.local and fill in the values.`,
  );
}

export const env = parsed.data;
export type Env = typeof env;
