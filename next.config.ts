import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mastra-Pakete dürfen nicht von Next gebundled werden — sie enthalten
  // dynamische Imports und native Deps. Mastras Lint-Rule erzwingt das im Build.
  //
  // Die Chat-SDK-Adapter ziehen Plattform-SDKs nach (`discord.js`,
  // `@chat-adapter/teams` → `@microsoft/teams.apps`, …) deren native
  // Optional-Deps Turbopack als hard error behandelt, wenn sie gebundled
  // werden. Genauso wie die Mastra-Pakete behandeln wir sie hier als
  // "serverExternalPackages" — Next lässt Node sie zur Laufzeit per
  // `require` auflösen, statt sie in den Server-Bundle zu inlineren.
  serverExternalPackages: [
    '@mastra/*',
    '@chat-adapter/discord',
    '@chat-adapter/slack',
    '@chat-adapter/teams',
    '@chat-adapter/gchat',
    '@chat-adapter/telegram',
    'discord.js',
    '@discordjs/ws',
  ],
};

export default nextConfig;
