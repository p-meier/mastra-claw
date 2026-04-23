-- Platform schema consolidation.
--
-- Brings the database to the current MastraClaw shape, executed in a
-- single transaction so partial failure does not leave the schema in
-- a half-renamed state.
--
-- Delta from the prior migration chain:
--
--   1. `public.app_settings`            → rename to `public.platform_settings`
--   2. `public.user_profiles` columns:
--        rename `nickname`              → `preferred_name`
--        rename `user_preferences`      → `user_prompt`
--        add    `name`                  text
--        add    `avatar_path`           text
--        add    `must_change_password`  boolean not null default false
--        drop   `bootstrap_thread_id`
--        drop   `onboarding_completed_at`
--        drop   `onboarding_skipped_at`
--   3. Drop `public.user_channel_bindings` (channels layer removed).
--   4. Create `storage.buckets.avatars` + policies.
--   5. Create `storage.buckets.branding` + policies.
--   6. Drop legacy `app_settings_*` RLS policies; recreate on
--      `platform_settings` with a public-read carve-out: admins see
--      all, everyone else can read only `key = 'app.setup_completed_at'`.
--   7. Seed the `organization` row in `platform_settings` (idempotent).
--
-- Intentionally NOT in this migration:
--   - `teams` / `team_members` tables (teams are not modelled here).
--   - Changes to the existing `workspaces` bucket and its RLS.
--   - Changes to the Vault RPC surface (already present and correct).
--   - Changes to the `user_profiles` insert trigger (columns the
--     trigger touches are stable across this migration).

begin;

-- ---------------------------------------------------------------------------
-- 1. Rename app_settings → platform_settings
-- ---------------------------------------------------------------------------
--
-- `ALTER TABLE ... RENAME` carries constraints, indexes, triggers, and
-- policies with the rename. Existing rows are preserved bit-for-bit.
-- Policies are dropped explicitly below because their `using` clause
-- referenced the old name in comments and because the shape needs to
-- change (add the public-read carve-out).

alter table public.app_settings rename to platform_settings;

-- The touch trigger was named `app_settings_touch_updated_at` and
-- survived the rename. Keep the old name rather than churning it —
-- trigger names are internal and renaming has no functional effect.

alter table public.platform_settings
  add column if not exists updated_by uuid references auth.users(id) on delete set null;


-- ---------------------------------------------------------------------------
-- 2. user_profiles column surgery
-- ---------------------------------------------------------------------------
--
-- Columns renamed in place so the existing data migrates with no copy
-- step. Additions get defaults so existing rows (the single admin
-- profile in a running dev instance) do not fail the NOT NULL
-- constraint on `must_change_password`. The three onboarding-specific
-- columns are dropped cascading — nothing outside user_profiles
-- references them.

alter table public.user_profiles
  rename column nickname to preferred_name;

alter table public.user_profiles
  rename column user_preferences to user_prompt;

alter table public.user_profiles
  add column if not exists name text;

alter table public.user_profiles
  add column if not exists avatar_path text;

alter table public.user_profiles
  add column if not exists must_change_password boolean not null default false;

alter table public.user_profiles
  drop column if exists bootstrap_thread_id;

alter table public.user_profiles
  drop column if exists onboarding_completed_at;

alter table public.user_profiles
  drop column if exists onboarding_skipped_at;


-- ---------------------------------------------------------------------------
-- 3. Drop user_channel_bindings (channels layer is gone)
-- ---------------------------------------------------------------------------

drop table if exists public.user_channel_bindings cascade;


-- ---------------------------------------------------------------------------
-- 4. avatars bucket — public read; owner-folder writes
-- ---------------------------------------------------------------------------
--
-- Path convention: `{userId}/{uuid}.webp`. The admin account-settings
-- upload re-encodes through sharp before writing; client MIME types
-- are not trusted.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880, -- 5 MiB; processed avatars ~50 KiB, this caps the upload.
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
)
on conflict (id) do nothing;

create policy avatars_public_select on storage.objects
  for select
  using (bucket_id = 'avatars');

create policy avatars_owner_insert on storage.objects
  for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_owner_update on storage.objects
  for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy avatars_owner_delete on storage.objects
  for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- ---------------------------------------------------------------------------
-- 5. branding bucket — public read; admin-only writes
-- ---------------------------------------------------------------------------
--
-- Fork-level white-label assets (customer logo). Public read so the
-- login page, sidebar, and Supabase auth email HTML can embed without
-- a JWT. Single-tenant: keys live at the bucket root (`logo-<uuid>.webp`).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
)
on conflict (id) do nothing;

create policy branding_public_select on storage.objects
  for select
  using (bucket_id = 'branding');

create policy branding_admin_insert on storage.objects
  for insert
  with check (bucket_id = 'branding' and public.is_admin());

create policy branding_admin_update on storage.objects
  for update
  using (bucket_id = 'branding' and public.is_admin())
  with check (bucket_id = 'branding' and public.is_admin());

create policy branding_admin_delete on storage.objects
  for delete
  using (bucket_id = 'branding' and public.is_admin());


-- ---------------------------------------------------------------------------
-- 6. platform_settings RLS — drop legacy policies, recreate with carve-out
-- ---------------------------------------------------------------------------
--
-- Legacy names live on the renamed table (`app_settings_*`). We drop them
-- and create fresh ones under the `platform_settings_*` naming so a grep
-- for `app_settings` yields zero hits after this file runs. The SELECT policy
-- adds the public-read carve-out for `app.setup_completed_at`, which
-- the proxy middleware reads on every request from non-admin sessions.

drop policy if exists app_settings_select on public.platform_settings;
drop policy if exists app_settings_insert on public.platform_settings;
drop policy if exists app_settings_update on public.platform_settings;
drop policy if exists app_settings_delete on public.platform_settings;

create policy platform_settings_select on public.platform_settings
  for select
  using (public.is_admin() or key = 'app.setup_completed_at');

create policy platform_settings_insert on public.platform_settings
  for insert
  with check (public.is_admin());

create policy platform_settings_update on public.platform_settings
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy platform_settings_delete on public.platform_settings
  for delete
  using (public.is_admin());


-- ---------------------------------------------------------------------------
-- 7. Seed the `organization` row
-- ---------------------------------------------------------------------------
--
-- Shape matches `OrganizationSettingSchema` in `src/lib/organization.ts`.
-- The admin branding step writes these values. Idempotent: re-running
-- the migration is a no-op.

insert into public.platform_settings (key, value)
values ('organization', jsonb_build_object(
  'name',               null,
  'organizationPrompt', null,
  'customerLogoPath',   null
))
on conflict (key) do nothing;


commit;
