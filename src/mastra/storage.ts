import { PostgresStore } from '@mastra/pg';

import { env } from '@/lib/env';

/**
 * Singleton PostgresStore for Mastra.
 *
 * Next.js Hot Module Replacement re-imports modules on every change. Without
 * this `globalThis` cache we would create a fresh `pg.Pool` on every reload
 * and Postgres would log:
 *
 *   WARNING: Creating a duplicate database object for the same connection.
 *
 * The pattern below is taken 1:1 from the Mastra docs:
 * `reference/storage/postgresql.md` → "Using with Next.js".
 */

declare global {
  // eslint-disable-next-line no-var
  var __mastraPgStore: PostgresStore | undefined;
}

function build(): PostgresStore {
  return new PostgresStore({
    id: 'mastra-storage',
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
  });
}

export const storage: PostgresStore =
  globalThis.__mastraPgStore ?? (globalThis.__mastraPgStore = build());
