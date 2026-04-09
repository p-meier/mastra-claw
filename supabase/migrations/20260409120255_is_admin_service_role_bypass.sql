-- Allow the `service_role` Supabase connection to pass `is_admin()`
-- checks unconditionally.
--
-- Why
-- ---
-- Channel-driven entry points (Telegram webhook / polling, future
-- cron jobs) have no Next.js session and therefore no JWT. They go
-- through the service-role client (`src/lib/supabase/service.ts`)
-- which Postgres exposes as `auth.role() = 'service_role'`.
--
-- Without this update, every Vault read (e.g. `app_secret_get`) and
-- every admin-gated RLS policy would reject service-role calls,
-- because the existing `is_admin()` only checks the JWT
-- `app_metadata.role`. Adding `service_role` to the predicate is the
-- standard Supabase pattern: the service key already bypasses RLS
-- entirely; we're just bringing the explicit `is_admin()` checks
-- inside SECURITY DEFINER functions in line with that.
--
-- The function definition is `create or replace`, so this migration
-- is idempotent against the original function from
-- `20260408195437_onboarding.sql`.

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    public.jwt_role() = 'admin'
    or auth.role() = 'service_role';
$$;

comment on function public.is_admin() is
  'True iff the calling JWT carries app_metadata.role = ''admin'', or '
  'the connection is the service-role key (used by headless entry '
  'points such as channel webhooks/polling).';
