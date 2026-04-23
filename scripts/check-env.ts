#!/usr/bin/env tsx
/**
 * Validate the environment against the expected MastraClaw schema.
 *
 * Reads the combined env (process.env plus whatever `.env.local` Next.js
 * has already merged in) and reports every missing or malformed value
 * in one pass, rather than failing on the first hit. Exit code 0 on
 * success, 1 on any issue.
 *
 * Usage:
 *   npm run check-env
 */

import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';

// Next.js auto-loads .env.local in the app runtime, but this script
// runs via `tsx` directly — load it explicitly.
loadDotenv({ path: '.env.local' });

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a URL'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required (server-only)'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (postgresql://…)'),
  DATABASE_SSL: z
    .union([z.literal('true'), z.literal('false'), z.literal('')])
    .optional(),
  SUPABASE_S3_ENDPOINT: z.string().url('SUPABASE_S3_ENDPOINT must be a URL'),
  SUPABASE_S3_ACCESS_KEY_ID: z
    .string()
    .min(1, 'SUPABASE_S3_ACCESS_KEY_ID is required'),
  SUPABASE_S3_SECRET_ACCESS_KEY: z
    .string()
    .min(1, 'SUPABASE_S3_SECRET_ACCESS_KEY is required'),
});

const result = schema.safeParse(process.env);

if (result.success) {
  // eslint-disable-next-line no-console
  console.log('✓ Environment looks good.');
  process.exit(0);
}

// eslint-disable-next-line no-console
console.error('✗ Environment has issues:\n');
for (const issue of result.error.issues) {
  // eslint-disable-next-line no-console
  console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
}
// eslint-disable-next-line no-console
console.error(
  '\nFix by copying .env.local.example to .env.local and filling in the values.',
);
process.exit(1);
