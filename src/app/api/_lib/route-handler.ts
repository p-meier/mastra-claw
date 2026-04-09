import 'server-only';

import { NextResponse } from 'next/server';
import type { ZodSchema } from 'zod';

import { AdminRequiredError, getCurrentUser, type CurrentUser } from '@/lib/auth';
import { mastraFor, type MastraForFacade } from '@/mastra/lib/mastra-for';

import { toErrorResponse } from './errors';

/**
 * The single chokepoint every authenticated API route in MastraClaw goes
 * through. It collapses the four boundary tasks (auth, role check, facade
 * construction, optional profile gate, body parsing, error mapping) into
 * one wrapper so route handlers contain only business logic.
 *
 * Convention (CLAUDE.md): every file under `src/app/api/` that requires
 * an authenticated user MUST use this helper. Calling `getCurrentUser()`
 * or `mastraFor()` directly inside a route handler is a code smell. The
 * only exceptions are unauthenticated webhooks and the onboarding
 * bootstrap routes (which run before the user has a profile).
 */

export class ProfileRequiredError extends Error {
  constructor() {
    super('User profile missing — onboarding incomplete');
    this.name = 'ProfileRequiredError';
  }
}

export type RouteContext<TParams, TBody> = {
  user: CurrentUser;
  facade: MastraForFacade;
  params: TParams;
  body: TBody;
  req: Request;
};

export type AuthenticatedRouteOptions<TParams, TBody> = {
  /** Throws `AdminRequiredError` (→ 403) when current user is not admin. */
  requireAdmin?: boolean;
  /**
   * Ensures `facade.profile()` resolves to a non-null profile before the
   * handler runs. Throws `ProfileRequiredError` (→ 409) otherwise. Use
   * for routes that must not run until onboarding is complete.
   */
  requireProfile?: boolean;
  /**
   * Optional Zod schema for the JSON body. If provided, the request body
   * is parsed and the typed result is passed as `ctx.body`. Schema errors
   * are mapped to 400. Omit for GET/DELETE routes.
   */
  bodySchema?: ZodSchema<TBody>;
  /** The actual handler — receives the prepared context. */
  handler: (ctx: RouteContext<TParams, TBody>) => Promise<Response>;
};

/**
 * Wrap a Next.js App Router route handler with the standard MastraClaw
 * authentication / facade / error-mapping boundary.
 *
 * Usage:
 *
 *     export const GET = withAuthenticatedRoute<{ agentId: string }>({
 *       handler: async ({ facade, params }) => {
 *         const agent = await facade.agents.get(params.agentId);
 *         if (!agent) return NextResponse.json({ error: 'not found' }, { status: 404 });
 *         return NextResponse.json({ agent });
 *       },
 *     });
 */
export function withAuthenticatedRoute<
  TParams = Record<string, string>,
  TBody = undefined,
>(options: AuthenticatedRouteOptions<TParams, TBody>) {
  return async (
    req: Request,
    routeArgs: { params: Promise<TParams> },
  ): Promise<Response> => {
    try {
      const user = await getCurrentUser();
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      if (options.requireAdmin && user.role !== 'admin') {
        throw new AdminRequiredError();
      }

      const facade = mastraFor(user);

      if (options.requireProfile) {
        const profile = await facade.profile();
        if (!profile) {
          throw new ProfileRequiredError();
        }
      }

      let body = undefined as TBody;
      if (options.bodySchema) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
        }
        body = options.bodySchema.parse(raw);
      }

      const params = await routeArgs.params;

      return await options.handler({ user, facade, params, body, req });
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}
