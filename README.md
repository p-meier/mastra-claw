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
  <a href="#deployment">Deployment</a>
</p>

---

## Why MastraClaw

There's no shortage of personal AI agents. Since OpenClaw, the space has exploded with projects promising autonomous assistants that can do everything. They all share the same fatal flaw: **they rebuild everything from scratch**.

Custom memory systems. Custom workflow engines. Custom security layers. Agents that rewrite their own source code. The result is fragile software with hundreds of thousands of lines of code, dozens of dependencies, and security models that exist only at the application level.

**MastraClaw takes the opposite approach.** Instead of building yet another framework, we compose battle-tested, enterprise-backed components into an opinionated base configuration:

- **Mastra.ai** handles agents, workflows, memory, tools, observability, and sandboxing — backed by the Gatsby.js founders, funded by Paul Graham and Guillermo Rauch, used in production by Replit and Marsh McLennan
- **Convex** provides a reactive database with durable functions, vector search, and human-agent coordination
- **Vercel AI SDK** abstracts model providers so you're never locked into one LLM

The goal is not another feature-rich agent. It's a **minimal, curated foundation** that you extend with your own workflows and customizations — and that actually works in production.

## Philosophy

**Enterprise-ready from day one.** Sandboxing, observability, durable execution, role-based access, secrets management — not bolted on later, but architectural decisions from the start. Every component is self-hostable and deployable on-premise for data sovereignty.

**Frameworks over features.** Don't rebuild what enterprise-grade frameworks already provide. Mastra's memory system scores 94.87% on LongMemEval. Their observability includes sensitive data filtering. Their sandbox supports 5 providers. Use it.

**Hybrid architecture.** Three paradigms, one system. Agent skills for flexibility. Coded workflows for reliability. Orchestrator agents that combine both. The right tool for each task, not one paradigm forced onto everything.

