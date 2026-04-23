#!/usr/bin/env tsx
/**
 * Apply every SQL file in `supabase/migrations/` in filename order
 * against `DATABASE_URL`. Each file is executed as one unsafe batch
 * (Supabase's pooler in transaction mode + the `postgres` client
 * require `prepare: false`; wrapping every file in an outer BEGIN
 * would collide with any `begin;` blocks inside the files).
 *
 * Idempotent at the file level — `CREATE … IF NOT EXISTS`, `INSERT …
 * ON CONFLICT DO NOTHING`, `DROP … IF EXISTS` are the conventions. A
 * file that's already been applied re-runs cleanly.
 *
 * Usage:
 *   npm run apply-migrations
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import postgres from 'postgres';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error('✗ DATABASE_URL is not set. Run `npm run check-env` first.');
  process.exit(1);
}

const MIGRATION_DIR = path.resolve('supabase/migrations');

async function main() {
  const files = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // filename prefix is the ISO-ish timestamp

  if (files.length === 0) {
    // eslint-disable-next-line no-console
    console.error(`✗ No .sql files found in ${MIGRATION_DIR}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`→ Applying ${files.length} migration(s) to ${redactUrl(DATABASE_URL!)} …`);

  const sql = postgres(DATABASE_URL!, {
    ssl: 'require',
    max: 1,
    prepare: false,
    connection: { application_name: 'mastra-claw-apply-migrations' },
  });

  try {
    for (const file of files) {
      const start = Date.now();
      process.stdout.write(`   ${file} … `);
      const body = readFileSync(path.join(MIGRATION_DIR, file), 'utf-8');
      try {
        await sql.unsafe(body);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`\n✗ ${file} failed: ${msg}`);
        process.exit(1);
      }
      const ms = Date.now() - start;
      // eslint-disable-next-line no-console
      console.log(`✓ (${ms} ms)`);
    }
  } finally {
    await sql.end({ timeout: 2 });
  }

  // eslint-disable-next-line no-console
  console.log('✓ All migrations applied.');
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '****';
    return u.toString();
  } catch {
    return '(unparseable URL)';
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('✗', err instanceof Error ? err.message : err);
  process.exit(1);
});
