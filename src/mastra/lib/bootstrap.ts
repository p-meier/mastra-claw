import postgres from 'postgres';

import { env } from '@/lib/env';

/**
 * Verifies that Supabase is reachable and the bootstrap migration has been
 * applied. Runs once per server process (idempotent via the module-level
 * `checked` flag) and fails loud with an actionable error message.
 *
 * Intentionally does NOT check for the `mastra_*` tables — those are created
 * automatically by `PostgresStore.init()` the first time Mastra handles a
 * request (see Mastra docs `reference/storage/postgresql.md`, "Initialization").
 *
 * What we DO check:
 *  1. The DB accepts a connection (`select 1`).
 *  2. The `vector` extension exists (needed by future PgVector usage).
 *  3. Our own `app_settings` table exists (proves the bootstrap migration ran).
 */

let checked = false;

export async function assertSupabaseReady(): Promise<void> {
  if (checked) return;

  const sql = postgres(env.DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    ssl: env.DATABASE_SSL ? 'require' : false,
    connection: { application_name: 'mastra-claw-bootstrap' },
  });

  try {
    await sql`select 1`;

    const vectorExt =
      await sql`select 1 from pg_extension where extname = 'vector'`;
    if (vectorExt.length === 0) {
      throw new Error(
        "pgvector extension missing — run `npx supabase db push` to apply migrations",
      );
    }

    const appSettings = await sql`
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'app_settings'
    `;
    if (appSettings.length === 0) {
      throw new Error(
        "app_settings table missing — run `npx supabase db push` to apply migrations",
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[mastra-claw] Supabase bootstrap check failed: ${msg}\n` +
        `→ Ensure Docker is running, then:\n` +
        `    npx supabase start\n` +
        `    npx supabase db push`,
    );
  } finally {
    await sql.end({ timeout: 1 });
  }

  checked = true;
}
