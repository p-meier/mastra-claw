-- Workspaces bucket — per-(user, agent) S3-backed scratch filesystem.
--
-- Layout convention from ARCHITECTURE.md:
--     users/<userId>/agents/<agentId>/...
--
-- Two layers of isolation enforce that one user can never read or
-- write another user's workspace files:
--
--   1. Application — `src/mastra/lib/workspace-service.ts` resolves
--      every relative path against the prefix above and rejects
--      anything that escapes (path traversal, encoded separators,
--      Windows backslashes, null bytes).
--
--   2. Storage RLS (this file) — even if the application guard had a
--      bug, Postgres rejects any object operation whose key does not
--      match the calling user's `auth.uid()`. Admins (`jwt_role() =
--      'admin'`) bypass for backups and cross-user inspection.
--
-- Supabase Storage exposes its objects table as `storage.objects`
-- with columns `bucket_id`, `name` (the full key), and `owner`. We
-- write `using` clauses against `name` so the policy lives at the
-- key-shape level — RLS does not need to know who created the row.

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('workspaces', 'workspaces', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------
-- storage.objects has RLS already enabled by Supabase. We add four
-- policies (select / insert / update / delete) all gated on the same
-- prefix match.

drop policy if exists "workspaces_select_own_or_admin" on storage.objects;
create policy "workspaces_select_own_or_admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'workspaces'
    and (
      name like ('users/' || auth.uid()::text || '/agents/%')
      or jwt_role() = 'admin'
    )
  );

drop policy if exists "workspaces_insert_own_or_admin" on storage.objects;
create policy "workspaces_insert_own_or_admin"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'workspaces'
    and (
      name like ('users/' || auth.uid()::text || '/agents/%')
      or jwt_role() = 'admin'
    )
  );

drop policy if exists "workspaces_update_own_or_admin" on storage.objects;
create policy "workspaces_update_own_or_admin"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'workspaces'
    and (
      name like ('users/' || auth.uid()::text || '/agents/%')
      or jwt_role() = 'admin'
    )
  );

drop policy if exists "workspaces_delete_own_or_admin" on storage.objects;
create policy "workspaces_delete_own_or_admin"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'workspaces'
    and (
      name like ('users/' || auth.uid()::text || '/agents/%')
      or jwt_role() = 'admin'
    )
  );
