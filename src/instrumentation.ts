/**
 * Next.js instrumentation hook — runs once at server boot, before any
 * request hits a route handler. Used here for two things:
 *
 *  1. **Seed `TELEGRAM_BOT_TOKEN` into `process.env`** from the
 *     Supabase Vault `app:telegram_bot_token` secret. The Telegram
 *     adapter from `@chat-adapter/telegram` auto-detects this env
 *     var when no `botToken` is passed to `createTelegramAdapter()`.
 *     Per CLAUDE.md, app secrets live in Vault and never in
 *     `.env.local`; this hook is the bridge.
 *
 *  2. **Force `@/mastra` to construct.** Importing the module here
 *     runs the `Mastra` constructor, which in turn calls
 *     `AgentChannels.initialize()` for every agent that has a
 *     `channels` config — and that's what starts the Telegram polling
 *     loop. Without this hook, polling wouldn't kick off until the
 *     first HTTP request, which could be never on a quiet morning.
 *
 * Failures here should NEVER crash the server: a missing bot token in
 * dev means the channels config will throw on first poll, but the rest
 * of the app (web chat, workspace, …) keeps working.
 */
export async function register(): Promise<void> {
  // Only run on the Node.js server runtime — not on the Edge runtime
  // and not in the browser. The Vault read is server-only.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    const { createServiceClient } = await import('@/lib/supabase/service');
    const { APP_SECRET_NAMES } = await import('@/mastra/lib/secret-service');

    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('app_secret_get', {
      p_name: APP_SECRET_NAMES.telegramBotToken,
    });

    if (error) {
      console.warn(
        `[instrumentation] failed to read telegram bot token from Vault: ${error.message}`,
      );
    } else if (typeof data === 'string' && data.length > 0) {
      process.env.TELEGRAM_BOT_TOKEN = data;
    } else {
      console.info(
        '[instrumentation] no telegram bot token in Vault — Telegram channel disabled until admin setup is run',
      );
    }
  } catch (err) {
    console.warn(
      '[instrumentation] failed to seed Telegram bot token:',
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
  }

  // Force Mastra construction → triggers AgentChannels.initialize()
  // for every agent with a `channels` config, which starts polling.
  try {
    await import('@/mastra');
  } catch (err) {
    console.warn(
      '[instrumentation] failed to initialize @/mastra:',
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
  }
}
