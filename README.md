<p align="center">
  <img src="assets/header.png" alt="MastraClaw" width="800">
</p>

<p align="center">
  <strong>Enterprise-ready personal AI agent. Built on frameworks, not from scratch.</strong>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a>&nbsp; · &nbsp;
  <a href="#architecture">Architecture</a>&nbsp; · &nbsp;
  <a href="#tech-stack">Tech Stack</a>&nbsp; · &nbsp;
  <a href="#deployment">Deployment</a>&nbsp; · &nbsp;
  <a href="./ARCHITECTURE.md">Full Architecture</a>
</p>

---

> [!IMPORTANT]
> **Status: Draft / Work in Progress**
> This project is currently **not functional**. It is in draft status and will be actively developed over the coming weeks.

> **Architectural decisions live in [`ARCHITECTURE.md`](./ARCHITECTURE.md).** This README is the elevator pitch and the on-ramp; the architecture document is the source of truth for the single-process embedding model, the Supabase backend, multi-tenancy, role-based authorization, the server-only execution boundary, the Main Agent + Sub Agents model, channel bindings, secrets management, and backup procedures.

## Why MastraClaw

There's no shortage of personal AI agents. Since OpenClaw, the space has exploded with projects promising autonomous assistants that can do everything. They all share the same fatal flaw: **they rebuild everything from scratch**.

Custom memory systems. Custom workflow engines. Custom security layers. Agents that rewrite their own source code. The result is fragile software with hundreds of thousands of lines of code, dozens of dependencies, and security models that exist only at the application level.

**MastraClaw takes the opposite approach.** Instead of building yet another framework, we compose battle-tested, enterprise-backed components into an opinionated base configuration:

- **Mastra.ai** handles agents, workflows, memory, tools, observability, the Editor (CMS-style runtime resource management), workspaces, and sandboxing — backed by the Gatsby.js founders, funded by Paul Graham and Guillermo Rauch, used in production by Replit and Marsh McLennan.
- **Supabase** is the single managed backend: Postgres for Mastra Storage and app data, pgvector for embeddings, Storage (S3-compatible) for workspaces, GoTrue for Auth, Vault (`pgsodium`) for encrypted user secrets. All open source (Apache 2.0), all self-hostable.
- **Next.js 16** is the application host. Mastra is **embedded** as a TypeScript import — no separate API service, no `@mastra/client-js` in the application path, no HTTP hop. One process, one deployment, one set of environment variables.

The goal is not another feature-rich agent. It's a **minimal, curated foundation** that you extend with your own workflows and customizations — and that holds its security guarantees in production.

## Philosophy

**Enterprise-ready from day one.** Multi-tenancy, role-based authorization, observability, secrets management, encrypted backups — not bolted on later, but architectural decisions from the start. Even in Phase 1 with a single user, the data model, RLS policies, and authorization layer are written for many users in multiple roles. Adding user #2 later is a switch flip, not a refactor. Every component is self-hostable for data sovereignty.

**Server-only execution boundary.** The Mastra instance, all secrets, and every LLM API call live exclusively on the server side of Next.js — Server Components, Route Handlers, Server Actions. **Never** in Client Components, never in browser bundles, never in `NEXT_PUBLIC_*` env vars. CI enforces this. A leaked LLM key does not just leak credentials — it leaks billing, and for a Personal Agent that holds your most sensitive data, the same applies to memory and integration tokens. Server-only is the entry-level cost of building this kind of system responsibly.

**Frameworks over features.** Don't rebuild what enterprise-grade frameworks already provide. Mastra's memory system scores 94.87% on LongMemEval. Its observability includes sensitive data filtering. Its sandbox supports 5 providers. Its Editor manages stored agents, prompts, skills, MCP connections, and scorers with full versioning. Use it.

**Hybrid architecture.** Three paradigms, one system. Agent skills for flexibility. Coded workflows for reliability. A Main Agent that orchestrates and delegates to sub-agents. The right tool for each task, not one paradigm forced onto everything.

**Main Agent + Sub Agents with bindings-based routing.** One Main Agent owns the default Telegram bot, the default Web UI chat, and the default voice interface — and conceptually plays the orchestrator role. Sub-agents are reachable both **indirectly** (through Main Agent delegation) and **directly** (each sub-agent can have its own Telegram bot, with routing configured in a `bindings` table — no code change to add a new direct sub-agent channel).

**Model-agnostic.** No vendor lock-in. Swap Claude for GPT for Llama for Mistral for self-hosted open-source models — the agent logic stays the same. Mastra's built-in model router uses `provider/model-name` strings and supports all major providers, OpenRouter, and private/on-premise APIs. Main Agent uses a strong model, sub-agents use cheap ones. Configure via stored agent definitions or environment defaults.

