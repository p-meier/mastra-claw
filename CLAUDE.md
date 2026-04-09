# MastraClaw — Claude Code Instructions

> **Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first.** It is the authoritative source for every architectural decision in this project: the single-process embedding of Mastra in Next.js, the Supabase backend, multi-tenancy as a foundation, the server-only execution boundary, the Main Agent + Sub Agents model, channel bindings, secrets management, and backups. When this file conflicts with `ARCHITECTURE.md`, `ARCHITECTURE.md` wins. This file is a working-level reference for day-to-day coding conventions.

## Project Overview

MastraClaw is an enterprise-ready personal AI agent built on [Mastra.ai](https://mastra.ai). It is a **single-process Next.js application** that embeds Mastra directly via TypeScript imports — there is no separate API server. All persistent state lives in Supabase (Postgres + Storage + Auth + Vault + pgvector); the compute layer is fully disposable.

The agent model is **one Main Agent and many Sub Agents**:

- The **Main Agent** (code-defined) is the user's primary point of contact and conceptually the orchestrator. It owns the default Telegram bot, the default Web UI chat, and the default voice interface. It can delegate work to sub-agents.
- **Sub Agents** are specialized: research, finance, scheduling, content creation, etc. Some are code-defined (shipped in `src/mastra/agents/`), some are stored in the database and created by the user via the web UI. Sub-agents can be reached **indirectly** through the Main Agent's delegation **or directly** through their own bound channel (e.g., a dedicated Telegram bot per sub-agent). Routing is configured via a `bindings` table in Postgres, not hardcoded.

The architecture combines three implementation paradigms:

1. **Skill-based** — Agent capabilities defined as Markdown SOPs in S3-backed workspaces, flexible and learnable
2. **Workflow-based** — Multi-step durable workflows in code (Mastra workflows in `src/mastra/workflows/`)
3. **Hybrid (primary)** — Main Agent delegates to specialists, workflows-as-tools encapsulate complex operations as single tool calls

The hybrid pattern solves the compound error problem (95% per-step accuracy degrades to 36% after 20 steps) by wrapping multi-step operations in reliable workflows.

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Agent Framework | Mastra.ai (`@mastra/core`, `@mastra/editor`, `@mastra/memory`, `@mastra/observability`) | Agents, workflows, tools, memory, observability, runtime resource CRUD |
| Application Host | Next.js 16 (App Router) | Single deployment; Server Components / Route Handlers / Server Actions are the only place Mastra runs |
| Database | Supabase Postgres via `@mastra/pg` | Mastra Storage, app tables, multi-tenant data |
| Vector Store | pgvector (bundled in Supabase) via `@mastra/pg` | Embeddings for RAG and semantic recall |
| Workspace Filesystem | Supabase Storage (S3 API) via `@mastra/s3` | Skill files, generated artifacts, per-agent workspaces |
| Auth | Supabase Auth + `@supabase/ssr` | User identity, sessions, RLS subject |
| Secrets | Supabase Vault (`pgsodium`) via `SecretService` | Per-user encrypted secrets (LLM keys, channel tokens, MCP auth) |
| Voice | ElevenLabs (TTS), STT TBD | Voice I/O |
| Channels | Custom adapters in `src/lib/channels/` (Telegram first) | Bindings table routes incoming messages to the right agent |
| Model Routing | Mastra model router (`provider/model-name` strings) | Model-agnostic, supports OpenAI, Anthropic, OpenRouter, etc. |
| Durable Execution | Mastra workflows in code; Inngest / Trigger.dev evaluated for Phase 2 | Multi-step orchestration |
| Observability | `@mastra/observability` with `DefaultExporter` + `SensitiveDataFilter`, optional Langfuse | Tracing, redaction |
| Evaluations | `@mastra/evals` | Built-in scorers |
| MCP Integration | Mastra MCP client (stored MCP connections) | Dynamic tool acquisition without code changes |
| Validation | Zod | Schema validation for all tool inputs/outputs and API boundaries |
| Chat UI | `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` + `@assistant-ui/react-streamdown` (built on Vercel AI SDK + `streamdown`) | Single library for every LLM chat surface in the app — per-agent chat, onboarding bootstrap, future surfaces |

**Explicitly not used:** Convex, LibSQL (no degraded local fallback), Vercel Chat SDK, Doppler, Composio (Phase 1), separate API service.

**One architectural path, identical in dev and prod.** Local development uses `npx supabase start`, which boots the entire Supabase stack (Postgres + GoTrue Auth + MinIO Storage + pgvector + pgsodium/Vault) on the developer's machine via Docker. The same `@mastra/pg` and `@mastra/s3` providers are wired against `127.0.0.1` URLs locally and against `*.supabase.co` URLs in production — no `if (mode === 'local')` branches anywhere in the codebase. Docker is a hard prerequisite for working on MastraClaw. See `ARCHITECTURE.md` §3.3.

## Architecture (Summary)

> Full version in [`ARCHITECTURE.md`](./ARCHITECTURE.md). This is the elevator pitch.

```
┌──────────────────────────────────────────────────────────────┐
│   Vercel / Railway — Next.js 16 + Mastra (one process)        │
│                                                                │
│   Server-only:  Server Components │ Route Handlers │ Actions  │
│                          │              │             │       │
│                          └──────────────┴─────────────┘       │
│                                    │                          │
│                       mastraFor(currentUser)                   │
│                  (role-aware: user vs admin facade)            │
│                                    │                          │
│       ┌────────────────────────────┴──────────────────┐       │
│       │            Mastra (in-process)                 │       │
│       │  Main Agent ──delegates──▶ Sub Agents          │       │
│       │       ▲                         ▲              │       │
│       └───────┼─────────────────────────┼──────────────┘       │
│               │                         │                      │
│   Bindings table routes channels → agents (Postgres)           │
│       │                         │                              │
│   Telegram main bot         Telegram per-agent bots             │
│   Web UI default chat       Voice / email / etc. (later)        │
│                                                                │
│   Layer A bootstrap secrets in process.env (~5 values)         │
└─────────────────────────────┬─────────────────────────────────┘
                              │ Postgres + S3 over TLS
                              ▼
┌──────────────────────────────────────────────────────────────┐
│   Supabase                                                     │
│                                                                │
│   Postgres (via @mastra/pg, RLS on every tenant table)         │
│     ├ Mastra Storage (agents, prompts, skills, mcp, scorers)   │
│     ├ pgvector (semantic recall, RAG)                          │
│     ├ vault.secrets (per-user secrets — Layer B)               │
│     └ App tables (bindings, user settings)                     │
│                                                                │
│   Storage (S3-compatible, via @mastra/s3)                      │
│     └ users/{userId}/agents/{agentId}/  ← workspaces           │
│                                                                │
│   Auth (magic link / OAuth)                                    │
└──────────────────────────────────────────────────────────────┘
```

**Key patterns:**

- **Server-only execution boundary (CRITICAL).** Mastra, secrets, LLM keys, and any privileged code live exclusively in Server Components, Route Handlers, and Server Actions. **Never** in Client Components, never in browser bundles, never in `NEXT_PUBLIC_*` env vars. Importing `@/mastra` or `@mastra/*` in a `'use client'` file is a security incident. CI must enforce this.

- **Multi-tenant and role-aware from day one.** Every database row carries an owner. Every authenticated user has a role (`'user'` or `'admin'`). The data model, the authorization layer, and the RLS policies assume multiple users in multiple roles — Phase 1 just happens to ship with one user (Patrick) holding the `admin` role. There are no single-user or single-role shortcuts anywhere.

- **`mastraFor(currentUser)` factory.** Application code never calls `mastra.editor.*` directly. It calls `mastraFor(currentUser)` where `currentUser` is `{ userId, email, role }` returned by `getCurrentUser()`. The factory dispatches to either `userMastra(userId)` (filtered by `authorId`, ownership asserted on every read/write) or `adminMastra(userId)` (unfiltered, plus admin-only operations like `listAllUsers`, `setUserRole`, `impersonate`). Both facades expose the same agent/prompt/skill/mcp/scorer/workspace/invoke surface; admin-only operations live only on the admin facade. The raw `mastra` instance is reserved for `src/mastra/index.ts` and the factory itself. A grep for `mastra.editor.` outside `src/mastra/lib/mastra-for.ts` is a red flag and CI must fail.

- **Roles via `app_metadata`, never `user_metadata`.** Roles live in `auth.users.raw_app_meta_data.role` (app-controlled, only writable by service-role). The user cannot promote themselves. Server reads the role from `getCurrentUser()`; clients must never send a role from the browser. Authorization decisions happen at the boundary of every Server Action / Route Handler with an explicit `if (currentUser.role !== 'admin') throw new AdminRequiredError()` check before calling admin-only logic.

- **Defense in depth with role-aware Postgres RLS.** On top of `mastraFor`, every Mastra storage table and every app table has Row-Level Security policies of the form `using (author_id = auth.uid()::text or auth.role() = 'admin')`. The `auth.role()` SQL helper reads `auth.jwt() -> 'app_metadata' ->> 'role'`. Two independent layers — a bug in the factory still cannot leak data, and an admin policy still cannot accidentally let users see each other's rows.

- **Main Agent + Sub Agents with bindings-based routing.** The Main Agent handles general traffic on the default Telegram bot and Web UI. Sub-agents are reachable both indirectly (via Main Agent delegation) and directly (via dedicated Telegram bots whose tokens are stored in Vault and mapped via the `bindings` table). Adding a new direct sub-agent bot requires zero code: bot token in Vault + row in `bindings` + webhook registration.

- **Code vs. Data — strict separation.** Workflows, code-defined tools, channel adapters, providers, the Main Agent, and any TypeScript live in Git and ship via redeploy. Stored agents, prompt blocks, skills (Markdown content), MCP connections, scorers, memory, conversations, and secrets live in Supabase and change at runtime via the web UI. No redeploy for the latter.

- **Workflows-as-Tools.** Complex multi-step operations are coded as Mastra workflows and exposed as single tools to agents.

- **Scoped Tool Assignment.** Each agent receives only the tools it actually needs. No tool bloat across agents.

- **Human-in-the-Loop.** No destructive action without user approval. Mastra's suspend/resume enables approval gates at any workflow step. Approval requests propagate: sub-agent → main agent → user channel (Telegram / Web UI). Configurable trust levels per action type.

- **4-Tier Memory.** Message History → Working Memory → Observational Memory → Semantic Recall.

- **Disposable infrastructure.** The compute container holds no persistent state. Killing it and recreating it is a no-op. All state is in Supabase. Backup = `pg_dump` + `aws s3 sync`. Restore = new project + `psql < dump.sql`.

## Mastra Studio

Mastra Studio is the built-in development UI available at `http://localhost:4111` during `npm run dev`. It provides:
- **Agent Testing** — Interactive chat with agents, inspect tool calls, view memory state
- **Workflow Debugging** — Step-by-step execution visualization, inspect inputs/outputs per step, retry failed steps
- **Tool Management** — Test tools in isolation, view execution logs
- **Trace Viewer** — Full observability into agent reasoning chains, latencies, and token usage
- **Memory Inspector** — View and manage threads, working memory, and semantic recall entries

Studio is the primary development and debugging surface — use it before deploying to production.

## Memory Architecture

Mastra provides a comprehensive 4-tier memory system, managed via processors:

| Tier | Processor | Purpose |
|------|-----------|---------|
| Message History | `MessageHistoryProcessor` | Sliding window of recent messages per thread |
| Working Memory | `WorkingMemoryProcessor` | Structured key-value state persisted across turns (agent "scratchpad") |
| Observational Memory | `ObservationalMemory` | Agent autonomously stores and retrieves facts it notices during conversations |
| Semantic Recall | `SemanticRecallProcessor` | Vector-similarity search across past messages and knowledge |

Memory is provider-agnostic — storage backends are configurable (Convex, Postgres, LibSQL, MongoDB). All memory tiers are agentically controllable: agents can read, write, and search their own memory.

## Integrated RAG & Knowledge

Mastra includes a full RAG pipeline (`@mastra/rag`):
- **Document Processing** — Chunking, metadata extraction, embedding generation
- **Vector Stores** — Configurable backends (Convex vector search, Pinecone, pgvector, etc.)
- **Graph RAG** — Relationship-based retrieval across entities
- **Reranking** — Score-based and model-based reranking for precision
- **Knowledge Base / Folders** — Structured document collections indexable via Convex with semantic search + full-text search

All data in Convex is searchable by default — both semantic (vector) and full-text search — and agentically queryable. The architecture is designed so data is accessible not just through this agent but also via MCP Server for external tools (Claude Code, Claude Cowork, other MCP clients).

## MCP Server & Client Integration

Mastra supports both sides of the Model Context Protocol:
- **MCP Server** (`reference/tools/mcp-server`) — Expose Mastra agents, tools, and data as MCP endpoints for external consumption (Claude Code, Claude Cowork, IDEs)
- **MCP Client** (`reference/tools/mcp-client`) — Connect to external MCP servers to extend agent capabilities
- **[Composio.dev](https://composio.dev)** — Aggregator for bundling multiple MCP servers with unified secrets management and authentication
- Other MCP aggregators are supported for tool federation

## Observability

Mastra integrates with industry-standard observability platforms via OpenTelemetry-based tracing:
- **Langfuse** — Open-source LLM observability, traces, scoring, prompt management
- **Langsmith** — LangChain's tracing and evaluation platform
- **Custom OpenTelemetry exporters** — Any OTel-compatible backend
- **SensitiveDataFilter** — Redacts credentials and PII from traces before export
- Traces cover the full agent lifecycle: LLM calls, tool executions, memory operations, workflow steps

## Evaluations & Testing

Mastra provides built-in evaluation scorers (`@mastra/evals`) for production-grade agent quality assurance:

| Category | Scorers |
|----------|---------|
| Relevance & Accuracy | `AnswerRelevancy`, `AnswerSimilarity`, `Faithfulness`, `Completeness` |
| Safety | `Toxicity`, `Bias`, `Hallucination` |
| RAG Quality | `ContextPrecision`, `ContextRelevance`, `NoiseSensitivity` |
| Agent Behavior | `ToolCallAccuracy`, `TrajectoryAccuracy`, `PromptAlignment` |
| Content | `ContentSimilarity`, `TextualDifference`, `KeywordCoverage`, `ToneConsistency` |
| Custom | `createScorer()` for project-specific evaluation criteria |

Evals are designed to run in CI/CD pipelines, enabling automated regression testing of agent behavior before deployment.

## Durable Execution

For long-running, mission-critical workflows that require resilience beyond Mastra's built-in workflow engine:

### Inngest (`@mastra/inngest`)
- Each Mastra workflow maps directly to an Inngest function, each step to an Inngest step
- Step-level memoization — on retry/resume, completed steps are skipped
- Suspend/resume with real-time monitoring via Inngest dashboard
- `serve()` bridges Mastra workflows to Inngest's event-driven execution

### Vercel Workflows / Workflow SDK ([useworkflow.dev](https://useworkflow.dev))
- `"use workflow"` directive compiles durability into TypeScript functions
- Suspend & resume with zero resource consumption while waiting
- Framework-agnostic (Next.js, Astro, Express, Hono, SvelteKit, etc.)
- Built-in observability with traces, logs, and step-level time-travel debugging

Both options are complementary to Mastra's native workflows — use them for external orchestration, human-in-the-loop, or workflows spanning hours/days.

## Project Structure

Single Next.js application — no monorepo, no separate API service.

```
mastra-claw/
├── ARCHITECTURE.md                   # Authoritative architecture (read first)
├── CLAUDE.md                         # This file — coding conventions
├── REQUIREMENTS.md                   # Product-level requirements
├── README.md
├── package.json
├── tsconfig.json
├── next.config.ts                    # serverExternalPackages: ['@mastra/*']
├── .env.local                        # Layer A bootstrap secrets only
│
├── supabase/
│   └── migrations/                   # SQL migrations: RLS, app tables, indexes
│
├── src/
│   ├── mastra/
│   │   ├── index.ts                  # The Mastra instance (single export)
│   │   ├── agents/
│   │   │   ├── main-agent.ts         # The Main Agent (code-defined)
│   │   │   └── sub/                  # Code-defined sub-agents
│   │   ├── workflows/                # Code-only workflows
│   │   ├── tools/                    # Code-defined tools
│   │   ├── scorers/                  # Evaluation scorers
│   │   ├── skills/
│   │   │   └── built-in/             # Markdown skills shipped by default
│   │   └── lib/
│   │       ├── mastra-for.ts         # Role-aware factory (NEVER bypass)
│   │       ├── secret-service.ts     # Vault-backed per-user secrets
│   │       └── errors.ts
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── server.ts             # Server-only Supabase client
│   │   │   └── client.ts             # Browser client (no Mastra ever)
│   │   ├── channels/
│   │   │   ├── router.ts             # Bindings resolution
│   │   │   ├── dispatch.ts           # Hands resolved agent to mastraFor(currentUser)
│   │   │   └── telegram/             # Telegram in/out adapter
│   │   └── auth.ts                   # getUserId() helper
│   │
│   ├── app/
│   │   ├── (auth)/login/page.tsx     # Supabase Auth UI
│   │   ├── (app)/                    # Authenticated pages (Server Components)
│   │   │   ├── chat/page.tsx         # Web chat with the Main Agent
│   │   │   ├── agents/page.tsx       # Agent management
│   │   │   ├── skills/page.tsx       # Skill management
│   │   │   └── settings/             # Settings + setup wizard
│   │   ├── api/
│   │   │   ├── chat/route.ts         # Server-only: invokes mastraFor(currentUser)
│   │   │   ├── telegram/[bot]/route.ts  # Telegram webhook (per bot)
│   │   │   └── ...
│   │   ├── layout.tsx
│   │   └── globals.css
│   │
│   └── components/                   # UI components — pure presentation
│       └── ...
│
└── public/
```

**Critical rule:** any file under `src/components/` or any file with `'use client'` directive **must not** import from `@/mastra` or `@mastra/*`. Server-only logic stays in `src/mastra/**`, `src/app/**/page.tsx`, `src/app/**/route.ts`, and Server Action files. CI enforces this.

## Coding Conventions

### TypeScript
- **Strict mode** always enabled (`"strict": true`)
- **No `any`** — use `unknown` and narrow with type guards, or define proper types
- **Zod schemas** for all external boundaries (tool inputs/outputs, workflow steps, API responses)
- **Named exports** preferred over default exports
- **Barrel exports** (`index.ts`) for each module directory

### Model-Agnostic Patterns
- Never hardcode model names — always use environment variables
- Use the pattern: `process.env.ORCHESTRATOR_MODEL || 'anthropic/claude-sonnet-4-20250514'`
- Sub-agents should default to cheaper models: `process.env.SPECIALIST_MODEL || 'anthropic/claude-haiku-4-5-20251001'`
- All model references go through Vercel AI SDK's model routing
- Supports: Vercel AI Gateway, OpenRouter, all major cloud providers, and private/on-premise model APIs

### API Route Boundary
Every authenticated route under `src/app/api/` MUST go through `withAuthenticatedRoute` from `@/app/api/_lib`. This single chokepoint handles:
- `getCurrentUser()` → 401 if missing
- Optional `requireAdmin: true` → 403 via `AdminRequiredError`
- `mastraFor(user)` facade construction
- Optional `requireProfile: true` → 409 via `ProfileRequiredError`
- Optional `bodySchema` (Zod) → 400 with issue details
- Centralized error mapping via `toErrorResponse` (`AppNotConfiguredError` → 503, `WorkspacePathError` → 400, `WorkspaceNotConfiguredError` → 503, `ZodError` → 400, fallthrough → 500)

```ts
export const GET = withAuthenticatedRoute<{ agentId: string }>({
  handler: async ({ facade, params }) => {
    const agent = await facade.agents.get(params.agentId);
    if (!agent) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json({ agent });
  },
});
```

Direct calls to `getCurrentUser()` or `mastraFor()` from inside a route handler are a code smell — review and convert. The only sanctioned exceptions are unauthenticated webhook receivers (Telegram, etc.) and the onboarding bootstrap routes that run before the user has a profile.

### Language Model Instantiation
There is exactly one path to obtain a Vercel AI SDK `LanguageModel` in MastraClaw:

```ts
const model = await mastraFor(user).getLanguageModel();
// or, when called from inside a Mastra agent's model resolver:
import { resolveLanguageModel } from '@/mastra/lib/resolve-language-model';
model: ({ requestContext }) => resolveLanguageModel(llm),
```

Both go through `src/mastra/lib/resolve-language-model.ts`, which uses per-call provider factories (`createAnthropic({ apiKey })`, `createOpenAI({ apiKey })`, etc.) so nothing ever touches `process.env`. This is the only race-safe pattern under concurrent traffic with different per-user keys.

**NEVER** import the global provider singletons (`anthropic`, `openai`, `gateway` from `@ai-sdk/*`) as values, and **NEVER** assign API keys into `process.env`. Both patterns are sources of cross-tenant key leakage and are forbidden by the Do NOT section. Type-only imports (`type LanguageModel`) remain allowed.

### Small Codebase Philosophy
- The core codebase must stay minimal — complexity lives in frameworks and packages
- New capabilities are added as workflows, tools, and skills — not as core code changes
- Upstream updates should be dependency bumps, not source code rewrites
- If a package or framework provides a feature, use it — don't reimplement

### Reuse Mastra Types — Don't Invent Parallel DTOs
Across the Mastra-facing service layer (`src/mastra/lib/agents-service.ts`, `workspace-service.ts`, the `mastraFor()` facade in `mastra-for.ts`, anywhere that touches `mastra.listAgents()`, `Memory`, `Workflow`, …), **reuse the types exported by `@mastra/core/*` and `@mastra/memory` directly**. Do not introduce parallel types like `AgentSummary`, `AgentDetail`, `AgentThread`, `AgentUIMessage`, etc. when an upstream shape is usable.

Concretely:
- `findAgentById(id)` and the facade's `agents.get(id)` return the actual `Agent` instance from `@mastra/core/agent`, never `any` and never a wrapper interface.
- Memory thread reads return `StorageThreadType` from `@mastra/core/memory`. Memory message reads return `MastraDBMessage[]` (also from `@mastra/core/agent`) at the storage boundary, converted to `UIMessage` from `ai` at the chat-UI boundary.
- For chat-UI message shapes, use `UIMessage` from `ai` — that's what `useChatRuntime` consumes via `@assistant-ui/react-ai-sdk`, so a single canonical type flows from Mastra DB → server conversion → chat client.
- Workspace operations use `S3Filesystem` / Mastra workspace types from `@mastra/core/workspace`, not `any` casts.
- The same rule applies inside the `mastraFor()` facade itself: prefer Mastra-typed return values over hand-rolled wrappers.

A custom narrow DTO is only acceptable when the **UI genuinely needs less than what Mastra returns AND exposing the full type would force the client to know about server-only fields**. In that case the DTO is a `Pick<MastraType, ...>` of the upstream type, not a hand-rolled interface. When in doubt, check the existing example: `src/mastra/lib/agents-service.ts` is the reference implementation — if you find yourself adding `eslint-disable @typescript-eslint/no-explicit-any`, you're doing it wrong; import the right Mastra type instead.

**Why:** Custom DTOs drift from upstream. Every Mastra version bump becomes a manual reconciliation pass and a class of silent-corruption bugs at the persistence boundary. `@mastra/core` is the contract; mirror it instead of paraphrasing it.

### Agent Definitions
```typescript
// Always define agents with:
// 1. Unique ID
// 2. Clear instructions (concise, not LLM-generated)
// 3. Memory enabled
// 4. Zod-validated tools
// 5. Sub-agents and/or workflows where applicable

const agent = new Agent({
  id: 'agent-name',
  model: process.env.ORCHESTRATOR_MODEL || 'anthropic/claude-sonnet-4-20250514',
  memory: new Memory(),
  instructions: '...',
  tools: { ... },
  agents: { ... },        // sub-agents
  workflows: { ... },     // workflows-as-tools
});
```

### Workflow Definitions
```typescript
const step = createStep({
  id: 'step-name',
  description: 'What this step does',
  inputSchema: z.object({ ... }),
  outputSchema: z.object({ ... }),
  execute: async ({ inputData, mastra }) => { ... },
});

const workflow = createWorkflow({
  id: 'workflow-name',
  inputSchema: z.object({ ... }),
  outputSchema: z.object({ ... }),
})
  .then(step1)
  .then(step2);

workflow.commit(); // Required — always call commit()
```

### Tool Definitions
```typescript
const tool = createTool({
  id: 'tool-name',
  description: 'Clear description for the agent',
  inputSchema: z.object({ ... }),
  outputSchema: z.object({ ... }),
  execute: async (input) => { ... },
});
```

### Chat UI
- **One library, one way.** Every LLM chat surface — per-agent chat, the onboarding bootstrap interview, any future chat-shaped UI — uses `@assistant-ui/react` with `useChatRuntime` from `@assistant-ui/react-ai-sdk`. Custom JSX wraps `ThreadPrimitive` / `ComposerPrimitive` / `MessagePrimitive` for layout and styling. assistant-ui sits on top of the Vercel AI SDK and `streamdown`, so the Vercel-first primitive rule still holds.
- Render assistant text via `MarkdownText` (`src/components/assistant-ui/markdown-text.tsx`), which is backed by `@assistant-ui/react-streamdown` + `streamdown` plugins (`@streamdown/code`, `@streamdown/mermaid`). Code highlighting and mid-stream tolerance are consistent everywhere.
- Reference implementation: `src/components/agent/agent-chat.tsx`.
- The transport (`AssistantChatTransport`) can target either a Mastra agent route (`handleChatStream` from `@mastra/ai-sdk`, see `src/app/api/agents/[agentId]/chat/route.ts`) or a plain `streamText` route that emits an AI SDK v6 UI message stream (see `src/app/api/onboarding/bootstrap/route.ts`). Both shapes are supported by the same client.

## Commands

```bash
# One-time setup (after clone)
npx supabase start       # boots local Postgres + Auth + Storage + Studio via Docker (~30s first run)
cp .env.local.example .env.local   # already points at the local Supabase URLs/keys printed by `supabase start`
npx supabase db push     # runs SQL migrations into the local Postgres

# Development
npm run dev              # Next.js dev server (Mastra is embedded, not a separate process)
npm run dev:studio       # Mastra Studio (separate dev process, same DB) at http://localhost:4111

# Local Supabase lifecycle
npx supabase status      # show URLs / keys / health
npx supabase stop        # tear down the local stack
npx supabase db reset    # nuke + re-migrate the local DB

# Build & run
npm run build            # next build
npm run start            # next start

# Lint
npm run lint
```

Docker must be installed and running. The local Supabase stack provides the same Postgres + GoTrue + Storage + pgvector + pgsodium environment as production, so RLS, Vault, role-aware auth, and `@mastra/s3` work identically in dev and prod.

## Backup & Restore

The compute layer holds **no persistent state**. Every byte that matters lives in Supabase. This is a deliberate architectural decision so backups are simple and the server is disposable.

**Backup set:**
- `pg_dump` of Supabase Postgres → captures Mastra state, app tables, embeddings, and Vault ciphertexts (Vault secrets are encrypted at rest inside the dump — the encryption key never touches the file)
- `aws s3 sync` of the Supabase Storage bucket → captures workspace files, skill content, generated artifacts
- Layer A bootstrap secrets (~5 values) backed up separately in 1Password / Bitwarden

**Daily backup (sketch):**
```bash
pg_dump --no-owner --no-acl "$DATABASE_URL" | gzip > "backup-$(date +%F).sql.gz"
aws s3 sync "s3://workspaces" "./backup-storage-$(date +%F)/" \
  --endpoint-url "https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/s3"
rclone copy ./backup-* "$OFFSITE_REMOTE:mastra-claw-backups/"
```

**Restore (sketch):**
```bash
gunzip -c backup-2026-04-08.sql.gz | psql "$NEW_DATABASE_URL"
aws s3 sync ./backup-storage-2026-04-08/ "s3://workspaces" \
  --endpoint-url "https://${NEW_PROJECT_REF}.supabase.co/storage/v1/s3"
# update host env vars with new Supabase credentials
# redeploy from Git
```

**Rules for code that touches the backup story:**
- Never introduce a second persistence layer (no SQLite alongside Postgres, no local file cache that holds canonical state, no in-memory state that survives across requests as source-of-truth).
- Never store secrets in env vars when they could go in Vault — env vars are not in the Postgres dump.
- Never write workspace files outside the S3-backed `Workspace` filesystem; local-disk writes are lost on every redeploy.
- New tables in Supabase migrations must work with `pg_dump`/`psql` restore out of the box. No exotic Postgres features that break dump/restore.
- The restore drill is part of the operations runbook (`docs/runbook-restore.md`) and runs quarterly.

Full backup architecture, rationale, and integrity-test procedure: [`ARCHITECTURE.md`](./ARCHITECTURE.md) §12.

## Environment Variables — Layer A (Bootstrap Only)

These are the **only** secrets that live in `process.env`. Everything else is per-user, lives in Supabase Vault, and is read at runtime via `SecretService`.

The same set of variables is used in development (pointing at the local Supabase started by `npx supabase start`) and in production (pointing at the cloud project). There is no mode switch.

```bash
# === Supabase (mandatory) ===
DATABASE_URL=                       # postgres://... full Postgres connection
                                    # local: postgresql://postgres:postgres@127.0.0.1:54322/postgres
                                    # prod:  postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
SUPABASE_URL=                       # local: http://127.0.0.1:54321
                                    # prod:  https://<ref>.supabase.co
SUPABASE_ANON_KEY=                  # anon key for client-side Supabase Auth
SUPABASE_SERVICE_ROLE_KEY=          # service role key — server-side only, NEVER NEXT_PUBLIC_
SUPABASE_S3_ENDPOINT=               # local: http://127.0.0.1:54321/storage/v1/s3
                                    # prod:  https://<ref>.supabase.co/storage/v1/s3
SUPABASE_S3_ACCESS_KEY_ID=          # for @mastra/s3 against Supabase Storage
SUPABASE_S3_SECRET_ACCESS_KEY=      # for @mastra/s3 against Supabase Storage

# === Optional: model defaults (override via stored agent config) ===
MAIN_AGENT_MODEL=                   # e.g., anthropic/claude-sonnet-4-5
SPECIALIST_MODEL=                   # e.g., anthropic/claude-haiku-4-5
```

The local Supabase values are printed by `npx supabase start` and rarely change. Copy them once into `.env.local` and forget about them.

**Forbidden:**
- `NEXT_PUBLIC_*` for any of the above. The service role key in particular must never reach the browser.
- LLM provider API keys in env vars. They go in Vault, scoped per user. The user enters them in the setup wizard on first login.
- Telegram bot tokens in env vars. They go in Vault, scoped per user.
- Any other "user-level" secret in env vars.

This separation is documented in detail in `ARCHITECTURE.md` §11 (Secrets — Two Layers).

## Security & Compliance

### Security Rules
1. **Separate compute contexts** — Agent harness (trusted, has secrets) and sandbox (untrusted code execution, no secret access) must be separate
2. **No secrets in agent context** — Agents must never see raw API keys. Use proxy-based secret injection
3. **SensitiveDataFilter** — Always enable in observability to redact credentials from traces
4. **User authentication** — Validate channel user IDs before processing messages
5. **Workspace isolation** — Each agent workspace is sandboxed (LocalSandbox, E2B, Daytona, or Vercel)

### Guard Rails & Processors
Mastra provides configurable processors that run before/after every agent request:

| Processor | Purpose |
|-----------|---------|
| `PIIDetector` | Detects and redacts PII (email, phone, SSN, credit cards, etc.). Strategies: `block`, `warn`, `filter`, `redact`. Redaction methods: `mask`, `hash`, `remove`, `placeholder`. GDPR/CCPA/HIPAA compliant. |
| `PromptInjectionDetector` | Detects and blocks prompt injection attempts before they reach the agent |
| `ModerationProcessor` | Content moderation for harmful, toxic, or inappropriate content |
| `SystemPromptScrubber` | Prevents system prompt leakage in agent responses |
| `UnicodeNormalizer` | Normalizes Unicode to prevent homoglyph and encoding-based attacks |
| `TokenLimiterProcessor` | Enforces token budgets per request |

Processors are composable and can be stacked. Apply them as input processors (pre-request) and/or output processors (post-response).

### Compliance
- **GDPR/DSGVO** — All components self-hostable, no data leaves infrastructure unless configured. Sensitive data filtering in observability. PII detection and redaction via `PIIDetector` processor with configurable redaction strategies.
- **SOC 2** — Audit logging via observability, RBAC-ready, encrypted data, separate compute contexts, full agent action tracing.
- **HIPAA** — On-premise deployment with self-hosted models for PHI isolation. Workspace sandboxing for process-level isolation. `PIIDetector` supports HIPAA-relevant data types.
- Every deployment option (cloud, hybrid, private cloud, full on-premise) uses the same codebase.

## Do NOT

### Security boundary (highest priority)
- **NEVER import `@/mastra` or `@mastra/*` in any file with `'use client'`.** Mastra is server-only. CI must enforce this.
- **NEVER use `NEXT_PUBLIC_*` for anything secret.** Service role keys, LLM API keys, bot tokens, S3 secrets — none of these may ever reach the browser.
- **NEVER call LLM providers or execute Mastra code from a Client Component.** Client → Server Action / Route Handler → Mastra. Always.
- **NEVER store user secrets (LLM keys, bot tokens, etc.) in env vars.** They go in Supabase Vault, scoped per user via `SecretService`.

### Multi-tenancy & roles (foundation)
- **NEVER call `mastra.editor.*` directly from application code.** Always go through `mastraFor(currentUser)`. The raw instance is reserved for `src/mastra/index.ts` and the factory itself. CI greps for violations.
- **NEVER hardcode `userId = 'patrick'`, `role = 'admin'`,** or any other constant identity. Always derive from Supabase Auth via `getCurrentUser()`.
- **NEVER trust a role sent from the client.** The role lives in the JWT (`app_metadata.role`) and is read server-side from `getCurrentUser()`. Anything the browser claims about its own role is cosmetic at best, dangerous at worst.
- **NEVER store the role in `user_metadata`.** User metadata is user-controlled — they could promote themselves. Roles go in `app_metadata`, only writable by the service-role client.
- **NEVER set `app_metadata.role` from a client component or without admin-role check.** Role assignment happens only in admin Server Actions that explicitly verify `currentUser.role === 'admin'` first.
- **NEVER add a new Supabase table without role-aware RLS policies.** Every tenant-owned table gets `enable row level security` plus a `using (author_id = auth.uid()::text or auth.role() = 'admin')` policy. CI grep enforces both halves.
- **NEVER list/get/update/delete a Mastra resource without going through `mastraFor`.** The factory adds the `authorId` filter for users and skips it for admins; bypassing it is a defense-in-depth violation even when RLS would still catch it.
- **NEVER perform an admin-only operation without an explicit `if (currentUser.role !== 'admin') throw new AdminRequiredError()` check** at the entry of the Server Action / Route Handler. The factory will already gate the implementation, but the explicit check makes intent visible at the call site.

### Architecture
- **Don't rebuild what Mastra provides** — use built-in memory, storage, observability, editor, workspace. No custom implementations.
- **Don't reintroduce a separate API service.** Mastra is embedded in Next.js. There is no `apps/api` and no `@mastra/client-js` in the application path.
- **Don't add new persistence layers.** All state is Supabase. No SQLite, no local files, no Redis-as-source-of-truth, no second database.
- **Don't write code that requires the agent to dynamically load TypeScript at runtime.** Workflows and tools are code, in-repo. Skills, agents, prompts, and MCP connections are data. The line is hard.

### Code quality
- **Don't use `any` type.** Use `unknown` and narrow with type guards, or define proper types.
- **Don't skip Zod schemas.** Every tool, workflow step, and API boundary needs schema validation.
- **Don't hardcode model names.** Always use env vars with sensible defaults, or load from the stored agent config.
- **Don't give agents unnecessary tools.** Scoped tool assignment. No tool bloat.
- **Don't create role-based sub-agents** as a substitute for context firewalls. Use fresh contexts per task where appropriate.
- **Don't write verbose agent instructions.** Concise, human-written instructions outperform long LLM-generated ones (ETH Zurich finding).
- **Don't skip `workflow.commit()`.** Every workflow definition must call `.commit()` after the step chain.
- **Don't introduce a second chat UI library.** No `useChat` from `@ai-sdk/react` in client components, no `ai-elements` shadcn registry, no hand-rolled message lists. Every chat surface uses `@assistant-ui/react` per the "Chat UI" convention above. (Server routes may still use `streamText` from `ai` — that's a primitive, not a UI choice.)
- **NEVER instantiate language models directly.** All `LanguageModel` instances must come from `mastraFor(user).getLanguageModel()` or, inside a Mastra agent's model resolver, `resolveLanguageModel(llm)` from `@/mastra/lib/resolve-language-model`. Direct value imports of `anthropic()`, `openai()`, `gateway()`, etc. from `@ai-sdk/*` are a security smell — they invariably lead to `process.env` mutation for API keys, which breaks per-request isolation under concurrent user sessions and can leak keys across tenants. Type-only imports (`type LanguageModel`) remain allowed.
- **NEVER assign API keys into `process.env`.** No `process.env.ANTHROPIC_API_KEY = ...`, `process.env.OPENAI_API_KEY = ...`, `process.env.AI_GATEWAY_API_KEY = ...`, or `process.env.OPENAI_BASE_URL = ...` anywhere in `src/`. The provider factories accept `apiKey` as a constructor argument — use that path. CI must grep for and reject these assignments.
- **Don't bypass `withAuthenticatedRoute`.** Every authenticated route under `src/app/api/` must use the boundary helper from `@/app/api/_lib`. Direct calls to `getCurrentUser()` or `mastraFor()` from inside a route handler are a code smell. The only exceptions are unauthenticated webhooks and the onboarding bootstrap routes (which run before the user has a profile).
