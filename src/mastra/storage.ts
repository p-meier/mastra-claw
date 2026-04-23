import { PgVector, PostgresStore } from '@mastra/pg';

import { env } from '@/lib/env';

/**
 * Singleton PostgresStore + PgVector for Mastra.
 *
 * Both talk to the same Supabase Postgres; sharing one pool per
 * process keeps connection counts low as more agents land. The Mastra
 * singleton and every agent's Memory instance share the same
 * PostgresStore via `buildMemoryStorage()` — ID `'mastra-storage'`
 * matches Mastra's own expectations for Studio.
 *
 * Next.js HMR re-imports modules on every change. Without the
 * `globalThis` cache we would create a fresh `pg.Pool` on every reload
 * and Postgres would log:
 *
 *   WARNING: Creating a duplicate database object for the same connection.
 *
 * The `globalThis` pattern matches Mastra's reference doc
 * (`reference/storage/postgresql.md` → "Using with Next.js").
 */

declare global {
  // eslint-disable-next-line no-var
  var __mastraPgStore: PostgresStore | undefined;
  // eslint-disable-next-line no-var
  var __mastraPgVector: PgVector | undefined;
}

export function buildMemoryStorage(): PostgresStore {
  if (globalThis.__mastraPgStore) return globalThis.__mastraPgStore;
  globalThis.__mastraPgStore = new PostgresStore({
    id: 'mastra-storage',
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  });
  return globalThis.__mastraPgStore;
}

export function buildVectorStorage(): PgVector {
  if (globalThis.__mastraPgVector) return globalThis.__mastraPgVector;
  globalThis.__mastraPgVector = new PgVector({
    id: 'mastra-vector',
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  });
  return globalThis.__mastraPgVector;
}

/**
 * Backwards-compatible default export for code that still reaches for
 * the memory storage by name. New code should call
 * `buildMemoryStorage()` directly so there's a single factory surface
 * for both tiers (memory + vector).
 */
export const storage: PostgresStore = buildMemoryStorage();
