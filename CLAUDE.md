# Mastra-Claw — Claude Code Instructions

## Project Overview

Mastra-Claw is an enterprise-ready personal AI agent built on [Mastra.ai](https://mastra.ai). It provides an opinionated, curated base configuration that combines three architectural paradigms:

1. **Skill-based** — Agent capabilities defined as markdown SOPs, flexible and learnable
2. **Workflow-based** — Hard-coded multi-step workflows with durable execution (Mastra workflows)
3. **Hybrid** — Orchestrator agents delegate to specialists and use workflows-as-tools

The hybrid approach is the primary pattern. It solves the compound error problem (95% per-step accuracy degrades to 36% after 20 steps) by encapsulating multi-step operations in reliable workflows that appear as single tool calls to agents.

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Agent Framework | Mastra.ai | Agents, workflows, tools, memory, observability |
| Config Dashboard | Next.js | Web UI for agent configuration and monitoring |
| Database | Convex.dev | Reactive database, vector search, durable functions |
| Voice | ElevenLabs | Text-to-speech and speech-to-text |
| Channels | [Vercel Chat SDK](https://chat-sdk.dev) | Unified multi-platform channel layer (Slack, Teams, Telegram, Discord, etc.) |
| Model Routing | [Vercel AI SDK](https://sdk.vercel.ai) + AI Gateway | Model-agnostic provider abstraction, supports OpenRouter, private APIs |
| Durable Execution | [Inngest](https://www.inngest.com) / [Workflow SDK](https://useworkflow.dev) | External durable workflow orchestration, suspend/resume, step-level retries |
| Observability | Langfuse, Langsmith, OpenTelemetry | Tracing, metrics, debugging across agents and workflows |
| Evaluations | Mastra Evals (`@mastra/evals`) | Built-in scorers for agent quality, hallucination, toxicity, tool accuracy |
| MCP Integration | [Composio.dev](https://composio.dev) + Mastra MCP Client/Server | Aggregated MCP servers, secrets management, external tool access |
| Validation | Zod | Schema validation for all inputs/outputs |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│            Channels (Slack, Teams, Telegram, ...)        │
│                    via Vercel Chat SDK                   │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                  Orchestrator Agent                      │
│  (strong model, memory, scoped tool assignment)           │
└───┬──────────────┬──────────────┬───────────────────────┘
    │              │              │
    ▼              ▼              ▼
┌────────┐  ┌──────────┐  ┌──────────────┐
│Specialist│ │Specialist│  │  Workflow     │
│ Agent A  │ │ Agent B  │  │  (as Tool)   │
│(cheap    │ │(cheap    │  │  Multi-step  │
│ model)   │ │ model)   │  │  Durable     │
└────────┘  └──────────┘  └──────────────┘
```

**Key patterns:**
- **Orchestrator/Specialist** — One orchestrator (strong model) delegates to specialist sub-agents (cheaper models). Sub-agents get fresh context per task (context firewalls).
- **Workflows-as-Tools** — Complex multi-step operations are coded as Mastra workflows and exposed as single tools to agents.
- **Scoped Tool Assignment** — Each agent receives only the tools it actually needs. The orchestrator has its tools, each specialist gets exactly its required toolset — no unnecessary tool bloat.
- **4-Tier Memory** — Message History → Working Memory → Observational Memory → Semantic Recall.

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

```
mastra-claw/
├── apps/
│   ├── api/                          # Mastra backend
│   │   └── src/mastra/
│   │       ├── agents/               # Agent definitions
│   │       │   ├── orchestrator.ts   # Main orchestrator agent
│   │       │   └── specialists/      # Specialist sub-agents
│   │       ├── workflows/            # Workflow definitions
│   │       ├── tools/                # Tool definitions
│   │       ├── scorers/              # Evaluation scorers
│   │       └── index.ts              # Mastra initialization
│   └── web/                          # Next.js config dashboard
│       └── src/app/
├── convex/                           # Convex database schema & functions
│   ├── schema.ts
│   └── ...
├── CLAUDE.md                         # This file
├── README.md
├── package.json                      # Root workspace config
└── tsconfig.json
```

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

### Small Codebase Philosophy
- The core codebase must stay minimal — complexity lives in frameworks and packages
- New capabilities are added as workflows, tools, and skills — not as core code changes
- Upstream updates should be dependency bumps, not source code rewrites
- If a package or framework provides a feature, use it — don't reimplement

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

## Commands

```bash
# Development
npm run dev              # Run both API + web concurrently
npm run dev:api          # Mastra API only (default: port 4111)
npm run dev:web          # Next.js dashboard only (default: port 3000)

# Build
npm run build            # Build both workspaces

# Mastra Studio
# Automatically available at http://localhost:4111 during dev
```

## Environment Variables

```bash
# === Model Providers (at least one required) ===
ANTHROPIC_API_KEY=           # Anthropic Claude
OPENAI_API_KEY=              # OpenAI
# Add any Vercel AI SDK compatible provider

# === Model Selection ===
ORCHESTRATOR_MODEL=          # e.g., anthropic/claude-sonnet-4-20250514
SPECIALIST_MODEL=            # e.g., anthropic/claude-haiku-4-5-20251001

# === Mastra ===
MASTRA_API_KEY=              # API authentication token

# === Convex ===
CONVEX_URL=                  # Convex deployment URL
CONVEX_DEPLOY_KEY=           # Convex deploy key

# === Observability ===
LANGFUSE_PUBLIC_KEY=         # Langfuse public key
LANGFUSE_SECRET_KEY=         # Langfuse secret key
LANGFUSE_BASE_URL=           # Langfuse instance URL (self-hosted or cloud)
LANGSMITH_API_KEY=           # LangSmith API key (alternative to Langfuse)

# === Durable Execution ===
INNGEST_EVENT_KEY=           # Inngest event key
INNGEST_SIGNING_KEY=         # Inngest signing key

# === Composio ===
COMPOSIO_API_KEY=            # Composio.dev API key for MCP aggregation

# === Telegram ===
TELEGRAM_BOT_TOKEN=          # Telegram Bot API token
TELEGRAM_ALLOWED_USER_ID=    # Authorized user ID(s)

# === ElevenLabs ===
ELEVENLABS_API_KEY=          # ElevenLabs API key
ELEVENLABS_VOICE_ID=         # Voice ID for TTS
ELEVENLABS_MODEL_ID=         # Model ID (default: eleven_v3)
```

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

- **Rebuild what Mastra provides** — Use built-in memory, storage, observability, channels. Don't create custom implementations
- **Use `any` type** — Always define proper types or use `unknown` with narrowing
- **Skip Zod schemas** — Every tool, workflow step, and API boundary needs schema validation
- **Hardcode model names** — Always use ENV vars with sensible defaults
- **Give agents unnecessary tools** — Each agent gets only the tools it needs. Don't share tool sets across agents or load tools "just in case"
- **Create role-based sub-agents** — Use context firewalls (fresh agent per task), not specialized role agents ("Frontend-Agent")
- **Write verbose agent instructions** — Concise, human-written instructions outperform long LLM-generated ones (ETH Zurich finding)
- **Skip `workflow.commit()`** — Every workflow definition must call `.commit()` after step chain
- **Store secrets in code or config files** — Use environment variables exclusively