**Disposable infrastructure.** The compute container holds zero persistent state. Killing it and recreating it is a no-op. All state lives in Supabase. Backup = `pg_dump` + `aws s3 sync`. Restore = new project + `psql` + redeploy. Under 15 minutes end-to-end.

**Start simple, scale when needed.** MastraClaw starts as a personal agent for one person — a founder, a department lead, an entrepreneur. But the architecture supports progressive evolution: more sub-agents, more channels, more users, eventually department-level orchestration. The core codebase stays small because complexity lives in the frameworks and packages, not in your code.

**Opinionated but extensible.** Strong defaults, minimal configuration. New capabilities arrive as stored agents, MCP servers, and skills — not as core code changes. The codebase is designed to be forked and adapted.

## The Three Paradigms

Most agent systems force you into one approach. MastraClaw supports all three and lets you choose per task:

### 1. Skill-Based (Flexible)

Agent capabilities defined as markdown instructions. The agent reads the skill description and decides how to execute it. Maximum flexibility, but accuracy compounds negatively over multiple steps.

```
Skill: "Research a topic and write a summary email"
→ Agent interprets, plans, and executes autonomously
→ Great for simple, 1-3 step tasks
```

### 2. Workflow-Based (Reliable)

Multi-step operations coded as Mastra workflows with typed inputs/outputs, error handling, and durable execution. Each step is validated. The workflow can be suspended, resumed, and retried.

```typescript
createWorkflow({ id: 'research-and-email' })
  .then(fetchSourcesStep)
  .then(summarizeStep)
  .then(sendEmailStep);
```

### 3. Hybrid (Best of Both)

The Main Agent uses workflows as tools. From the agent's perspective, a 10-step workflow is a single tool call. The skill describes *what* to do; the workflow handles *how* to do it reliably. The Main Agent can also delegate to sub-agents (themselves Mastra agents) for specialized work — sub-agents are reachable both indirectly via delegation and directly via their own bound channels.

```
Main Agent receives: "Research AI developments and email me a briefing"
Main Agent calls:    researchBriefingWorkflow (single tool call)
                     OR delegates to researchAgent (sub-agent)
Workflow executes:   N reliable steps with typed data flow
```

**This is the primary pattern in MastraClaw.**

## The Compound Error Problem

Why does this matter? Because of what Andrej Karpathy calls "agentic math":

| Steps | Accuracy per Step | Overall Success Rate |
|-------|------------------|---------------------|
| 1     | 95%              | 95.0%               |
| 5     | 95%              | 77.4%               |
| 10    | 95%              | 59.9%               |
| 20    | 95%              | **35.8%**            |
| 50    | 95%              | **7.7%**             |

Even at 95% reliability per step, a 20-step autonomous task fails nearly two-thirds of the time. This is why pure skill-based agents break down on complex tasks — and why workflows matter.

