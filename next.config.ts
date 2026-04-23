import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mastra-Pakete dürfen nicht von Next gebundled werden — sie enthalten
  // dynamische Imports und native Deps. Mastras Lint-Rule erzwingt das im Build.
  // Next lässt Node sie zur Laufzeit per `require` auflösen, statt sie in den
  // Server-Bundle zu inlineren.
  serverExternalPackages: ['@mastra/*'],
};

export default nextConfig;
