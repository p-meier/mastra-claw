import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ESLint flat-config for MastraClaw.
 *
 * IMPORTANT: when defining `globalIgnores` in flat config you REPLACE
 * the default ignore set — so anything not listed here gets linted,
 * including build artifacts. The previous config only re-listed the
 * Next.js defaults and forgot the Mastra build output, which made
 * `npm run lint` walk into `.mastra/output/**` (megabyte-sized bundled
 * Studio assets, syntax-highlighter grammars, the probe-image-size
 * binary, etc.) and OOM the Node process.
 *
 * Rule of thumb: anything generated, vendored, or outside `src/` does
 * not get linted. If you add a new build/output directory, add it here.
 */
const eslintConfig = defineConfig([
  globalIgnores([
    // --- Next.js default build artifacts ---
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // --- Mastra build output (huge bundled Studio + grammars + binaries) ---
    ".mastra/**",

    // --- Dependencies and lockfiles ---
    "node_modules/**",

    // --- Supabase local stack ---
    "supabase/.branches/**",
    "supabase/.temp/**",

    // --- Test / coverage / misc generated ---
    "coverage/**",
    "dist/**",

    // --- Public assets (no JS/TS to lint) ---
    "public/**",
  ]),
  ...nextVitals,
  ...nextTs,
]);

export default eslintConfig;