**MastraClaw's solution:** Encapsulate complex operations in typed, validated workflows. The agent makes one tool call. The workflow handles the complexity with checkpointing, error handling, and human-in-the-loop escalation.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│   Vercel / Railway — Next.js 16 + Mastra (one process)            │
│                                                                    │
│   Server-only:  Server Components │ Route Handlers │ Actions      │
│                          │              │             │           │
│                          └──────────────┴─────────────┘           │
│                                    │                              │
│                       getCurrentUser() → mastraFor(currentUser)    │
│                       (role-aware: user vs admin facade)           │
│                                    │                              │
│       ┌────────────────────────────┴──────────────────┐           │
│       │            Mastra (in-process)                 │           │
│       │  Main Agent ──delegates──▶ Sub Agents          │           │
│       │       ▲                         ▲              │           │
│       │       │  4-tier Memory · Editor · Workspaces   │           │
│       └───────┼─────────────────────────┼──────────────┘           │
│               │                         │                          │
│   Bindings table routes channels → agents (Postgres)               │
│       │                         │                                  │
│   Telegram main bot         Telegram per-agent bots                 │
│   Web UI default chat       Voice / email / etc.                    │
│                                                                    │
│   process.env: ~6 bootstrap secrets (Supabase URL/keys)            │
└─────────────────────────────┬─────────────────────────────────────┘
                              │ Postgres + S3 over TLS
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│   Supabase                                                         │
│                                                                    │
│   Postgres (via @mastra/pg) — RLS on every tenant table            │
│     ├ Mastra Storage (agents, prompts, skills, mcp, scorers)       │
│     ├ pgvector (semantic recall, RAG embeddings)                   │
│     ├ vault.secrets (per-user encrypted secrets via pgsodium)      │
│     └ App tables (bindings, user settings, ...)                    │
│                                                                    │
│   Storage (S3-compatible, via @mastra/s3)                          │
│     └ users/{userId}/agents/{agentId}/  ← per-agent workspaces     │
│                                                                    │
│   Auth (GoTrue: magic link / OAuth / app_metadata.role for RBAC)   │
└──────────────────────────────────────────────────────────────────┘
```

**Key architectural patterns:**

- **Single-process embedding.** Mastra runs **inside** the Next.js process as a directly imported TypeScript module. There is no separate API service, no `@mastra/client-js` in the application path, no HTTP hop. Server Components, Route Handlers, and Server Actions call `mastra.getAgentById('main-agent').generate(...)` like any other function.

- **Server-only execution boundary.** The Mastra instance, all secrets, and every LLM API key live exclusively on the server. CI fails the build if any file with `'use client'` imports `@/mastra` or `@mastra/*`. No `NEXT_PUBLIC_*` env var ever holds anything sensitive.

- **Multi-tenant and role-aware from day one.** Every Mastra resource carries an `authorId`. Every user has a role (`'user'` or `'admin'`) stored in `auth.users.app_metadata.role`. The `mastraFor(currentUser)` factory dispatches to a user facade (filtered by `authorId`, ownership-asserted) or an admin facade (unfiltered, plus admin-only operations). RLS policies enforce both rules at the database, independent of the application code. Phase 1 has one user (admin); the foundation supports many.

- **Main Agent + Sub Agents with bindings-based routing.** One Main Agent (code-defined, conceptually the orchestrator) owns the default channels. Sub-agents are reachable indirectly via Main Agent delegation **and** directly via dedicated channels (e.g., a dedicated Telegram bot per sub-agent). Routing lives in a `bindings` table — adding a new direct sub-agent channel is a Vault entry + a row + a webhook registration, no code change.

- **Workflows-as-Tools.** Complex multi-step operations are coded Mastra workflows exposed as single tool calls. The agent sees one tool; behind it are N validated, checkpointed steps. Workflows are code (in `src/mastra/workflows/`), shipped via redeploy.

- **Scoped Tool Assignment.** Each agent receives only the tools it actually needs. No tool bloat across agents.

- **4-Tier Memory** — Message History → Working Memory → Observational Memory → Semantic Recall. All powered by `@mastra/memory` against Supabase Postgres + pgvector.

- **Code vs. Data — strict separation.** Workflows, code-defined tools, channel adapters, providers, and the Main Agent live in Git and ship via redeploy. Stored agents, prompts, skills, MCP connections, scorers, memory, conversations, and secrets live in Supabase and change at runtime via the web UI. No redeploy for the latter.

- **Human-in-the-Loop.** No destructive action without user approval. Approval requests propagate up the agent hierarchy: sub-agent suspends → Main Agent receives → forwards to user via Telegram/Web UI. Configurable trust levels per action type.

- **Disposable infrastructure.** The compute container holds zero persistent state. Backup = `pg_dump` + `aws s3 sync`. Restore = new Supabase project + `psql` + redeploy. See [Backup & Restore](#backup--restore).

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| **Agent Framework** | [Mastra.ai](https://mastra.ai) — `@mastra/core`, `@mastra/editor`, `@mastra/memory`, `@mastra/observability`, `@mastra/pg`, `@mastra/s3` | Agents, workflows, tools, 4-tier memory, observability, sandboxing, MCP support, the Editor for runtime resource CRUD with versioning, S3-backed workspaces. MIT license. Production-proven at Replit and Marsh McLennan. |
| **Application Host** | [Next.js 16](https://nextjs.org) (App Router) | Single deployment artifact. Mastra is **embedded** as a TypeScript import — no separate API service. Server Components, Route Handlers, and Server Actions are the only places Mastra runs. |
| **Database** | [Supabase Postgres](https://supabase.com) via [`@mastra/pg`](https://www.npmjs.com/package/@mastra/pg) | Mastra Storage, app tables, multi-tenant data with Row-Level Security. Postgres is forever — `pg_dump` exits any vendor in seconds. Open source (Apache 2.0), self-hostable. |
| **Vector Store** | [pgvector](https://github.com/pgvector/pgvector) (bundled with Supabase) via `@mastra/pg` | Embeddings for RAG and semantic recall, in the same Postgres. No separate vector service. |
| **Workspace Filesystem** | Supabase Storage (S3 API) via [`@mastra/s3`](https://www.npmjs.com/package/@mastra/s3) | Per-agent workspaces, skill files, generated artifacts. Compute containers hold no files; everything is in S3. |
| **Auth** | Supabase Auth (GoTrue) + [`@supabase/ssr`](https://www.npmjs.com/package/@supabase/ssr) | Magic Link / OAuth / password. JWT-based with `app_metadata.role` for RBAC. Drives Postgres RLS via `auth.uid()` and `auth.jwt()`. |
| **Secrets** | [Supabase Vault](https://supabase.com/docs/guides/database/vault) (`pgsodium`) | Per-user encrypted secrets stored as Postgres columns. No application-level master key. Backups (`pg_dump`) capture only ciphertexts. |
| **Voice** | [ElevenLabs](https://elevenlabs.io) (TTS), STT TBD | Text-to-speech for voice interactions. STT provider deferred until voice is implemented. |
| **Channels** | Custom adapters in `src/lib/channels/` (Telegram first, more in Phase 2) | Code-defined channel adapters routed via the `bindings` table in Postgres. No third-party channel SDK. |
| **Model Routing** | Mastra's built-in model router (`provider/model-name` strings) | Model-agnostic. Supports all major providers, [OpenRouter](https://openrouter.ai), and private/on-premise APIs. Main Agent uses a strong model, sub-agents use cheap ones. |
| **Validation** | [Zod](https://zod.dev) | Runtime schema validation for all tool inputs/outputs and API boundaries. |
| **Durable Execution** | Mastra workflows (in code, in-repo) | Multi-step orchestration with suspend/resume and checkpointing. [Inngest](https://www.inngest.com) and [Trigger.dev](https://trigger.dev) evaluated for Phase 2 if needed. |
| **Observability** | `@mastra/observability` with `DefaultExporter` + `SensitiveDataFilter`, optional [Langfuse](https://langfuse.com) | Full agent lifecycle tracing. Sensitive data redaction before export. Self-hostable. |
| **Evaluations** | [Mastra Evals](https://mastra.ai) (`@mastra/evals`) | Built-in scorers: hallucination, toxicity, tool accuracy, faithfulness, trajectory accuracy, and custom scorers. |
| **MCP Integration** | Mastra MCP Client (stored MCP connections via Editor) + Mastra MCP Server | Add new tools to your agent at runtime by connecting an MCP server through the web UI — no code change. Expose your agent's data via MCP for Claude Code / IDEs. |
| **Local Development** | [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase start`) | Same Postgres + Auth + Storage + Vault stack as production, running in Docker on your laptop. One architectural path, not a degraded local fallback. |

**Explicitly not used:** Convex (replaced by Supabase for sovereignty), LibSQL (no degraded local fallback — see [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3.3), Vercel Chat SDK (channel adapters are in our own code), Doppler (Vault covers user secrets, host env vars cover bootstrap), separate API service (Mastra is embedded).

## What It Supports

- **Main Agent + Sub Agents** — One Main Agent (code-defined orchestrator) delegates to specialist sub-agents. Sub-agents can also be reached **directly** through their own bound channels (e.g., a dedicated Telegram bot per sub-agent), configured in the `bindings` table.
- **Workflows-as-Tools** — Multi-step workflows exposed as single agent tool calls. Workflows are typed, validated, suspendable, resumable.
- **Telegram channel** — Phase 1 ships with Telegram inbound + outbound. Default bot routes to the Main Agent; additional bots can be bound to specific sub-agents at runtime via the web UI. Slack, Teams, WhatsApp planned for Phase 2.
- **Web UI chat** — Built-in Next.js chat interface with the Main Agent or any sub-agent.
- **4-tier memory** — Message history, working memory, observational memory, semantic recall — backed by Supabase Postgres + pgvector, agentically controllable.
- **Integrated RAG** — Full pipeline with chunking, embeddings, vector stores, graph RAG, and reranking. All embeddings live in pgvector inside the same Supabase Postgres, no separate vector service.
- **Stored, versioned resources** — Agents, prompts, skills, MCP connections, scorers managed via Mastra's Editor with Draft / Published / Archived status. CRUD from the web UI without redeploys.
- **Per-agent S3 workspaces** — Each agent has its own workspace (skills, generated PDFs, audio, attachments) under `users/{userId}/agents/{agentId}/` in Supabase Storage. Compute containers hold no files.
- **Mastra Studio** (dev only) — Built-in development UI for agent testing, workflow debugging, trace viewing, and memory inspection at `http://localhost:4111`. Production uses MastraClaw's own Next.js UI.
- **Voice interaction** — Speech-to-text and text-to-speech via ElevenLabs (Phase 1 ships TTS; STT provider TBD).
- **Sandbox execution** — Isolated code execution (E2B, Daytona, Vercel, Docker, local) for untrusted operations.
- **Durable execution** — Native Mastra workflows with suspend/resume and checkpointing. External orchestration (Inngest, Trigger.dev) evaluated for Phase 2 if needed.
- **Observability** — OpenTelemetry-style tracing via `@mastra/observability` with `DefaultExporter` (writes to Postgres for Studio inspection) and `SensitiveDataFilter` (redacts secrets before export). Optional Langfuse / OpenTelemetry exporters.
- **Model-agnostic** — Mastra's built-in model router supports OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter, local models via Ollama, and private/on-premise APIs. Configurable via stored agent definitions.
- **Evaluations & testing** — Built-in scorers for hallucination, toxicity, bias, faithfulness, tool call accuracy, trajectory accuracy, RAG quality, and custom LLM-judged criteria. CI/CD-ready.
- **Human-in-the-Loop** — No destructive action without explicit user approval. Approval requests propagate from sub-agent → Main Agent → user channel. Configurable per action type.
- **Guard rails & processors** — PII detection/redaction (GDPR/CCPA/HIPAA), prompt injection detection, content moderation, system prompt scrubbing, Unicode normalization — composable as input/output processors on every agent.
- **MCP Server & Client** — Add new tools to your agent at runtime by connecting an MCP server through the web UI (stored as `stored_mcp_clients` via the Editor, scoped to the user). Expose your agent's data via MCP for Claude Code, Claude Cowork, and IDEs.
- **Slash commands** — Predefined shortcuts (`/brief`, `/research`, `/remind`, `/calendar`, `/status`, etc.) in all channels. Implemented as skills — add new commands by adding Markdown files to a workspace.
- **Multi-tenancy & RBAC from day 1** — Every Mastra resource is scoped by `authorId`. Every user has a role (`'user' | 'admin'`). Postgres RLS enforces both at the database. Phase 1 ships with one user (Patrick as admin); user #2 is a switch flip, not a refactor.
- **Server-only execution boundary** — Mastra, secrets, and all LLM API calls live exclusively on the server side of Next.js. CI fails the build if any client component imports `@/mastra` or `@mastra/*`.
- **Disposable infrastructure** — Compute containers hold zero state. Backup = `pg_dump` + `aws s3 sync`. Restore = new Supabase project + `psql` + redeploy. Under 15 minutes end-to-end.
- **Self-hostable** — Mastra is MIT, Supabase is Apache 2.0. Every component runs on your own infrastructure for full data sovereignty.

## Compliance & Data Sovereignty

MastraClaw is designed to be enterprise-compliant from day one — not as an afterthought.

**Multi-tenancy & RBAC from day 1.** Even though Phase 1 ships with a single user, the data model, the authorization layer, and every Postgres RLS policy assume multiple users in multiple roles. `authorId` scopes every Mastra resource. The `mastraFor(currentUser)` factory enforces tenancy at the application layer. RLS policies enforce both tenancy and the `app_metadata.role` claim at the database layer — two independent security boundaries.

**Server-only execution boundary.** The Mastra runtime, all secrets, and every LLM API call live exclusively on the server side of Next.js. No `@mastra/*` import in any client component. No `NEXT_PUBLIC_*` env var holds anything sensitive. CI enforces this on every build. Defense against accidental key leaks via the JS bundle.

**Encrypted secrets at rest.** Per-user secrets (LLM keys, channel tokens, MCP auth) live in Supabase Vault, column-encrypted via `pgsodium` with authenticated encryption. The encryption key never touches the database itself; backups (`pg_dump`) capture only ciphertexts. No application-level master key to rotate or lose.

**Guard Rails & PII Protection.** Mastra processors run before/after every agent request: `PIIDetector` (detects and redacts personal data with configurable strategies: block, warn, filter, redact), `PromptInjectionDetector` (blocks injection attempts), `ModerationProcessor` (content moderation), `SystemPromptScrubber` (prevents prompt leakage), `UnicodeNormalizer` (prevents encoding attacks), `TokenLimiterProcessor` (enforces budgets). All composable and stackable.

**GDPR / DSGVO.** Full data sovereignty through a self-hostable architecture. Mastra is MIT-licensed, Supabase is Apache 2.0 with official Docker / Helm / bare-metal self-hosting. Every component can run in EU data centers or on-premise. No data leaves your infrastructure unless you choose it to. PII detection and redaction via `PIIDetector`. Sensitive data filtering in observability.

**SOC 2.** Architectural foundations for SOC 2 compliance: audit logging via `@mastra/observability` (`DefaultExporter` writes to Postgres for inspection), role-based access control via `app_metadata.role`, encrypted data at rest (Vault for secrets, pgvector for embeddings) and in transit (TLS to Supabase), separate compute contexts for secret isolation, comprehensive tracing of all agent actions with sensitive-data filtering before export.

**HIPAA.** For healthcare and sensitive data environments: on-premise deployment with self-hosted models ensures PHI never leaves your infrastructure. `PIIDetector` supports HIPAA-relevant data types. Workspace sandboxing provides process-level isolation. Audit trails capture every agent decision and data access.

**Flexible Deployment Spectrum:**

| Deployment | Data Location | Model Provider | Compliance Level |
|-----------|--------------|----------------|-----------------|
| Cloud (managed) | Supabase cloud | Any cloud API | Standard |
| Hybrid | Self-hosted Supabase, cloud compute | Any cloud API | Enhanced |
| Private Cloud | Self-hosted Supabase + private deploy | Private API endpoints | High |
| Full On-Premise | Self-hosted Supabase + self-hosted models (Ollama, vLLM) | Local | Maximum |

Every deployment option uses the same codebase. Moving from cloud to on-premise is a configuration change (different `DATABASE_URL`, different storage endpoint), not a rewrite.

## Progressive Evolution

MastraClaw follows a **start simple, scale when needed** model:

```
Phase 1: Personal Agent          → One person, one agent, basic workflows
Phase 2: Extended Agent          → Multiple specialist sub-agents, advanced workflows
Phase 3: Multi-Instance          → Multiple agent instances, central coordination
Phase 4: Department/Enterprise   → Multi-user, RBAC, shared workflows, audit trails
```

The core codebase stays intentionally small. Complexity lives in the frameworks (Mastra, Next.js, Supabase) and in stored runtime resources (agents, prompts, skills, MCP connections in the database) — not in your fork. Upstream updates are dependency bumps, not source code rewrites. You add new capabilities the right way: code changes for workflows, tools, and channel adapters; runtime CRUD for everything else.

When you outgrow the base configuration, fork the repo and customize. The architecture supports it because the surface area of custom code is minimal.

## Quick Start

### Prerequisites

- **Node.js >= 22**
- **Docker** (running) — required by `supabase start` to boot the local Supabase stack
- **Supabase CLI** — `npm install -g supabase` or `brew install supabase/tap/supabase`
- **An LLM provider API key** — Anthropic, OpenAI, or any other Mastra-supported provider. You enter this in the web setup wizard on first login; it goes into Vault, not env vars.

You do **not** need a hosted Supabase account to develop locally. The local Supabase started by `supabase start` is a fully functional Postgres + Auth + Storage + pgvector + pgsodium stack running in Docker on your machine — the same software as production.

### Installation

```bash
git clone https://github.com/p-meier/mastra-claw.git
cd mastra-claw
npm install
```

### Boot the local Supabase stack

```bash
npx supabase init      # creates supabase/ if not present
npx supabase start     # ~30s first run, ~5s after; prints URLs and keys
```

Copy the printed values into `.env.local`:

```bash
cp .env.local.example .env.local
# then paste DATABASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, SUPABASE_S3_* into .env.local
```

Run the migrations into the local Postgres:

```bash
npx supabase db push
```

### Run the application

```bash
npm run dev               # Next.js + embedded Mastra on http://localhost:3000
npm run dev:studio        # Mastra Studio (separate dev process) on http://localhost:4111
```

On first login, the web UI walks you through a setup wizard: pick your LLM provider, paste the API key (stored in Vault), connect a Telegram bot (token also stored in Vault), pick the Main Agent's default model. After that, the agent is ready.

### Production deployment

Production uses the **same code, same architecture, same env var names** — only the URLs change to point at a hosted Supabase project (or a self-hosted Supabase instance) instead of `127.0.0.1`. See [Deployment](#deployment).

> **One architectural path.** There is no "local mode" with LibSQL or in-memory fallbacks. RLS, Vault, role-aware Auth, and pgvector are load-bearing for security; running with anything other than real Postgres would silently disable those guarantees. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §3.3 for the full reasoning.

## Project Structure

Single Next.js application — no monorepo, no separate API service.

```
mastra-claw/
├── ARCHITECTURE.md                   # Authoritative architecture (read first)
├── CLAUDE.md                         # Claude Code coding conventions
├── REQUIREMENTS.md                   # Product-level requirements
├── README.md                         # This file
├── package.json
├── tsconfig.json
├── next.config.ts                    # serverExternalPackages: ['@mastra/*']
├── .env.local.example                # Bootstrap env var template
│
├── supabase/
│   ├── config.toml                   # Supabase CLI config
│   └── migrations/                   # SQL migrations: RLS, app tables, indexes
│
├── src/
│   ├── mastra/
│   │   ├── index.ts                  # The Mastra instance (single export)
│   │   ├── agents/
│   │   │   ├── main-agent.ts         # The Main Agent (code-defined orchestrator)
│   │   │   └── sub/                  # Code-defined sub-agents
│   │   ├── workflows/                # Code-only workflows
│   │   ├── tools/                    # Code-defined tools (Zod-validated)
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
│   │   │   ├── dispatch.ts           # Hands resolved agent to mastraFor()
│   │   │   └── telegram/             # Telegram in/out adapter
│   │   └── auth.ts                   # getCurrentUser() helper
│   │
│   ├── app/
│   │   ├── (auth)/login/page.tsx     # Supabase Auth UI
│   │   ├── (app)/                    # Authenticated pages (Server Components)
│   │   │   ├── chat/page.tsx
│   │   │   ├── agents/page.tsx
│   │   │   ├── skills/page.tsx
│   │   │   └── settings/             # Settings + setup wizard
│   │   ├── api/
│   │   │   ├── chat/route.ts         # Server-only: invokes mastraFor()
│   │   │   ├── telegram/[bot]/route.ts  # Per-bot Telegram webhook
│   │   │   └── ...
│   │   ├── layout.tsx
│   │   └── globals.css
│   │
│   └── components/                   # UI components — pure presentation
│       └── ...
│
├── assets/                           # Static assets (header image, etc.)
└── public/
```

**Critical rule:** any file under `src/components/` or any file with `'use client'` directive **must not** import from `@/mastra` or `@mastra/*`. Server-only logic stays in `src/mastra/**`, `src/app/**/page.tsx`, `src/app/**/route.ts`, and Server Action files. CI enforces this. See `ARCHITECTURE.md` §2 for the full server-only execution boundary.

## Configuration

### Models

MastraClaw is model-agnostic. Defaults are configured via environment variables; per-agent overrides are stored in the database via the Editor and changeable from the web UI without a redeploy.

```bash
# Main Agent: a strong model (handles general traffic, delegation, reasoning)
MAIN_AGENT_MODEL=anthropic/claude-sonnet-4-5

