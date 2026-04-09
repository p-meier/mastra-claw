-- 20260409061702_app_settings_value_nullable.sql
--
-- Drop the NOT NULL constraint on app_settings.value. The new wizard
-- model writes everything atomically at the end, so JSONB-null sentinels
-- aren't really needed — but the constraint was semantically wrong
-- (JSONB null IS a valid value for a jsonb column) and we already saw
-- it bite once. Defensive cleanup.

alter table public.app_settings alter column value drop not null;
