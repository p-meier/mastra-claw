# Custom agents

This folder is **fork territory**. `npm run sync-upstream` never
touches it — any agent landed here is preserved verbatim across
upstream merges.

Add an agent by creating `src/mastra/agents/custom/<name>.ts` and
registering it in `./index.ts`. Follow the same pattern for
`src/mastra/tools/custom/` and `src/mastra/workflows/custom/`.