# Sub-agents: cheaper models by default (handle specific tasks)
SPECIALIST_MODEL=anthropic/claude-haiku-4-5
```

Mastra's built-in model router uses `provider/model-name` strings. All major providers, OpenRouter, and private/on-premise APIs are supported. Provider API keys are **not** env vars — they live per-user in Supabase Vault and are entered via the setup wizard on first login.

### Channels

Telegram is the Phase 1 channel. The default Telegram bot token is captured per user via the setup wizard and stored in Supabase Vault — **not** in `.env`. Additional Telegram bots (one per sub-agent) are added at runtime via the web UI, each token stored as its own Vault entry. Routing lives in the `bindings` table in Postgres.

Slack, Microsoft Teams, WhatsApp, and Discord are planned for Phase 2 as code-defined adapters in `src/lib/channels/`.

### Storage

All persistent state lives in Supabase. There is no second persistence layer.

| Concern | Storage |
|---|---|
| Mastra Storage (agents, prompts, skills, MCP, scorers, memory, sessions) | Supabase Postgres via `@mastra/pg` |
| Embeddings (RAG, semantic recall) | pgvector in the same Postgres |
| User secrets (LLM keys, channel tokens, MCP auth) | Supabase Vault (`pgsodium`) |
| Workspace files (skill content, generated PDFs, attachments) | Supabase Storage (S3 API) via `@mastra/s3`, prefixed `users/{userId}/agents/{agentId}/` |
| App tables (bindings, user settings) | Supabase Postgres |

In development, all of the above runs against the local Supabase started by `npx supabase start`. In production, the same code points at a hosted Supabase project (or your self-hosted Supabase instance) by changing the `DATABASE_URL` and friends in the host's env vars.

## Deployment

### Local Development

```bash
npx supabase start        # boots Postgres + Auth + Storage + pgvector + Vault via Docker
npm run dev               # Next.js + embedded Mastra on http://localhost:3000
npm run dev:studio        # optional: Mastra Studio on http://localhost:4111
```

The local Supabase stack runs in Docker on your machine and provides the same Postgres + GoTrue + Storage + pgvector + pgsodium environment as production. RLS, Vault, role-aware Auth, and `@mastra/s3` work identically in dev and prod.

### Vercel / Railway

MastraClaw deploys as a single Next.js app to either platform.

**Vercel:**
1. Connect the GitHub repo.
2. Set the bootstrap env vars on the Vercel project (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_S3_*`) — pointing at a hosted Supabase project.
3. Push to `main`. Vercel builds and deploys.

