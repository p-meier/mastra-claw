#!/usr/bin/env tsx
/**
 * Ensure a Supabase user exists and carries the requested role.
 *
 * If the user is missing: creates them with `email_confirm: true`
 * (they skip the confirmation email) and either the `--password` you
 * pass in or a strong random one that's printed once.
 *
 * If the user exists: leaves the password alone, just updates
 * `app_metadata.role`. Role lives in `app_metadata`
 * (server-controlled) — the user cannot edit it from the client.
 *
 * Usage:
 *   npm run promote-admin -- <email>
 *   npm run promote-admin -- <email> --role admin
 *   npm run promote-admin -- <email> --role user
 *   npm run promote-admin -- <email> --password <password>
 */

import { randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.local' });

type Role = 'admin' | 'user';

type Flags = {
  email: string;
  role: Role;
  password: string | null;
};

function parseArgs(argv: string[]): Flags {
  const rest = argv.slice(2);
  let email: string | undefined;
  let role: Role = 'admin';
  let password: string | null = null;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--role') {
      const next = rest[++i];
      if (next !== 'admin' && next !== 'user') {
        fail(`--role must be 'admin' or 'user' (got '${next}')`);
      }
      role = next;
    } else if (arg === '--password') {
      const next = rest[++i];
      if (!next) fail('--password requires a value');
      password = next;
    } else if (!email) {
      email = arg;
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }

  if (!email)
    fail(
      'Email is required.\n' +
        '  Usage: promote-admin <email> [--role admin|user] [--password <pw>]',
    );
  return { email, role, password };
}

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`✗ ${message}`);
  process.exit(1);
}

function randomPassword(): string {
  // 18 bytes of base64url = 24 chars, safely > 128 bits of entropy.
  return randomBytes(18).toString('base64url');
}

async function main() {
  const { email, role, password: requestedPassword } = parseArgs(process.argv);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) fail('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!serviceKey) fail('SUPABASE_SERVICE_ROLE_KEY is not set');

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Look up the user by email. `listUsers` is paginated at 1000 —
  // fine for every realistic mastra-claw install.
  const { data: listData, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) fail(`Failed to list users: ${listErr.message}`);
  const existing = listData.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  );

  if (!existing) {
    const password = requestedPassword ?? randomPassword();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role },
    });
    if (error) fail(`Failed to create user: ${error.message}`);

    // eslint-disable-next-line no-console
    console.log(`✓ Created user ${email} with role=${role}`);
    if (!requestedPassword) {
      // eslint-disable-next-line no-console
      console.log('');
      // eslint-disable-next-line no-console
      console.log('  Initial password (shown once):');
      // eslint-disable-next-line no-console
      console.log(`    ${password}`);
      // eslint-disable-next-line no-console
      console.log('');
      // eslint-disable-next-line no-console
      console.log(
        '  The user can log in with email + password, or request a magic link from /login.',
      );
    }
    // eslint-disable-next-line no-console
    console.log(`  User id: ${data.user.id}`);
    return;
  }

  // Update role (merges with existing app_metadata).
  const nextAppMetadata = { ...(existing.app_metadata ?? {}), role };
  const { error: updateErr } = await admin.auth.admin.updateUserById(
    existing.id,
    { app_metadata: nextAppMetadata },
  );
  if (updateErr) fail(`Failed to update user: ${updateErr.message}`);

  // eslint-disable-next-line no-console
  console.log(`✓ Set ${email} → role=${role}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('✗', err instanceof Error ? err.message : err);
  process.exit(1);
});
