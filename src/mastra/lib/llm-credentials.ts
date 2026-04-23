import 'server-only';

/**
 * Kept as a thin module for backwards compatibility: the
 * `AppNotConfiguredError` class is the one piece that call sites + the
 * API error mapping layer still reference. Everything else (the full
 * credential-loading path) moved to
 * `src/lib/platform-providers/build.ts` after the provider registry
 * consolidation.
 */

export class AppNotConfiguredError extends Error {
  constructor(what: string) {
    super(`MastraClaw is not yet configured: ${what} missing`);
    this.name = 'AppNotConfiguredError';
  }
}