**Railway:**
1. Connect the GitHub repo.
2. Same env vars.
3. Push to `main`. Railway builds and deploys.

There is **one** service per deployment target, not two. There is no separate Mastra API service.

### On-Premise

Every component is self-hostable:

- **Mastra.ai** — MIT license, runs anywhere Node.js runs.
- **Supabase** — Apache 2.0, official Docker Compose / Helm chart / bare-metal install. Postgres, GoTrue, Storage, Studio all self-hostable.
- **Next.js** — MIT license, standard Node.js deployment (Docker, systemd, your hosting of choice).
- **ElevenLabs** — API-based, replaceable with any TTS/STT provider for fully air-gapped deployments.
- **LLM models** — Ollama, vLLM, or any private endpoint via Mastra's model router.

A fully on-premise deployment looks like: a Docker Compose file with Supabase + a Next.js container, behind your own reverse proxy. The same code that runs on Vercel runs here without modification.

## Backup & Restore

A Personal Agent that holds your most sensitive data needs a backup story you actually trust. MastraClaw is built around a **disposable compute layer**: the Vercel/Railway container holds zero persistent state, so backups are not snapshots of running servers — they are dumps of Supabase. Killing and recreating the entire compute stack is a no-op. Restore means provisioning a fresh Supabase project, loading the dump, pointing the same Git deploy at it, and continuing where you left off.

