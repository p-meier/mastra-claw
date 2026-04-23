# Platform agents

This folder holds upstream-owned agents. Every agent here is merged
verbatim by `npm run sync-upstream` from the upstream mastra-claw
repo. **Do not hand-edit files in this folder in a fork** — your
changes will be clobbered on the next sync.

Put fork-specific agents under `src/mastra/agents/custom/` instead.

The same rule applies to `src/mastra/tools/platform/` and
`src/mastra/workflows/platform/`.
