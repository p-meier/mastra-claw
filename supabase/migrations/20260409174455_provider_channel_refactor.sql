-- 20260409174455_provider_channel_refactor.sql
--
-- Clean break refactor for the provider + channel abstraction.
--
-- Why
-- ---
-- The first cut of admin setup hardcoded a single LLM provider, a single
-- ElevenLabs key, and a single Telegram bot. Going forward we model:
--
--   * Multiple model providers per category (text / image-video / tts /
--     stt), one active at a time. Each provider's secret + non-secret
--     fields are namespaced by `(category, providerId)`.
--
--   * Channels (Telegram, Slack, MS Teams, Google Chat, Discord, …) as
--     a separate admin-configured registry, plus per-user bindings that
--     map a platform identity to a Mastra agent.
--
-- This migration is a clean break: legacy `app_settings` rows and Vault
-- entries are deleted, the legacy `user_telegram_links` table is
-- dropped, and the new `user_channel_bindings` table is created. The
-- admin runs the setup wizard once after applying this migration to
-- repopulate the new schema.
--
-- All Vault writes still go through the existing `app_secret_set/get/
-- delete/list` SECURITY DEFINER functions defined in
-- 20260408195437_onboarding.sql; this migration does NOT add new RPC
-- helpers — namespacing happens client-side by passing names like
-- `provider:text:anthropic:apiKey` to `app_secret_set`.

------------------------------------------------------------------------
-- 1. Drop legacy app_settings rows
------------------------------------------------------------------------
--
-- The single-provider keys are gone. The new resolver writes:
--   providers.{cat}.active                    (text)
--   providers.{cat}.{providerId}.config       (json)
--   channels.{channelId}.configured           (boolean)
--   channels.{channelId}.config               (json incl. voiceEnabled)
-- These rows are written by the wizard / admin pages, not seeded here.

delete from public.app_settings where key in (
  'app.setup_completed_at',
  'llm.default_provider',
  'llm.default_text_model',
  'llm.custom_base_url',
  'image_video.provider',
  'image_video.base_url',
  'elevenlabs.voice_id',
  'elevenlabs.model_id',
  'elevenlabs.voice_id_override',
  'elevenlabs.model_id_override',
  'elevenlabs.configured',
  'telegram.configured',
  'telegram.polling_interval_ms'
);

------------------------------------------------------------------------
-- 2. Drop legacy app secrets from Vault
------------------------------------------------------------------------
--
-- These were the old hardcoded names. The new code stores credentials
-- under namespaced names like `provider:text:anthropic:apiKey` and
-- `channel:telegram:botToken`. We delete the old rows so a stale Vault
-- entry can never accidentally be read by the new code.
--
-- `app_secret_delete` is a SECURITY DEFINER function that requires the
-- caller to be admin. Migrations run as the migrations role, which
-- bypasses the function's `is_admin()` check by going around the RPC —
-- so we delete directly from `vault.secrets` here. This is safe because
-- migrations run with full privileges.

delete from vault.secrets where name in (
  'app:llm_api_key',
  'app:image_video_api_key',
  'app:elevenlabs_api_key',
  'app:telegram_bot_token',
  'app:composio_api_key'
);

------------------------------------------------------------------------
-- 3. Drop legacy user_telegram_links
------------------------------------------------------------------------
--
-- Replaced by `user_channel_bindings` below. The old table only knew
-- Telegram and could not represent multi-channel users.

drop table if exists public.user_telegram_links;

------------------------------------------------------------------------
-- 4. Create user_channel_bindings
------------------------------------------------------------------------
--
-- One row per (user, channel, external identity, agent). A user can:
--
--   * Bind multiple channels (Telegram + Slack + Discord, …)
--   * Bind the same channel to different agents (uncommon but allowed)
--   * Be reached on a given channel by exactly one external identity
--     (the `unique (channel_id, external_id)` constraint ensures we
--     never have two MastraClaw users claiming the same Telegram chat)
--
-- `channel_id` matches a key in `src/lib/channels/registry.ts`.
-- `agent_id` matches a Mastra agent id (today: 'personal-assistant').

create table public.user_channel_bindings (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  channel_id    text        not null,
  external_id   text        not null,
  agent_id      text        not null,
  display_name  text,
  created_at    timestamptz not null default now(),
  unique (channel_id, external_id)
);

create index user_channel_bindings_user_idx
  on public.user_channel_bindings(user_id);

comment on table public.user_channel_bindings is
  'Per-user mapping of (channel platform, external identity, agent). '
  'Replaces the Telegram-only `user_telegram_links` table. The channel '
  'runtime resolves an incoming message by looking up '
  '(channel_id, external_id) and routing to the configured agent.';

alter table public.user_channel_bindings enable row level security;

drop policy if exists user_channel_bindings_select on public.user_channel_bindings;
create policy user_channel_bindings_select on public.user_channel_bindings
  for select
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists user_channel_bindings_insert on public.user_channel_bindings;
create policy user_channel_bindings_insert on public.user_channel_bindings
  for insert
  with check (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists user_channel_bindings_update on public.user_channel_bindings;
create policy user_channel_bindings_update on public.user_channel_bindings
  for update
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists user_channel_bindings_delete on public.user_channel_bindings;
create policy user_channel_bindings_delete on public.user_channel_bindings
  for delete
  using (user_id = (select auth.uid()) or public.is_admin());