**Model-agnostic.** No vendor lock-in. Swap Claude for GPT for Llama for Mistral for self-hosted open-source models — the agent logic stays the same. Built on the Vercel AI SDK with full support for the [Vercel AI Gateway](https://sdk.vercel.ai/docs/ai-sdk-core/ai-gateway), [OpenRouter](https://openrouter.ai), and private/on-premise model APIs. Orchestrators use strong models, specialists use cheap ones. Configure via environment variables.

**Channel-agnostic.** Built on the [Vercel Chat SDK](https://chat-sdk.dev) — write your bot logic once, deploy to Slack, Microsoft Teams, Telegram, Discord, Google Chat, and more. The agent logic is completely decoupled from the delivery channel.

**Start simple, scale when needed.** MastraClaw starts as a personal agent for one person — a founder, a department lead, an entrepreneur. But the architecture supports progressive evolution: multiple agent instances coordinated through a central hub, multi-user access, department-level orchestration. Fork the repo, add your customizations, pull upstream updates. The core codebase stays small because complexity lives in the frameworks and packages, not in your code.

**Opinionated but extensible.** Strong defaults, minimal configuration. But when you need to customize, you modify code — not sprawling config files. The codebase is designed to be forked and adapted.

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

The orchestrator agent uses workflows as tools. From the agent's perspective, a 10-step workflow is a single tool call. The skill describes *what* to do; the workflow handles *how* to do it reliably.

```
Agent receives: "Research AI developments and email me a briefing"
Agent calls: researchBriefingWorkflow (single tool call)
Workflow executes: 10 reliable steps with typed data flow
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
                        ┌─────────────────────────┐
                        │       Channels           │
                        │ Slack·Teams·Telegram·... │
                        └────────────┬────────────┘
                                     │
                        ┌────────────▼────────────┐
                        │   Orchestrator Agent     │
                        │   (strong model)         │
                        │                          │
                        │   Memory (4-tier)        │
                        │   Scoped Tool Assignment │
                        └──┬────────┬────────┬────┘
                           │        │        │
              ┌────────────▼┐ ┌─────▼─────┐ ┌▼───────────────┐
              │ Specialist   │ │Specialist │ │  Workflow       │
              │ Agent A      │ │Agent B    │ │  (exposed as    │
              │ (cheap model)│ │(cheap)    │ │   agent tool)   │
              │              │ │           │ │                 │
              │ Context      │ │ Context   │ │ Step 1 → 2 → 3 │
              │ Firewall     │ │ Firewall  │ │ Typed I/O       │
              └──────────────┘ └───────────┘ │ Checkpointed    │
                                             └─────────────────┘
                                                      │
                        ┌─────────────────────────────▼──┐
                        │            Convex              │
                        │  Reactive DB · Vector Search   │
                        │  Durable Functions · CRUD      │
                        └────────────────────────────────┘
```

**Key architectural patterns:**

- **Orchestrator/Specialist** — One orchestrator with a strong model delegates to specialist sub-agents running cheaper models. Each sub-agent gets a fresh context per task (context firewalls), preventing context rot and enabling cost optimization.

- **Workflows-as-Tools** — Complex multi-step operations are Mastra workflows exposed as single tool calls. The agent sees one tool; behind it are 10 validated, checkpointed steps.

- **Scoped Tool Assignment** — Each agent receives only the tools it actually needs. The orchestrator has its tools, each specialist gets exactly its required toolset — no unnecessary tool bloat, no context waste.

- **4-Tier Memory** — Message History (raw thread) → Working Memory (structured persistent data) → Observational Memory (compressed historical insights) → Semantic Recall (vector-based retrieval).

- **Human-in-the-Loop** — No destructive action without user approval. Approval requests propagate up the agent hierarchy: sub-agent suspends → orchestrator receives → forwards to user via Telegram/Teams/Web UI. The user confirms or rejects with a single tap. Configurable trust levels per action type.

- **Separate Compute Contexts** — Agent harness runs in a trusted context with secret access. Code execution and untrusted operations run in isolated sandboxes (E2B, Daytona, Vercel, Docker, or local).

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| **Agent Framework** | [Mastra.ai](https://mastra.ai) | Agents, workflows, tools, 4-tier memory, observability, sandboxing, MCP support. MIT license. Production-proven at Replit and Marsh McLennan. |
| **Config Dashboard** | [Next.js](https://nextjs.org) | Agent configuration and monitoring UI. React-based, SSR, API routes. |
| **Database** | [Convex](https://convex.dev) | Reactive queries, vector search, durable functions, human-agent coordination. Self-hostable (FSL Apache 2.0). |
| **Voice** | [ElevenLabs](https://elevenlabs.io) | Text-to-speech and speech-to-text for voice interactions across channels. |
| **Channels** | [Vercel Chat SDK](https://chat-sdk.dev) | Unified multi-platform messaging — Slack, Microsoft Teams, Telegram, Discord, Google Chat, and more from a single codebase. |
| **Model Routing** | [Vercel AI SDK](https://sdk.vercel.ai) + [AI Gateway](https://sdk.vercel.ai/docs/ai-sdk-core/ai-gateway) | Model-agnostic provider abstraction. Supports all major providers, [OpenRouter](https://openrouter.ai), and private/on-premise model APIs. |
| **Validation** | [Zod](https://zod.dev) | Runtime schema validation for all data boundaries (tool I/O, workflow steps, API responses). |
| **Durable Execution** | [Inngest](https://www.inngest.com) / [Workflow SDK](https://useworkflow.dev) | External durable workflow orchestration with suspend/resume, step-level memoization, and retries for long-running processes. |
| **Observability** | [Langfuse](https://langfuse.com), [Langsmith](https://smith.langchain.com), OpenTelemetry | Full agent lifecycle tracing with sensitive data filtering. Open standard (OTel), self-hostable (Langfuse), or managed. |
| **Evaluations** | [Mastra Evals](https://mastra.ai) (`@mastra/evals`) | Built-in scorers for agent quality: hallucination, toxicity, tool accuracy, faithfulness, trajectory accuracy, and custom scorers. |
| **MCP Integration** | [Composio.dev](https://composio.dev) + Mastra MCP Client/Server | MCP server (expose agents/tools to Claude Code, Cowork, IDEs) and client (consume external MCP servers). Composio aggregates servers with unified secrets management. |

## What It Supports

- **Orchestrator/Specialist pattern** — One supervisor agent delegates to specialized sub-agents with context isolation
- **Workflows-as-Tools** — Multi-step workflows exposed as single agent tool calls
- **Multi-channel messaging** — Slack, Microsoft Teams, Telegram, Discord, Google Chat via [Vercel Chat SDK](https://chat-sdk.dev)
- **4-tier memory** — Message history, working memory, observational memory, semantic recall — provider-agnostic, agentically controllable
- **Integrated RAG** — Full pipeline with chunking, embeddings, vector stores, graph RAG, and reranking. Knowledge Base and Folders indexable via Convex with semantic + full-text search
- **Mastra Studio** — Built-in development UI for agent testing, workflow debugging, trace viewing, and memory inspection at `http://localhost:4111`
- **Voice interaction** — Speech-to-text and text-to-speech via ElevenLabs
- **Sandbox execution** — Isolated code execution (E2B, Daytona, Vercel, Docker, local)
- **Durable execution** — Native Mastra workflows with suspend/resume and checkpointing, plus external orchestration via [Inngest](https://www.inngest.com) and [Workflow SDK](https://useworkflow.dev) for long-running processes
- **Observability** — OpenTelemetry-based tracing via Langfuse, Langsmith, or custom exporters. Sensitive data filtering built-in. Full agent lifecycle coverage (LLM calls, tools, memory, workflows)
- **Model-agnostic** — Vercel AI Gateway, OpenRouter, all major providers, private/on-premise model APIs
- **Evaluations & testing** — Built-in scorers for hallucination, toxicity, bias, faithfulness, tool call accuracy, trajectory accuracy, RAG quality, and custom LLM-judged criteria. CI/CD-ready
- **Human-in-the-Loop** — No destructive action without explicit user approval. Mastra's built-in suspend/resume enables approval gates at any workflow step. Approval requests propagate from sub-agent → orchestrator → user channel (e.g., Telegram). Configurable per action: auto-approve trusted operations, require confirmation for emails, posts, calendar changes
- **Guard rails & processors** — PII detection/redaction (GDPR/CCPA/HIPAA), prompt injection detection, content moderation, system prompt scrubbing, Unicode normalization — composable as input/output processors
- **MCP Server & Client** — Expose agents and data via MCP for Claude Code, Claude Cowork, and IDEs. Consume external MCP servers. Aggregate via [Composio.dev](https://composio.dev) with unified secrets management
- **Slash commands** — Predefined shortcuts (`/brief`, `/research`, `/remind`, `/calendar`, `/status`, etc.) in all channels and web UI. Implemented as skills — extensible by adding new skill files
- **Reactive database** — Real-time queries, full-text search, vector/semantic search via Convex — all data agentically queryable and accessible via MCP
- **Progressive scaling** — Start as a single personal agent, scale to multi-agent, multi-user, department-level orchestration
- **Self-hostable** — Every component runs on-premise for full data sovereignty

## Compliance & Data Sovereignty

MastraClaw is designed to be enterprise-compliant from day one — not as an afterthought.

**Guard Rails & PII Protection** — Mastra processors run before/after every agent request: `PIIDetector` (detects and redacts personal data with configurable strategies: block, warn, filter, redact), `PromptInjectionDetector` (blocks injection attempts), `ModerationProcessor` (content moderation), `SystemPromptScrubber` (prevents prompt leakage), `UnicodeNormalizer` (prevents encoding attacks), `TokenLimiterProcessor` (enforces budgets). All composable and stackable.

**GDPR / DSGVO** — Full data sovereignty through self-hostable architecture. Every component (Mastra.ai, Convex, Next.js, models) can run on-premise or in EU data centers. No data leaves your infrastructure unless you choose it to. PII detection and redaction via `PIIDetector` processor. Sensitive data filtering in observability.

**SOC 2** — Architectural foundations for SOC 2 compliance: audit logging via Mastra observability, role-based access control, encrypted data at rest and in transit, separate compute contexts for secret isolation, and comprehensive tracing of all agent actions.

**HIPAA** — For healthcare and sensitive data environments: on-premise deployment with self-hosted models ensures PHI never leaves your infrastructure. `PIIDetector` supports HIPAA-relevant data types. Workspace sandboxing provides process-level isolation. Audit trails capture every agent decision and data access.

**Flexible Deployment Spectrum:**

| Deployment | Data Location | Model Provider | Compliance Level |
|-----------|--------------|----------------|-----------------|
| Cloud (managed) | Provider infrastructure | Any cloud API | Standard |
| Hybrid | Your database, cloud compute | Any cloud API | Enhanced |
| Private Cloud | Your infrastructure | Private API endpoints | High |
| Full On-Premise | Your infrastructure | Self-hosted models (Ollama, vLLM) | Maximum |

Every deployment option uses the same codebase. Moving from cloud to on-premise is a configuration change, not a rewrite.

## Progressive Evolution

MastraClaw follows a **start simple, scale when needed** model:

```
Phase 1: Personal Agent          → One person, one agent, basic workflows
Phase 2: Extended Agent          → Multiple specialist sub-agents, advanced workflows
Phase 3: Multi-Instance          → Multiple agent instances, central coordination
Phase 4: Department/Enterprise   → Multi-user, RBAC, shared workflows, audit trails
```

The core codebase stays intentionally small. Complexity lives in the frameworks (Mastra.ai, Convex, Vercel AI SDK) and in installable packages — not in your fork. Upstream updates are dependency bumps, not source code rewrites. You add new capabilities by adding workflows, tools, and skills as packages — the core rarely changes.

When you outgrow the base configuration, fork the repo and customize. The architecture supports it because the surface area of custom code is minimal.

## Quick Start

### Prerequisites

- Node.js >= 22
- [Convex](https://convex.dev) account (free tier available)
- At least one LLM provider API key (Anthropic, OpenAI, etc.)
- Telegram Bot Token (optional, for Telegram channel)

### Installation

```bash
git clone https://github.com/p-meier/mastraclaw.git
cd mastraclaw
npm install
```

### Configuration

Copy the example environment file and fill in your keys:

```bash
cp .env.example .env
```

Required variables:

```bash
# At least one model provider
ANTHROPIC_API_KEY=your-key-here

# Convex
CONVEX_URL=your-convex-deployment-url

# Mastra API
MASTRA_API_KEY=your-api-key
```

Optional integrations:

```bash
# Observability (pick one or both)
LANGFUSE_PUBLIC_KEY=       # Langfuse
LANGFUSE_SECRET_KEY=
LANGFUSE_BASE_URL=
LANGSMITH_API_KEY=         # LangSmith

# Durable Execution
INNGEST_EVENT_KEY=         # Inngest
INNGEST_SIGNING_KEY=

# MCP Aggregation
COMPOSIO_API_KEY=          # Composio.dev
```

### Run

```bash
npm run dev
```

This starts both the Mastra API (port 4111) and the Next.js dashboard (port 3000). Mastra Studio is available at `http://localhost:4111`.

## Project Structure

```
mastraclaw/
├── apps/
│   ├── api/                          # Mastra backend
│   │   └── src/mastra/
│   │       ├── agents/               # Agent definitions
│   │       │   ├── orchestrator.ts   # Main orchestrator agent
│   │       │   └── specialists/      # Specialist sub-agents
│   │       ├── workflows/            # Coded workflow definitions
│   │       ├── tools/                # Tool definitions (Zod-validated)
│   │       ├── scorers/              # Evaluation scorers
│   │       └── index.ts              # Central Mastra initialization
│   └── web/                          # Next.js config dashboard
│       └── src/app/
│           ├── agents/               # Agent explorer
│           └── api/                  # API proxy to Mastra
├── convex/                           # Convex database
│   ├── schema.ts                     # Table definitions
│   └── ...                           # Queries & mutations
├── assets/                           # Static assets (header image, etc.)
├── CLAUDE.md                         # Claude Code project instructions
├── README.md                         # This file
├── package.json                      # Workspace root
└── tsconfig.json                     # Root TypeScript config
```

## Configuration

### Models

MastraClaw is model-agnostic. Configure via environment variables:

```bash
# Orchestrator uses a strong model (handles routing, complex reasoning)
ORCHESTRATOR_MODEL=anthropic/claude-sonnet-4-20250514

# Specialists use cheaper models (handle specific tasks)
SPECIALIST_MODEL=anthropic/claude-haiku-4-5-20251001
```

Any [Vercel AI SDK compatible provider](https://sdk.vercel.ai/providers) works: Anthropic, OpenAI, Google, Mistral, Groq, local models via Ollama, etc.

### Channels

Channels are added modularly. Each channel needs its credentials in `.env`:

```bash
# Telegram
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_ALLOWED_USER_ID=your-user-id
```

### Storage

Default storage uses LibSQL (local SQLite) for agent state and DuckDB for observability traces. Convex handles application data. For production, configure external storage providers:

```bash
CONVEX_URL=https://your-deployment.convex.cloud
CONVEX_DEPLOY_KEY=your-deploy-key
```

## Deployment

### Local Development

```bash
npm run dev          # Both API + web
npm run dev:api      # Mastra API only
npm run dev:web      # Next.js dashboard only
```

### Railway

Pre-configured for [Railway](https://railway.app) deployment with dual services (API + Web). See `railway.json`.

### On-Premise

Every component is self-hostable:
- **Mastra.ai** — MIT license, runs anywhere Node.js runs
- **Supabase** — Apache 2.0, official Docker / Helm / bare-metal self-hosting
- **Next.js** — MIT license, standard Node.js deployment
- **ElevenLabs** — API-based, replaceable with any TTS/STT provider

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
