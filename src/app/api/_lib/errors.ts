import 'server-only';

import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { AdminRequiredError } from '@/lib/auth';
import { AppNotConfiguredError } from '@/mastra/lib/mastra-for';
import {
  WorkspaceNotConfiguredError,
  WorkspacePathError,
} from '@/mastra/lib/workspace-service';

import { ProfileRequiredError } from './route-handler';

/**
 * Central HTTP-error mapping for the API boundary helper.
 *
 * Adding a new domain error?
 *   1. Define the error class where the domain logic lives.
 *   2. Add a branch here.
 *   3. Document the new status code in the route's JSDoc.
 *
 * Anything that falls through is logged with its stack and surfaced as a
 * generic 500. We deliberately do NOT leak `err.message` from unknown
 * errors to the client to avoid accidental information disclosure.
 */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: err.issues },
      { status: 400 },
    );
  }
  if (err instanceof AdminRequiredError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof ProfileRequiredError) {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  if (err instanceof AppNotConfiguredError) {
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
  if (err instanceof WorkspacePathError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err instanceof WorkspaceNotConfiguredError) {
    return NextResponse.json({ error: err.message }, { status: 503 });
  }

  console.error('[api] unhandled route error', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
