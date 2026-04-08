import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mastra-Pakete dürfen nicht von Next gebundled werden — sie enthalten
  // dynamische Imports und native Deps. Mastras Lint-Rule erzwingt das im Build.
  serverExternalPackages: ['@mastra/*'],
};

export default nextConfig;