### What is in the backup set

| Data | Location | Backed up by |
|---|---|---|
| Mastra state — agents, prompts, skills, MCP connections, scorers, memory, sessions | Supabase Postgres (`@mastra/pg`) | `pg_dump` / Supabase managed backups |
| Bindings, user settings, app tables | Supabase Postgres | same `pg_dump` |
| Embeddings (RAG, semantic recall) | Supabase Postgres (pgvector) | same `pg_dump` |
| User secrets (LLM keys, channel tokens, MCP auth) | Supabase Vault | same `pg_dump` — **only ciphertexts**, encryption keys never touch the dump |
| Workspace files — skill content, generated PDFs, audio, attachments | Supabase Storage bucket (S3 API, `@mastra/s3`) | `aws s3 sync` / `rclone` against the Supabase Storage S3 endpoint |
| Bootstrap secrets — DB URL, S3 keys, service role token | Vercel/Railway env vars | Manual: 1Password / Bitwarden / age-encrypted file |

The compute container holds **nothing**. There is no local file to back up, no Redis cache to dump, no second database to coordinate.

### Backup procedure

A daily scheduled job (Vercel Cron, Railway scheduled task, or a cron on the host) runs:

```bash
# 1. Postgres dump (everything: Mastra state, app tables, Vault ciphertexts, embeddings)
pg_dump --no-owner --no-acl "$DATABASE_URL" \
  | gzip \
  > "backup-$(date +%F).sql.gz"

# 2. Storage bucket sync (workspaces, skills, generated artifacts)
aws s3 sync \
  "s3://workspaces" \
  "./backup-storage-$(date +%F)/" \
  --endpoint-url "https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/s3"

# 3. Push both to off-site
rclone copy ./backup-* "$OFFSITE_REMOTE:mastra-claw-backups/"
```

