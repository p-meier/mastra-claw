#!/usr/bin/env tsx
/**
 * Merge upstream mastra-claw into the current fork.
 *
 * How a fork uses this:
 *   1. Set the upstream URL once:
 *        git remote add upstream <url>
 *      or export it for the script:
 *        export UPSTREAM_URL=<url>
 *   2. Run `npm run sync-upstream` (optionally `-- --yes` to skip the
 *      interactive prompt, `-- --no-push` to only merge locally).
 *
 * The script is intentionally conservative:
 *   - refuses to run with a dirty working tree
 *   - only ever fast-forwards / merges, never rebases
 *   - never force-pushes
 *   - if a merge conflict lands, prints the conflicted files and exits 1
 *
 * Exit codes:
 *    0 — success or already up-to-date
 *    1 — precondition failure, conflict, or runtime error
 *  130 — user cancelled
 */

import { execSync, spawnSync } from 'node:child_process';

type Flags = {
  yes: boolean;
  push: boolean;
  branch: string;
  upstreamUrl: string | null;
};

function parseFlags(argv: string[]): Flags {
  const rest = argv.slice(2);
  const flags: Flags = {
    yes: false,
    push: true,
    branch: 'main',
    upstreamUrl: process.env.UPSTREAM_URL ?? null,
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--yes' || arg === '-y') flags.yes = true;
    else if (arg === '--no-push') flags.push = false;
    else if (arg === '--branch') flags.branch = rest[++i] ?? 'main';
    else if (arg === '--upstream') flags.upstreamUrl = rest[++i] ?? null;
    else if (arg === '--help' || arg === '-h') {
      // eslint-disable-next-line no-console
      console.log(
        `Usage: npm run sync-upstream -- [--yes] [--no-push] [--branch <name>] [--upstream <url>]`,
      );
      process.exit(0);
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }
  return flags;
}

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`✗ ${message}`);
  process.exit(1);
}

function sh(cmd: string): string {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function shOk(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function ask(question: string): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} (y/N) `)).trim().toLowerCase();
  rl.close();
  return answer === 'y' || answer === 'yes';
}

async function main() {
  const flags = parseFlags(process.argv);

  // Preconditions.
  if (!shOk('git rev-parse --is-inside-work-tree')) {
    fail('Not inside a git repository.');
  }
  const dirty = sh('git status --porcelain');
  if (dirty.length > 0) {
    fail(
      'Working tree is not clean. Commit or stash before syncing:\n' + dirty,
    );
  }

  // Resolve the upstream remote.
  const haveUpstreamRemote = shOk('git remote get-url upstream');
  if (!haveUpstreamRemote) {
    if (!flags.upstreamUrl) {
      fail(
        'No `upstream` remote configured and no --upstream <url> / UPSTREAM_URL env set.\n' +
          'Add one: git remote add upstream <url>',
      );
    }
    // eslint-disable-next-line no-console
    console.log(`→ Adding upstream remote: ${flags.upstreamUrl}`);
    execSync(`git remote add upstream ${flags.upstreamUrl}`, { stdio: 'inherit' });
  } else if (flags.upstreamUrl) {
    const existing = sh('git remote get-url upstream');
    if (existing !== flags.upstreamUrl) {
      fail(
        `Existing upstream remote (${existing}) does not match --upstream ${flags.upstreamUrl}.\n` +
          'Update with: git remote set-url upstream <url>',
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(`→ Fetching upstream/${flags.branch} …`);
  execSync('git fetch upstream --tags', { stdio: 'inherit' });

  const behind = parseInt(
    sh(`git rev-list --count HEAD..upstream/${flags.branch}`),
    10,
  );
  if (!Number.isFinite(behind) || behind === 0) {
    // eslint-disable-next-line no-console
    console.log('✓ Already up-to-date with upstream.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.log(`→ ${behind} commit(s) behind upstream/${flags.branch}.`);
  if (!flags.yes) {
    const proceed = await ask(`Merge them into the current branch?`);
    if (!proceed) {
      // eslint-disable-next-line no-console
      console.log('Cancelled.');
      process.exit(130);
    }
  }

  const merge = spawnSync(
    'git',
    ['merge', `upstream/${flags.branch}`, '--no-edit'],
    { stdio: 'inherit' },
  );
  if (merge.status !== 0) {
    const conflicted = sh('git diff --name-only --diff-filter=U').split('\n').filter(Boolean);
    // eslint-disable-next-line no-console
    console.error('✗ Merge conflict. Conflicted files:');
    for (const f of conflicted) {
      // eslint-disable-next-line no-console
      console.error(`  - ${f}`);
    }
    // eslint-disable-next-line no-console
    console.error(
      '\nResolve, `git add` the files, `git commit`, then re-run this script.',
    );
    process.exit(1);
  }

  if (flags.push) {
    // eslint-disable-next-line no-console
    console.log('→ Pushing to origin …');
    execSync('git push origin HEAD', { stdio: 'inherit' });
  }

  // eslint-disable-next-line no-console
  console.log('✓ Sync complete.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('✗', err instanceof Error ? err.message : err);
  process.exit(1);
});
