-- 20260408195437_onboarding.sql
--
-- Foundation for the two-wizard onboarding (admin app setup + per-user
-- personal onboarding) and the layered secret model.
--
-- Layered secret model (replaces the "per-user only" wording from the
-- earlier draft of ARCHITECTURE.md §11):
--
--   Layer A — bootstrap secrets in process.env. ~5 values, manual.
--   Layer B — APP-managed secrets in Vault, namespace `app:<name>`.
--             Set/read by admins only. Examples:
--               app:llm_api_key, app:image_video_api_key,
--               app:elevenlabs_api_key, app:telegram_bot_token,
--               app:composio_api_key
--   Layer C — optional per-USER override secrets in Vault, namespace
--             `user:<userId>:<name>`. Structurally ready, no UI in Phase 1.
--
-- All Vault access goes through SECURITY DEFINER functions defined in this
-- migration. The functions live in the `public` schema (so the Supabase JS
-- client can call them via plain `.rpc(...)` without custom schema config),
-- but EXECUTE is REVOKEd from PUBLIC and only GRANTed to `authenticated`.
-- Each function additionally enforces an internal role/ownership check
-- against the JWT, so even an authenticated user cannot bypass the boundary.
--
-- See CLAUDE.md "Multi-tenancy & roles" and the Supabase Vault docs.

------------------------------------------------------------------------
-- 0. Extensions
------------------------------------------------------------------------

-- Vault is shipped enabled in Supabase, but enable explicitly so a fresh
-- self-hosted instance gets it too. The vault schema is created by the
-- extension itself; we don't own it.
create extension if not exists "supabase_vault" with schema "vault";

------------------------------------------------------------------------
-- 1. Helpers — JWT role + uid
------------------------------------------------------------------------
--
-- These wrap the standard Supabase auth helpers so the SECURITY DEFINER
-- functions below can do consistent role checks. They're SECURITY INVOKER
-- (the default), so they only see the calling user's JWT.

create or replace function public.jwt_role()
returns text
language sql
stable
set search_path = ''
as $$
  -- Use auth.jwt() (the canonical Supabase helper). Earlier versions of
  -- this function used current_setting('request.jwt.claims', true) which
  -- isn't reliably populated on Supabase Postgres 17.x via supabase-js.
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    'user'
  );
$$;

comment on function public.jwt_role() is
  'Reads app_metadata.role from the JWT. Returns ''user'' if missing. '
  'Roles live in app_metadata (server-controlled) per Supabase security '
  'best practice — never user_metadata.';

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.jwt_role() = 'admin';
$$;

comment on function public.is_admin() is
  'True iff the calling JWT carries app_metadata.role = ''admin''.';

------------------------------------------------------------------------
-- 2. user_profiles
------------------------------------------------------------------------