The off-site target is your choice: Backblaze B2, Hetzner Storage Box, an encrypted external disk at home, an iCloud-mounted folder, anything `rclone` supports. Supabase Pro additionally takes daily managed snapshots automatically.

### Restore procedure

```bash
# 1. Provision a fresh Supabase project (or self-host instance)
#    Capture the new DATABASE_URL, SUPABASE_PROJECT_REF, S3 keys.

# 2. Restore Postgres
gunzip -c backup-2026-04-08.sql.gz | psql "$NEW_DATABASE_URL"

# 3. Restore Storage
aws s3 sync \
  ./backup-storage-2026-04-08/ \
  "s3://workspaces" \
  --endpoint-url "https://${NEW_PROJECT_REF}.supabase.co/storage/v1/s3"

# 4. Update Layer A env vars on the host with the new project credentials
# 5. Redeploy the Next.js application
```

That is the entire restore procedure. The compute layer comes back from a redeploy of the Git repository — there is nothing else to restore.

### Why this works

- **Postgres is forever.** Even if Supabase disappears, `pg_dump` produces standard SQL that imports into any other Postgres in seconds. No proprietary export format, no vendor escape clause.
- **Vault ciphertexts in the same dump.** Supabase Vault stores user secrets (LLM keys, bot tokens, MCP auth) as `pgsodium`-encrypted columns inside Postgres. The encryption key lives in Supabase's key-management layer, not in the database itself. So `pg_dump` automatically captures every secret in encrypted form — your backup file is safe to store anywhere, even unencrypted cloud buckets, because the ciphertexts cannot be read without the decryption key.
- **No `MASTER_KEY` to lose.** There is no application-level master key to manage separately. Vault handles key management; the application only ever sees decrypted values transiently in memory at request time.
- **Server is disposable.** The Vercel/Railway container is a build artifact of the Git repository. It can be destroyed and rebuilt at any time without losing data. This means a recovery drill is: provision Supabase, restore dump, redeploy from Git. Three steps, ~10 minutes.

### Backup integrity tests

Untested backups are wishes. MastraClaw includes a quarterly drill in the operations runbook:

1. Spin up a throwaway Supabase project.
2. Restore the latest backup into it.
3. Boot a Vercel preview deploy that points at the throwaway project.
4. Verify you can log in, see your data, send a test message to the Main Agent, and receive a reply.
5. Tear down the throwaway resources.

If any step fails, the backup procedure has a bug — and it is better to find out during a drill than during an actual recovery.

Full architectural rationale and the exact RLS, Vault, and Storage policies are in [`ARCHITECTURE.md`](./ARCHITECTURE.md) §12.

## Status

MastraClaw is under active development. The project is public for transparency and to share the architectural approach, but it is not yet accepting external contributions. If you're interested in the project, star the repo and watch for updates.

## License

[Apache 2.0](LICENSE)
