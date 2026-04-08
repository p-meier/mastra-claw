-- 0001_app_settings.sql
--
-- Bootstrap migration for MastraClaw.
--
-- Enables the extensions Mastra needs (pgvector for embeddings, pgcrypto for
-- gen_random_uuid()) and creates the global app_settings key/value table that
-- the setup wizard will read/write.
--
-- NOTE on RLS: app_settings is intentionally global (admin-only). Row-Level
-- Security is added in a later migration together with the multi-tenant
-- mastraFor() factory and the role-aware policies described in
-- ARCHITECTURE.md §6. Do NOT use this table for per-user data.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create or replace function public.app_settings_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''  -- pinned per Supabase advisor 0011 (function_search_path_mutable)
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at
  before update on public.app_settings
  for each row execute function public.app_settings_touch_updated_at();

-- Marker so the app knows whether the setup wizard has been completed.
insert into public.app_settings (key, value)
values ('wizard.completed', 'false'::jsonb)
on conflict (key) do nothing;
