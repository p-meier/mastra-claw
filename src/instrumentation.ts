/**
 * Next.js instrumentation hook — runs once at server boot, before any
 * request hits a route handler.
 *
 * Sole job after the channel-registry refactor: force `@/mastra` to
 * construct so the Mastra instance comes up and `AgentChannels.initialize()`
 * fires for every agent that has a non-empty `channels` slot. Without
 * this hook, polling wouldn't kick off until the first HTTP request,
 * which could be never on a quiet morning.
 *
 * The previous implementation also seeded `process.env.TELEGRAM_BOT_TOKEN`
 * from Vault. That hack is gone — `buildAgentChannels()` now resolves
 * each adapter's credentials inline through `channelSecrets.get(...)`,
 * so no API key ever touches `process.env`.
 *
 * Failures here should NEVER crash the server: a missing channel
 * configuration in dev means the channel adapter is simply not built,
 * but the rest of the app (web chat, workspace, …) keeps working.
 */
export async function register(): Promise<void> {
  // Only run on the Node.js server runtime — not on the Edge runtime
  // and not in the browser.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    // Importing `@/mastra` triggers the top-level `await
    // createPersonalAssistant()` and the Mastra constructor, which in
    // turn calls `AgentChannels.initialize()` for every channel
    // returned by `buildAgentChannels()`.
    await import('@/mastra');
  } catch (err) {
    console.warn(
      '[instrumentation] failed to initialize @/mastra:',
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
  }
}