create table if not exists public.user_profiles (
  user_id                  uuid primary key references auth.users(id) on delete cascade,

  -- How the assistant should address the user (e.g. "Patrick"). Captured
  -- as the very first question of the bootstrap interview.
  nickname                 text,

  -- Free-form Markdown document about the user — identity, work,
  -- communication preferences, anything else worth remembering long-term.
  -- Modeled after Claude Desktop's "Personal Preferences" textarea: one
  -- string, no nested schema. The bootstrap interview produces an initial
  -- version; the user edits it freely from /account/settings later.
  user_preferences         text,

  -- Bootstrap chat resumption
  bootstrap_thread_id      text,

  -- Onboarding state machine
  onboarding_completed_at  timestamptz,
  onboarding_skipped_at    timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.user_profiles is
  'Per-user profile and onboarding state. One row per auth.users row, '
  'auto-created by the trigger below. RLS: user sees their own row, '
  'admins see everyone.';

comment on column public.user_profiles.nickname is
  'How the assistant addresses the user. First captured by the bootstrap '
  'interview, editable from /account/settings.';

comment on column public.user_profiles.user_preferences is
  'Free-form Markdown document about the user. Loaded verbatim into the '
  'agent system prompt at chat time via requestContext. Editable from '
  '/account/settings — the source of truth for user persona.';

comment on column public.user_profiles.bootstrap_thread_id is
  'AI SDK chat ID of the in-progress bootstrap interview, so closing the '
  'tab and coming back resumes the same conversation. Cleared on completion.';

-- updated_at trigger
create or replace function public.user_profiles_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_touch_updated_at on public.user_profiles;
create trigger user_profiles_touch_updated_at
  before update on public.user_profiles
  for each row execute function public.user_profiles_touch_updated_at();

-- Auto-insert a blank row whenever a new auth user is created so the wizard
-- always has a row to update.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users that already exist (Phase 1: Patrick).
insert into public.user_profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- RLS
alter table public.user_profiles enable row level security;

drop policy if exists user_profiles_select on public.user_profiles;
create policy user_profiles_select on public.user_profiles
  for select
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists user_profiles_insert on public.user_profiles;
create policy user_profiles_insert on public.user_profiles
  for insert
  with check (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists user_profiles_update on public.user_profiles;
create policy user_profiles_update on public.user_profiles
  for update
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists user_profiles_delete on public.user_profiles;
create policy user_profiles_delete on public.user_profiles
  for delete
  using (public.is_admin());

------------------------------------------------------------------------
-- 3. user_telegram_links
------------------------------------------------------------------------
--
-- Maps the company-wide Telegram bot's incoming chats to MastraClaw users.
-- The bot token itself lives in Vault as `app:telegram_bot_token`. Each
-- user provides their numeric Telegram User ID during personal onboarding
-- (or via /chatid in the bot — separate task).

create table if not exists public.user_telegram_links (
  user_id            uuid not null references auth.users(id) on delete cascade,
  telegram_user_id   bigint not null,
  created_at         timestamptz not null default now(),
  primary key (user_id, telegram_user_id),
  unique (telegram_user_id)
);

comment on table public.user_telegram_links is
  'Per-user allowlist mapping Telegram numeric user IDs to MastraClaw '
  'users. The Telegram webhook handler uses this to authorize incoming '
  'messages and route them to the right user Personal Assistant.';

alter table public.user_telegram_links enable row level security;

drop policy if exists user_telegram_links_select on public.user_telegram_links;
create policy user_telegram_links_select on public.user_telegram_links
  for select
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists user_telegram_links_insert on public.user_telegram_links;
create policy user_telegram_links_insert on public.user_telegram_links
  for insert
  with check (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists user_telegram_links_update on public.user_telegram_links;
create policy user_telegram_links_update on public.user_telegram_links
  for update
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists user_telegram_links_delete on public.user_telegram_links;
create policy user_telegram_links_delete on public.user_telegram_links
  for delete
  using (user_id = (select auth.uid()) or public.is_admin());

------------------------------------------------------------------------
-- 4. app_settings extensions
------------------------------------------------------------------------
--
-- The table itself was created in 20260408180355_app_settings.sql. We add
-- the new keys the wizards need. The previous `wizard.completed` boolean
-- is superseded by `app.setup_completed_at` (a real timestamp) — kept in
-- the table during Phase 1 for backwards compatibility, removed in a
-- later cleanup migration once nothing reads it.

insert into public.app_settings (key, value) values
  ('app.setup_completed_at',          'null'::jsonb),
  ('llm.default_provider',            'null'::jsonb),
  ('llm.custom_base_url',             'null'::jsonb),
  ('llm.default_text_model',          'null'::jsonb),
  ('image_video.provider',            'null'::jsonb),
  ('image_video.base_url',            'null'::jsonb),
  ('telegram.configured',             'false'::jsonb),
  ('composio.configured',             'false'::jsonb),
  ('elevenlabs.configured',           'false'::jsonb),
  -- Voice ID and model ID default to env values; admin override is optional.
  ('elevenlabs.voice_id_override',    'null'::jsonb),
  ('elevenlabs.model_id_override',    'null'::jsonb)
on conflict (key) do nothing;

-- Lock down app_settings: admin-only RLS. The table was created without
-- RLS in the previous migration; add it now per the security checklist.
alter table public.app_settings enable row level security;

drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings
  for select
  using (public.is_admin());

drop policy if exists app_settings_insert on public.app_settings;
create policy app_settings_insert on public.app_settings
  for insert
  with check (public.is_admin());

drop policy if exists app_settings_update on public.app_settings;
create policy app_settings_update on public.app_settings
  for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists app_settings_delete on public.app_settings;
create policy app_settings_delete on public.app_settings
  for delete
  using (public.is_admin());

------------------------------------------------------------------------
-- 5. Vault SECURITY DEFINER wrappers
------------------------------------------------------------------------
--
-- These are the *only* way the application code touches Vault. They run
-- as the function owner (postgres / supabase_admin) which has access to
-- the vault schema; the calling user only sees the function's argument
-- and return shapes.
--
-- Naming convention enforced inside each function:
--    app:<name>             — admin-only namespace
--    user:<userId>:<name>   — per-user namespace, scoped to auth.uid()
--
-- The full vault.secrets.name is built from the parameters; callers
-- never pass a raw vault name and so cannot escape their namespace.

------------------------------------------------------------------------
-- 5a. app_secret_set / get / delete / list  (admin only)
------------------------------------------------------------------------

create or replace function public.app_secret_set(
  p_name  text,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text;
  v_existing_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin role required to set app secrets'
      using errcode = '42501';
  end if;

  if p_name is null or p_name = '' then
    raise exception 'secret name is required';
  end if;

  v_full_name := 'app:' || p_name;

  select id into v_existing_id
    from vault.secrets
    where name = v_full_name;

  if v_existing_id is not null then
    perform vault.update_secret(v_existing_id, p_value);
  else
    perform vault.create_secret(p_value, v_full_name, 'MastraClaw app-level secret');
  end if;
end;
$$;

create or replace function public.app_secret_get(
  p_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text;
  v_value text;
begin
  if not public.is_admin() then
    raise exception 'admin role required to read app secrets'
      using errcode = '42501';
  end if;

  v_full_name := 'app:' || p_name;

  select decrypted_secret into v_value
    from vault.decrypted_secrets
    where name = v_full_name;

  return v_value;
end;
$$;

create or replace function public.app_secret_delete(
  p_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text;
begin
  if not public.is_admin() then
    raise exception 'admin role required to delete app secrets'
      using errcode = '42501';
  end if;

  v_full_name := 'app:' || p_name;
  delete from vault.secrets where name = v_full_name;
end;
$$;

create or replace function public.app_secret_list()
returns table (name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin role required to list app secrets'
      using errcode = '42501';
  end if;

  return query
    select substring(s.name from length('app:') + 1) as name
      from vault.secrets s
      where s.name like 'app:%'
      order by s.name;
end;
$$;

------------------------------------------------------------------------
-- 5b. user_secret_set / get / delete  (per-user, scoped to auth.uid())
------------------------------------------------------------------------
--
-- Layer C: structurally ready, no Phase 1 UI uses these yet. They're in
-- the migration so the SecretService surface is consistent and so future
-- per-user override work doesn't require a second migration.

create or replace function public.user_secret_set(
  p_name  text,
  p_value text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_full_name text;
  v_existing_id uuid;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if p_name is null or p_name = '' then
    raise exception 'secret name is required';
  end if;

  v_full_name := 'user:' || v_uid::text || ':' || p_name;

  select id into v_existing_id
    from vault.secrets
    where name = v_full_name;

  if v_existing_id is not null then
    perform vault.update_secret(v_existing_id, p_value);
  else
    perform vault.create_secret(p_value, v_full_name, 'MastraClaw per-user secret');
  end if;
end;
$$;

create or replace function public.user_secret_get(
  p_name text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_full_name text;
  v_value text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  v_full_name := 'user:' || v_uid::text || ':' || p_name;

  select decrypted_secret into v_value
    from vault.decrypted_secrets
    where name = v_full_name;

  return v_value;
end;
$$;

create or replace function public.user_secret_delete(
  p_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_full_name text;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  v_full_name := 'user:' || v_uid::text || ':' || p_name;
  delete from vault.secrets where name = v_full_name;
end;
$$;

------------------------------------------------------------------------
-- 6. Privilege grants
------------------------------------------------------------------------
--
-- REVOKE EXECUTE from PUBLIC (the default GRANT) and re-GRANT only to
-- `authenticated`. Anonymous users cannot call any of these. The internal
-- role check (`is_admin()`) gates the admin-only ones a second time.

revoke execute on function public.jwt_role()                  from public;
revoke execute on function public.is_admin()                  from public;
revoke execute on function public.app_secret_set(text, text)  from public;
revoke execute on function public.app_secret_get(text)        from public;
revoke execute on function public.app_secret_delete(text)     from public;
revoke execute on function public.app_secret_list()           from public;
revoke execute on function public.user_secret_set(text, text) from public;
revoke execute on function public.user_secret_get(text)       from public;
revoke execute on function public.user_secret_delete(text)    from public;

grant execute on function public.jwt_role()                   to authenticated;
grant execute on function public.is_admin()                   to authenticated;
grant execute on function public.app_secret_set(text, text)   to authenticated;
grant execute on function public.app_secret_get(text)         to authenticated;
grant execute on function public.app_secret_delete(text)      to authenticated;
grant execute on function public.app_secret_list()            to authenticated;
grant execute on function public.user_secret_set(text, text)  to authenticated;
grant execute on function public.user_secret_get(text)        to authenticated;
grant execute on function public.user_secret_delete(text)     to authenticated;
