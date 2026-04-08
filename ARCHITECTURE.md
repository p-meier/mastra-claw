# MastraClaw — Architecture

> This document is the authoritative source of architectural decisions for MastraClaw. Every implementation choice — packages, file layout, runtime model, security boundary — is captured here. When `CLAUDE.md` and `REQUIREMENTS.md` conflict with this file, this file wins.

---

## 0. Core Principles

These principles are non-negotiable. Every implementation decision is checked against them.

1. **Sovereignty first.** A Personal Agent is, by definition, a sovereignty tool. The user's data, secrets, conversations, memory, and skills belong to the user. The runtime must be self-hostable today or tomorrow without code changes. No proprietary lock-in beyond the one chosen managed backend (Supabase, which is itself open-source and self-hostable).

2. **Single process.** Mastra runs **inside** the Next.js application as a directly imported module. There is no separate API service, no HTTP hop between frontend and Mastra, no `@mastra/client-js` in the application path. One container, one deployment, one set of environment variables, one log stream.

3. **Code vs. Data — strict separation.** Code (workflows, providers, channel adapters) lives in the Git repository and ships via redeploy. Data (agents, prompts, skills, MCP connections, memory, conversations, secrets) lives in Supabase and changes at runtime via the application UI. This separation is the difference between "I deploy a new version" and "the user clicks a button". Both must work; they must not be confused.

4. **Multi-tenant by design from day one.** Even though Phase 1 ships as a single-user system (only Patrick), the data model, the authorization layer, and every database query are written as if multiple users exist. There is no "single-user shortcut" anywhere in the codebase. Adding the second user later is a switch flip, not a refactor.

5. **Server-only execution boundary.** The Mastra instance, its tools, its secrets, and any LLM API key MUST exist only on the server side of Next.js — Server Components, Route Handlers, Server Actions. **Never** in Client Components, never in browser bundles, never in any code path that ships to the user's device. This is the single most important security rule of the project.

6. **Disposable infrastructure.** The compute layer (Vercel container, Railway service, self-hosted Docker) holds zero persistent state. All state lives in Supabase. Killing and recreating the entire compute layer is a no-op. Backups are dumps of Supabase, not server snapshots.

7. **Small surface area.** The codebase stays minimal. New capabilities arrive via stored resources, MCP servers, and skills — not via core code changes. Upstream framework updates are dependency bumps, not source rewrites.

---

## 1. The Single-Process Model

### 1.1 Why embedded, not split

Mastra is a TypeScript library, not a framework that requires its own server. Its Hono-based REST API exists for cases where the frontend is not TypeScript (mobile apps, Python clients, separate teams). When the frontend **is** Next.js, the cleanest pattern is to import the `mastra` instance directly into Server Components, Route Handlers, and Server Actions, and call it as a normal TypeScript function.

This is officially documented and tooled by the Mastra team:

- Official guide: https://mastra.ai/guides/getting-started/next-js
- Deployment guide: https://mastra.ai/docs/deployment/web-framework
- Built-in CLI lint rule (`packages/cli/src/commands/lint/rules/nextConfigRule.ts`) detects Next.js projects and enforces the `serverExternalPackages: ['@mastra/*']` configuration.
- Mastra's own commercial product (Mastra Cloud Studio) is a Next.js app that embeds the framework the same way.

There is no Next.js adapter under `mastra/server-adapters/` because none is needed.

### 1.2 The Mastra instance lives in `src/mastra/`

```
src/mastra/
├── index.ts            ← Mastra instance, the only export
├── agents/             ← code-defined agents (Main Agent, base sub-agents)
├── tools/              ← code-defined tools (those that cannot be MCP)
├── workflows/          ← code-only workflows (durable, multi-step)
├── scorers/            ← evaluation scorers
└── lib/                ← internal helpers (scoped wrappers, secret service)
```

The `src/mastra/index.ts` file constructs **one** Mastra instance, registers code-defined resources, and configures Storage, Editor, Observability, and Workspace providers. This file is imported by **every** server-side caller via the alias `@/mastra`.

```ts
// src/mastra/index.ts
import { Mastra } from '@mastra/core/mastra';
import { MastraEditor } from '@mastra/editor';
import { PostgresStore } from '@mastra/pg';
// ... etc.

export const mastra = new Mastra({ /* ... */ });
```

```ts
// src/app/api/agents/[id]/chat/route.ts (a Route Handler — server-only)
import { mastra } from '@/mastra';

export async function POST(req: Request) {
  const agent = mastra.getAgentById('main-agent');
  const result = await agent.generate(/* ... */);
  return Response.json(result);
}
```

---

## 2. The Server-Only Execution Boundary

This is rule #1 of the application.

### 2.1 What lives where

| Surface | Runs in | Has access to |
|---|---|---|
| `src/mastra/**` | server only | Mastra, secrets, DB, S3, LLM keys |
| `src/app/**/page.tsx` (Server Components) | server only | safe to import `@/mastra` |
| `src/app/**/route.ts` (Route Handlers) | server only | safe to import `@/mastra` |
| `src/app/**/actions.ts` (Server Actions) | server only | safe to import `@/mastra` |
| `src/app/**/*-client.tsx` (`'use client'`) | **browser** | **never** import `@/mastra`, **never** see secrets |
| `src/components/**` (UI components) | browser | render data, dispatch Server Actions, call Route Handlers |

### 2.2 Concrete rules

1. **No `@mastra/*` imports in any file with `'use client'` at the top.** Period. The bundler will pull the entire Mastra dependency tree (including secret-handling code) into the browser bundle. This is a security incident.
2. **No environment variables prefixed with `NEXT_PUBLIC_`** for anything Mastra-related. Anything `NEXT_PUBLIC_*` ships to every browser. Mastra keys, Supabase service-role tokens, LLM API keys, S3 secrets — never.
3. **Client components fetch data via Server Actions or Route Handlers**, never by reaching into Mastra directly. The pattern is always: client component → server action / fetch → server-side `mastra.*` call → JSON response.
4. **The `MASTRA_API_KEY` and the SimpleAuth layer** exist only because the Mastra Hono server exposes a REST API for *external* clients (mobile apps, scripts, MCP). The Next.js application itself does not authenticate against this API — it bypasses it completely by importing `mastra` directly.
5. **Lint enforcement.** A custom ESLint rule should fail the build if any file with `'use client'` imports from `@/mastra`, `@mastra/*`, or any path that transitively pulls Mastra. This is not optional; it is a CI gate.

### 2.3 Why this matters

Putting an LLM API key in the browser bundle does not just leak the key — it leaks **billing**. Anyone who inspects the JS source can extract the key and run unlimited LLM calls on the user's account. For a Personal Agent that holds the user's most sensitive data, the same applies to memory access, agent instructions, and integration tokens. Server-only is not paranoia, it is the entry-level cost of building this kind of system.

---

## 3. Backend: Supabase

Supabase is the **single** managed dependency of the project. It provides everything the application needs that is not Next.js or Mastra:

| Supabase Feature | What we use it for | Mastra integration |
|---|---|---|
| **Postgres** | Mastra Storage, app tables, multi-tenant data | `@mastra/pg` adapter (v1.9.0, mature) |
| **pgvector** | Embeddings for RAG, Memory semantic recall | bundled with `@mastra/pg` |
| **Auth** | User login, sessions, identity propagation | `@supabase/ssr` in Next.js, `authorId` in Mastra |
| **Storage (S3 API)** | Workspace files, skills, user uploads | `@mastra/s3` adapter (v0.3.0) targeted at Supabase Storage's S3 endpoint |
| **Vault** | User-provided secrets (LLM keys, channel tokens) | custom `SecretService` reading `vault.decrypted_secrets` |

### 3.1 Why Supabase, not the alternatives

- **Postgres is forever.** When Supabase goes away, our data is standard SQL. `pg_dump` dumps to any other Postgres in seconds.
- **Self-hostable.** Supabase is Apache-2.0. Today we run on their cloud, tomorrow on a Hetzner box, next year on a Synology — same code, different `DATABASE_URL`.
- **One auth layer for everything.** Supabase Auth integrates with RLS, so our authorization story is enforced at the database, not just at the application layer. Defense in depth.
- **Vault is built in.** No second secret-management system, no `MASTER_KEY` env var, no custom crypto. See §11.
- **Mature Mastra adapters.** `@mastra/pg` is at v1.9.0 with years of battle-testing. `@mastra/s3` exists as v0.3.0 and ships out of the box. We do not write a single line of storage adapter code.

### 3.2 What we explicitly do not use

- **Doppler** — its Supabase sync targets Edge Function env vars, not Vault, and our Mastra runtime does not run in Edge Functions. Doppler-as-Layer-A is possible but adds a moving part for marginal benefit. Not in Phase 1.
- **Convex** — was the original choice, replaced by Supabase for sovereignty (Postgres-as-standard, self-hostability) and Mastra adapter maturity.
- **LibSQL** — works for local development but not chosen as production storage because it has no path to multi-tenant deployment.
- **Supabase Edge Functions** — Mastra runs in the Next.js process, not in Deno. Edge Functions are not part of our architecture.

---

## 4. Multi-Tenancy as a Foundation

This section is fundamental. **MastraClaw is a multi-tenant system that happens to ship Phase 1 with a single tenant.** Every line of database code is written as if the application has many users. There is no "single-user shortcut" anywhere.

### 4.1 The user model

Every authenticated request maps to exactly one `userId` (a UUID from Supabase Auth's `auth.users` table). This `userId` is the **tenant identifier**. There is no separate "tenant" or "org" concept in Phase 1 — one user equals one tenant. (If teams are needed later, an `Organization` entity can be added with users belonging to organizations; the `tenantId` then becomes `orgId` instead of `userId`. The code structure does not change.)

### 4.2 `authorId` on every Mastra resource

Mastra's Storage layer already supports multi-tenant filtering via the `authorId` field on every stored resource (Agents, Prompt Blocks, Skills, MCP Clients, Scorers, Workspaces). The field is indexed for fast filtering.

```ts
// from @mastra/core/src/storage/types.ts
export interface StorageAgentType {
  id: string;
  status: 'draft' | 'published' | 'archived';
  /** Author identifier for multi-tenant filtering */
  authorId?: string;
  // ...
}

export type StorageListAgentsInput = {
  /** Filter agents by author identifier (indexed for fast lookups). */
  authorId?: string;
  // ...
};
```

**Mastra does not auto-fill `authorId`.** It is the application's responsibility to set it on every create and to filter on every list/get/update/delete. The `scopedMastra` wrapper makes this impossible to forget.

### 4.3 The `scopedMastra` wrapper

A small abstraction lives in `src/mastra/lib/scoped-mastra.ts`. It takes the global `mastra` instance plus a `userId` and returns a per-request facade where every operation is automatically scoped to the user.

```ts
// src/mastra/lib/scoped-mastra.ts
import { mastra } from '@/mastra';
import { ForbiddenError, NotFoundError } from './errors';

export function scopedMastra(userId: string) {
  if (!userId) {
    throw new Error('scopedMastra requires a userId — never call without authentication');
  }

  return {
    userId,

    agent: {
      list: () =>
        mastra.editor.agent.list({ authorId: userId }),

      create: (input: Omit<StorageCreateAgentInput, 'authorId'>) =>
        mastra.editor.agent.create({ ...input, authorId: userId }),

      get: async (id: string) => {
        const a = await mastra.editor.agent.get(id);
        if (!a) throw new NotFoundError(`agent ${id}`);
        if (a.authorId !== userId) throw new ForbiddenError();
        return a;
      },

      update: async (id: string, patch: StorageUpdateAgentInput) => {
        await assertOwned(mastra.editor.agent, id, userId);
        return mastra.editor.agent.update(id, patch);
      },

      delete: async (id: string) => {
        await assertOwned(mastra.editor.agent, id, userId);
        return mastra.editor.agent.delete(id);
      },
    },

    // Same shape for: prompt, skill, mcp, scorer, workspace
    prompt: { /* ... */ },
    skill:  { /* ... */ },
    mcp:    { /* ... */ },
    scorer: { /* ... */ },
    workspace: { /* ... */ },

    // For agent invocation, requestContext carries the userId so dynamic
    // tools / instructions / memory can scope themselves too.
    invoke: async (agentId: string, input: string) => {
      const a = await mastra.getAgentById(agentId);
      // assert ownership of stored agents (code-defined agents are global)
      // ...
      return a.generate(input, {
        requestContext: { userId },
      });
    },
  };
}

async function assertOwned(ns: any, id: string, userId: string) {
  const r = await ns.get(id);
  if (!r) throw new NotFoundError(id);
  if (r.authorId !== userId) throw new ForbiddenError();
}
```

### 4.4 Usage rule: **never call `mastra.editor.*` directly from app code**

In Server Components, Route Handlers, and Server Actions, the application code uses `scopedMastra(userId)`, never the raw `mastra` instance. The raw instance is reserved for:

- The Mastra initialization in `src/mastra/index.ts`
- Internal scaffolding (migrations, seed scripts, admin tooling)
- Code-defined agents and tools that legitimately need cross-user data (rare, must be reviewed)

A grep for `mastra.editor.` outside of `src/mastra/lib/scoped-mastra.ts` is a code-review red flag.

### 4.5 Defense in depth: Postgres RLS

The application-layer wrapper above is the first line of defense. The second line is **Postgres Row-Level Security**. Every Mastra table that stores per-tenant data gets an RLS policy:

```sql
alter table mastra_agents enable row level security;

create policy "tenant_isolation_mastra_agents"
  on mastra_agents
  for all
  using (author_id = (select auth.uid())::text)
  with check (author_id = (select auth.uid())::text);
```

The same pattern applies to `mastra_prompt_blocks`, `mastra_skills`, `mastra_mcp_clients`, `mastra_scorers`, `mastra_workspaces`, `mastra_memory_threads`, `mastra_memory_messages`, etc.

This means: even if a bug in `scopedMastra` forgets to filter, **the database itself refuses to return rows that do not belong to the current authenticated user**. Two independent security layers, both enforced.

The exact list of Mastra tables and their RLS policies is generated by the migration script in `supabase/migrations/`. RLS is mandatory; a migration that adds a new Mastra table without RLS fails CI.

### 4.6 Phase 1 vs. later

In Phase 1, **only Patrick exists**. The system does not show a signup form, does not have org/team UI, does not have billing or quotas, does not display user names. But:

- The first time Patrick logs in via Supabase Auth, his row in `auth.users` gets created (UUID `aaaa...`).
- Every Mastra resource he creates is stamped with `authorId = aaaa...`.
- Every query is filtered by `authorId = aaaa...`.
- The `scopedMastra(userId)` wrapper is used everywhere.

When user #2 arrives later, the only changes are:
- Show a signup form
- Maybe add user-name display in the UI
- Maybe add organization grouping

**No data migration. No query rewrites. No security audit.** Because the foundation was multi-tenant from the start.

### 4.7 What to never do in Phase 1 (because it would break the foundation)

- ❌ Hardcoding `userId = 'patrick'` in any function. Always derive from Supabase Auth.
- ❌ Calling `mastra.editor.agent.list()` without `authorId`. Always go through `scopedMastra`.
- ❌ Skipping RLS on a new table because "we only have one user anyway".
- ❌ Storing secrets globally instead of per-user in Vault.
- ❌ Naming a workspace path with a fixed name instead of `users/{userId}/...`.

---

## 5. The Agent Model: Main Agent + Sub Agents

### 5.1 Conceptual model

MastraClaw is built around **one Main Agent and many Sub Agents**.

- **The Main Agent** is the user's primary point of contact. It owns the default Telegram channel, the default Web UI chat, and the default voice interface. It is conceptually an *orchestrator* — its job is to understand a user request, decide whether to handle it itself or delegate, and either way produce a response. Technically, it is just another Mastra Agent (no special status in the framework), but it has a distinct role in the routing layer (§6).

- **Sub Agents** are specialized agents — for research, finance, content creation, scheduling, family-office work, whatever the user defines. Some are code-defined (shipped in `src/mastra/agents/`), some are stored in the database (created by the user via the web UI). Sub Agents have two ways of being reached:
  1. **Indirectly through the Main Agent**, which delegates to them via Mastra's sub-agent / tool-call mechanism. The user does not need to know which sub-agent handled their request.
  2. **Directly through their own bound channel** — for example, a dedicated Telegram bot that always routes to one specific sub-agent. See §6.

Both modes coexist. A sub-agent can be reachable through the Main Agent *and* through its own Telegram bot at the same time. The user chooses how to interact.

### 5.2 Why both modes

Sub-agent routing only through a single Main Agent has two failure modes:

1. **Cognitive overload of the Main Agent** — every request, regardless of domain, must first pass the Main Agent's reasoning, which inflates context, latency, and cost.
2. **Loss of channel-as-mental-model** — humans naturally use different communication channels for different topics ("the WhatsApp group for family", "Slack for work"). Forcing everything through one bot breaks this useful mental separation.

Direct sub-agent channels solve both:

- Patrick has a *Personal Main Bot* on Telegram for general requests.
- Patrick also has a dedicated *@PatrickFinanceBot* that talks only to the Finance sub-agent. Nothing else. When he writes there, no Main Agent reasoning happens — the message goes straight to the Finance sub-agent.
- He also has *@PatrickResearchBot* for ad-hoc research briefings.

Each direct channel is a separate Telegram bot (own token, own webhook) but inside the application it is just another binding (channel → agent) in the routing table.

### 5.3 Code-defined vs. stored agents

- **Code-defined agents** live in `src/mastra/agents/`. They ship with the application, are global (not user-scoped), and require a redeploy to change. The Main Agent itself starts as code-defined. A small set of "system" sub-agents (e.g., a default research agent, a default scheduling agent) may also be code-defined.

- **Stored agents** live in Supabase via Mastra's Editor. They are user-scoped (`authorId`), versioned (Draft / Published / Archived), and editable from the web UI without a redeploy. The user creates new agents this way.

The Main Agent is code-defined because it is part of the system identity; everything else is the user's choice.

### 5.4 Delegation: how the Main Agent reaches sub-agents

Mastra exposes sub-agents via the agent's tool list. When the Main Agent is constructed, every available sub-agent (code-defined and user-stored) becomes a callable tool. The Main Agent's instructions explain when to delegate and to which agent. The framework handles the actual call, returns the sub-agent's output, and the Main Agent integrates it into its response.

This is conceptually similar to OpenClaw's `subagents` tool, but Mastra gives us first-class agent-as-tool support, so we do not need a custom tool wrapper.

```ts
// src/mastra/agents/main-agent.ts
import { Agent } from '@mastra/core/agent';
import { researchAgent } from './sub/research';
import { schedulingAgent } from './sub/scheduling';

export const mainAgent = new Agent({
  id: 'main-agent',
  name: 'Main Agent',
  instructions: `
You are the user's primary assistant. You handle direct conversational
requests yourself. For specialized work, delegate to the appropriate
sub-agent: research → researchAgent, scheduling → schedulingAgent, etc.
  `,
  model: process.env.MAIN_AGENT_MODEL || 'anthropic/claude-sonnet-4-5',
  agents: { researchAgent, schedulingAgent },
  // tools added dynamically based on user's stored MCP connections
});
```

When the application loads stored agents for a given user, they are registered as additional `agents` on the Main Agent at request time, scoped to that user.

---

## 6. Channel Architecture & Bindings

### 6.1 Channels are inputs, agents are outputs

A **channel** is an entry point: a Telegram bot, a Web UI chat session, a voice call, an email inbox, a webhook. Each incoming message arrives through a channel. The job of the channel layer is to identify the message and hand it to **exactly one** agent.

The mapping is configurable, not hardcoded. It lives in a Postgres table called `bindings`:

```sql
create table bindings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  channel         text not null,         -- 'telegram', 'web', 'voice', 'email', ...
  channel_account text not null,         -- bot token id, web session, phone, ...
  peer_kind       text,                  -- 'direct', 'group', 'channel', 'topic', null = wildcard
  peer_id         text,                  -- the sender or chat id, null = wildcard
  agent_id        text not null,         -- which agent answers
  priority        int not null default 0,
  created_at      timestamptz default now()
);

create index bindings_lookup on bindings(channel, channel_account, peer_id);
alter table bindings enable row level security;
create policy "tenant_isolation_bindings" on bindings
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
```

### 6.2 Resolution algorithm

When a message arrives on `channel='telegram', channel_account='@PatrickFinanceBot', peer_id='123456'`, the channel layer queries `bindings` and applies match precedence (highest priority first):

1. **Most specific:** `(channel, channel_account, peer_id)` matches → return that agent.
2. **Channel + account:** `(channel, channel_account, peer_id IS NULL)` matches → return that agent. (This is the "this whole bot belongs to one agent" case.)
3. **Channel only:** `(channel, channel_account IS NULL, peer_id IS NULL)` → fallback agent for the channel.
4. **Default:** the user's default agent (Main Agent), looked up in `user_settings`.

This is the same precedence model OpenClaw uses for its `bindings`, adapted to Postgres.

### 6.3 The Main Agent's default channel

In Phase 1, the Main Agent owns:
- The default Telegram bot (`TELEGRAM_BOT_TOKEN` from Layer A bootstrap secrets, see §11).
- The Web UI chat (any session that has not been routed elsewhere).
- The voice interface.

These are not hardcoded into the Main Agent — they are seeded as `bindings` rows during onboarding (`channel='telegram', channel_account='<default>', agent_id='main-agent'`, etc.). The user can change them later.

### 6.4 Sub-agent Telegram bots

When the user wants a direct sub-agent channel, they:

1. Create a new Telegram bot via BotFather (manual step, gives them a token).
2. Open MastraClaw's web UI → "Connect Channel" → "Telegram (additional)".
3. Paste the bot token. The token is stored in **Vault** as `telegram_bot_<botname>` (per-user secret).
4. Choose the target sub-agent.
5. The application creates a `bindings` row: `channel='telegram', channel_account='<botname>', agent_id='<sub-agent-id>'`.
6. The application registers a webhook with Telegram pointing the bot at `/api/telegram/<botname>`, so the routing layer knows which bot account triggered each incoming update.

After this, every message to that bot bypasses the Main Agent and goes straight to the sub-agent, with the user's `userId` propagated via `requestContext`.

### 6.5 Code structure

```
src/app/api/telegram/[bot]/route.ts   ← Telegram webhook entry, identifies bot account
src/lib/channels/telegram/             ← outbound (sending messages, voice, files)
src/lib/channels/router.ts             ← bindings resolution
src/lib/channels/dispatch.ts           ← takes (userId, agentId, message) → invokes scopedMastra
```

Channels are **code**, not data. Adding a new channel type (Slack, Teams, WhatsApp) means writing a new adapter and shipping it via redeploy. But adding a new bot or routing rule for an existing channel type is data — Vault token + a row in `bindings`. No redeploy.

---

## 7. Workspaces: Per-Agent, S3-Backed

### 7.1 Concept

A **workspace** is a per-agent filesystem that holds:
- The agent's persona files: `AGENTS.md`, `IDENTITY.md`, `SOUL.md`
- The agent's skills (Markdown files in `skills/`)
- Generated artifacts (PDFs, images, transcripts)
- Per-conversation chat history snapshots
- Logs and metadata

This is the same model as OpenClaw's per-agent workspace concept and the same model Mastra's `Workspace` class expects.

### 7.2 S3-backed via `@mastra/s3` + Supabase Storage

Workspaces are not stored on local disk. Local disk on Vercel/Railway is ephemeral and unfriendly to disposable infrastructure. Instead, workspaces live in a Supabase Storage bucket that exposes an S3-compatible API.

```ts
// src/mastra/index.ts (excerpt)
import { Workspace } from '@mastra/core/workspace';
import { S3Filesystem } from '@mastra/s3';

const workspaceFilesystem = new S3Filesystem({
  bucket: 'workspaces',
  region: 'auto',
  endpoint: `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co/storage/v1/s3`,
  accessKeyId: process.env.SUPABASE_S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.SUPABASE_S3_SECRET_ACCESS_KEY!,
  forcePathStyle: true,
  prefix: '', // see per-agent prefix below
});
```

### 7.3 Per-agent + per-user prefix

Each workspace is a subtree of the bucket, identified by `users/<userId>/agents/<agentId>/`. The application creates a per-request `Workspace` whose `prefix` is bound to the requesting user and the target agent. This way:

- One bucket holds **all** workspaces.
- Listing or reading any path automatically respects the user/agent boundary because the prefix is in the path.
- Supabase Storage RLS policies on the `storage.objects` table additionally enforce that the authenticated user can only read/write paths starting with `users/<their-uid>/`.

Two independent security boundaries again: application prefix + storage RLS.

### 7.4 Dynamic workspaces

Mastra's `EditorWorkspaceNamespace` exposes CRUD for workspaces as stored resources. A user creating a new agent in the web UI also creates a new workspace row, which the agent-hydration code uses to materialize a `Workspace` instance pointed at the right S3 prefix. This is fully runtime; no redeploy.

---

## 8. Skills

### 8.1 Format: AgentSkills-compatible Markdown

Skills are Markdown files with YAML frontmatter, following the AgentSkills format (the same format Anthropic Skills and OpenClaw Skills use):

```markdown
---
name: pdf-export
description: Export a document to PDF using the corporate template.
metadata:
  mastraclaw:
    requires:
      env: []
      tools: []
---

# Instructions

Use the `pdfRender` tool to generate a PDF...
```

This format is portable: skills written for OpenClaw can be imported into MastraClaw with at most a metadata-block rename, and vice versa.

### 8.2 Where skills live

Skills live in workspaces — meaning, in the S3-backed workspace of an agent under `users/<userId>/agents/<agentId>/skills/`. They are not in the Git repo. They are not in the database (the file content is in S3; only an index/metadata row is in Postgres via Mastra's Editor).

This means:
- Adding a skill is a file upload (or a "create skill" form in the web UI). No redeploy.
- Skills are per-agent **and** per-user. The same skill name can have different content for two different agents owned by two different users. No collision.
- Backup of the S3 bucket = backup of all skills.

### 8.3 Loading

Mastra's workspace abstraction loads skills lazily at agent invocation, filtered by metadata gates (required env vars, required tools). The Main Agent's skill list is the union of:
- Built-in skills shipped in the repository under `src/mastra/skills/built-in/` and copied into every fresh user workspace at onboarding,
- User-uploaded skills in the user's workspace.

### 8.4 Bundled vs. installed vs. user-created

Three sources, in precedence order from highest to lowest:
1. **User-created skills** — anything the user wrote or modified themselves, in their workspace.
2. **Installed skills** — skill packages the user installed from a future skill marketplace, also in their workspace, marked as `source: 'installed'`.
3. **Built-in skills** — shipped with the application, baseline behavior.

User edits override installed; installed override built-in. The same precedence model that OpenClaw uses.

---

## 9. Stored Resources & The Mastra Editor

Mastra's `@mastra/editor` package provides CRUD + versioning for runtime-defined resources. MastraClaw uses it for everything that should be user-editable without a redeploy.

### 9.1 What can be stored at runtime

| Resource | Stored? | How added |
|---|---|---|
| Agents | ✅ | Web UI form ("Create Agent"), via `scopedMastra(userId).agent.create({...})` |
| Prompt Blocks | ✅ | Web UI ("Prompt Library") |
| Skills | ✅ | Web UI upload or in-browser Markdown editor |
| MCP Clients | ✅ | Web UI ("Connect MCP Server") |
| Scorers | ✅ | Web UI ("Eval Library") |
| Workspaces | ✅ (auto) | Created automatically when an agent is created |
| **Tools (custom code)** | ❌ | Code in `src/mastra/tools/`, redeploy. Or via MCP server. |
| **Workflows** | ❌ | Code in `src/mastra/workflows/`, redeploy. |
| **Channel adapters** | ❌ | Code in `src/lib/channels/`, redeploy. |

### 9.2 Versioning

Every stored resource carries a version history. A save creates a new `draft`. Promoting a draft to `published` makes it the active version. The previous published version becomes `archived` and can be restored. This is built into Mastra's Editor namespace; the application surfaces it via the web UI.

The implication is that A/B testing and rollback are first-class:

```ts
// Default: load the published version
const agent = mastra.getAgentById('research-agent');

// For internal testing, load the draft
const draftAgent = mastra.getAgentById('research-agent', { status: 'draft' });

// For pinned experiments
const v3 = mastra.getAgentById('research-agent', { versionId: 'v3-uuid' });
```

The `scopedMastra(userId).invoke()` helper exposes a status/version override parameter so the web UI can show "test draft" buttons.

---

## 10. Tools, MCP, and Workflows: The Code-vs-Data Boundary

### 10.1 Code-defined tools

Some tools are TypeScript code: they call internal services, hold business logic, need test coverage, are part of the system contract. These live in `src/mastra/tools/`, are registered in `src/mastra/index.ts`, and require a redeploy to change.

Examples: a `sendTelegramMessage` tool that wraps the outbound Telegram client, a `renderCorporatePdf` tool that uses the SHIFT corporate-identity template, a `scheduleReminder` tool that talks to the Cron table.

### 10.2 MCP-provided tools (the dynamic path)

For everything else — Notion, GitHub, Linear, Gmail, Spotify, Apple Notes, Obsidian, etc. — the user does not get custom code per integration. Instead, the user connects an MCP server through the web UI:

1. User clicks "Connect MCP Server" → enters URL/command and (if needed) auth.
2. The application stores the connection as a `stored_mcp_client` (Mastra Editor) scoped to the user.
3. At agent invocation time, the MCP client connects, lists its tools, and exposes them to the requesting agent.

This means the tool catalog grows at runtime without code changes. New MCP servers in the ecosystem become available immediately.

For curated managed integrations, MastraClaw can pre-register **tool providers** (Composio, Arcade) in code, so the user only needs to OAuth into a service to gain its tools. This is also a Mastra-native pattern via the Editor's `toolProviders` config.

### 10.3 Workflows are code, period

Workflows are durable, multi-step orchestration logic (`createWorkflow().then(...).then(...).commit()`). They use control flow that cannot reasonably be expressed as data. They live in `src/mastra/workflows/`, are registered in `src/mastra/index.ts`, and require a redeploy to change.

This is a deliberate architectural commitment. We do not build a "workflow JSON interpreter" in Phase 1. If the user wants a new workflow, the maintainer ships it via Git. The advantage is that workflows are real TypeScript: tested, type-checked, debuggable, free to use any imports.

### 10.4 The "agent triggers a redeploy" question

The agent **cannot** load new TypeScript code at runtime. There is no eval, no dynamic import of unknown files, no hot-reload of new workflows. Loading user-supplied code at runtime is a security catastrophe and not on the table.

What is possible:
- An admin endpoint can call a Vercel/Railway **Deploy Hook** (a stable HTTPS URL that triggers a fresh deploy from the latest Git commit). This is useful for the maintainer to ship a new workflow.
- The agent itself does **not** trigger this. It is a manual or scheduled operation by Patrick.

If, in the future, dynamic workflow definitions become necessary, the right approach is to introduce a small JSON-DSL workflow runner (a generic step interpreter) and let users define those workflows in Postgres. That is a Phase-3 conversation, not Phase 1.

---

## 11. Secrets — Two Layers

### 11.1 The two layers

| Layer | Where it lives | Who manages it | What it holds | Loaded at |
|---|---|---|---|---|
| **Layer A — Bootstrap** | env vars on Vercel/Railway | Patrick (manually, ~5 values) | `DATABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY` | server boot time |
| **Layer B — User Secrets** | Supabase Vault | The user, via the web UI wizard | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, MCP auth tokens, integration tokens | lazily, per agent invocation |

This separation is deliberate: Layer A is what the system needs to start; Layer B is what features need to actually do work. Layer A is small, stable, sensitive at the infrastructure level. Layer B is dynamic, growing, sensitive at the user level.

### 11.2 Layer B in detail: Supabase Vault

Supabase Vault stores secrets in a special Postgres table (`vault.secrets`) with column-level encryption via `pgsodium`. The encryption key never lives in the database itself — it is managed by Supabase's backend (or by `pgsodium` key management on self-hosted Supabase). Backups (`pg_dump`) contain only ciphertexts.

```sql
-- Writing a secret (called from a Server Action)
select vault.create_secret(
  'sk-proj-AbCdEf...',
  '{userId}:openai_api_key',
  'OpenAI API key for default user'
);

-- Reading a secret
select decrypted_secret
from vault.decrypted_secrets
where name = '{userId}:openai_api_key';
```

The naming convention `{userId}:{secret_name}` ensures per-user isolation. Combined with RLS policies on `vault.decrypted_secrets`, a user can only read their own secrets.

### 11.3 The `SecretService` abstraction

Application code never reads from Vault directly. It goes through `src/mastra/lib/secret-service.ts`:

```ts
import { sql } from '@/lib/db';

export class SecretService {
  private cache = new Map<string, { value: string; expires: number }>();

  constructor(private userId: string) {
    if (!userId) throw new Error('SecretService requires a userId');
  }

  async get(name: string): Promise<string> {
    const key = `${this.userId}:${name}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;

    const rows = await sql`
      select decrypted_secret
      from vault.decrypted_secrets
      where name = ${key}
      limit 1
    `;
    if (!rows[0]) throw new Error(`Secret ${name} not found for user ${this.userId}`);

    const value = rows[0].decrypted_secret;
    this.cache.set(key, { value, expires: Date.now() + 5 * 60_000 }); // 5min in-memory cache
    return value;
  }

  async set(name: string, value: string): Promise<void> {
    const key = `${this.userId}:${name}`;
    await sql`select vault.create_secret(${value}, ${key}, '')`;
    this.cache.delete(key);
  }

  async list(): Promise<{ name: string; description: string }[]> {
    const rows = await sql`
      select name, description
      from vault.secrets
      where name like ${`${this.userId}:%`}
    `;
    return rows.map(r => ({
      name: r.name.slice(this.userId.length + 1),
      description: r.description,
    }));
  }
}
```

This service is constructed per request, scoped to the authenticated user. It is the **only** interface to user secrets in the application.

### 11.4 The setup wizard

The web UI has a setup wizard accessible from the user menu. It is a step-by-step form that captures required secrets:

1. "Choose your LLM provider" → enter OpenAI / Anthropic / Google key → stored via `secretService.set('openai_api_key', ...)`
2. "Connect Telegram" → enter bot token → stored as `telegram_main_bot_token`
3. "Add MCP server" → URL + auth → stored as `mcp_<name>_token`
4. ...

No secret is ever shown to the client after being entered. The form posts to a Server Action that stores the value in Vault and returns success/failure only.

### 11.5 Why no `MASTER_KEY`

A previous iteration of this design used a custom AES-GCM crypto layer with a `MASTER_KEY` env var. Vault makes this unnecessary: pgsodium manages its own keys, and the application never holds the encryption key. One less env var, one less moving part, one less thing to lose.

### 11.6 Future migration path

The `SecretService` is a thin abstraction. If the project ever needs to switch from Vault to Infisical, HashiCorp Vault, or another secret manager, only `secret-service.ts` changes. The interface is stable. This is on purpose — no application code should ever talk to a specific secret backend directly.

---

## 12. Backup & Restore

### 12.1 What needs to be backed up

| Data | Lives in | Backed up by |
|---|---|---|
| Mastra state (agents, prompts, skills, mcp, scorers, memory, sessions) | Supabase Postgres | `pg_dump` / Supabase managed backups |
| User secrets | Supabase Vault (also in Postgres) | same `pg_dump`, ciphertexts only |
| App tables (bindings, user settings, ...) | Supabase Postgres | same `pg_dump` |
| Workspace files (skill content, generated PDFs, ...) | Supabase Storage bucket | `aws s3 sync` / `rclone` / Supabase managed backup |
| Embeddings (pgvector) | Supabase Postgres | same `pg_dump` |
| Layer A bootstrap secrets | env vars on host | Manual: 1Password / Bitwarden |

The compute layer (Vercel / Railway container) holds **nothing**. It is not part of the backup set.

### 12.2 Backup procedure

A scheduled job (daily, runs in a small server-side route or as a cron on the host) executes:

```bash
# 1. Postgres dump
pg_dump --no-owner --no-acl "$DATABASE_URL" \
  | gzip \
  > "backup-$(date +%F).sql.gz"

# 2. Storage bucket sync
aws s3 sync \
  "s3://workspaces" \
  "./backup-storage-$(date +%F)/" \
  --endpoint-url "https://${SUPABASE_PROJECT_REF}.supabase.co/storage/v1/s3"

# 3. Push to off-site
rclone copy ./backup-* remote:mastraclaw-backups/
```

The off-site target is the user's choice (Backblaze B2, Hetzner Storage Box, encrypted disk at home, etc.). Phase 1 ships with a built-in scheduled task for this; Phase 2 makes the destination configurable in the web UI.

### 12.3 Restore procedure

```bash
# Provision a fresh Supabase project (or self-host instance), then:

# 1. Restore Postgres
gunzip -c backup-2026-04-08.sql.gz | psql "$NEW_DATABASE_URL"

# 2. Restore Storage
aws s3 sync \
  ./backup-storage-2026-04-08/ \
  "s3://workspaces" \
  --endpoint-url "https://${NEW_PROJECT_REF}.supabase.co/storage/v1/s3"

# 3. Update Layer A env vars on host with new project credentials
# 4. Redeploy the Next.js application
```

That is the entire restore procedure. The compute layer comes back from a redeploy of the Git repository — there is nothing else to restore.

### 12.4 Backup integrity tests

Phase 1 includes a manual quarterly drill:
1. Spin up a throwaway Supabase project.
2. Restore last week's backup into it.
3. Boot a parallel Vercel preview deploy pointing at the restored backend.
4. Verify the user can log in, see their data, send a test message, and get a reply.
5. Tear down the throwaway resources.

This is the only way to know that backups actually work. Untested backups are wishes.

---

## 13. Deployment & Restart

### 13.1 Single deployment unit

There is exactly one thing to deploy: the Next.js application (which contains Mastra). Vercel and Railway are the two supported targets in Phase 1. Both are evaluated continuously; the architecture works on either.

```
git push origin main
  ↓
Vercel/Railway picks up the commit
  ↓
build (next build)
  ↓
deploy
  ↓
new container is live, old container is drained
```

No second service to deploy in lockstep. No coordination problem. No version skew between frontend and backend (they are the same artifact).

### 13.2 When to redeploy

Only for **code** changes:
- New workflow added or workflow logic changed
- New code-defined tool, new code-defined agent
- New channel adapter (Slack, Teams, ...)
- New MCP transport, new storage adapter, new framework version
- Schema migrations (Supabase)
- Bug fixes

**Not** for data changes:
- New stored agent / new user-created agent → no redeploy
- New skill uploaded → no redeploy
- New MCP connection added → no redeploy
- New Telegram bot binding → no redeploy (only Vault entry + bindings row + Telegram webhook registration)
- New secret entered in the wizard → no redeploy
- Prompt edited → no redeploy

This is the line that keeps user-facing iteration fast and code changes infrequent.

### 13.3 Deploy hooks (controlled, manual)

A Vercel/Railway Deploy Hook URL is a stable HTTPS endpoint that triggers a fresh deploy from the latest Git commit. We expose this in the maintainer-only admin area:

- Patrick wants to roll out a new workflow he just pushed → admin UI → "Deploy now" button → POST to the hook URL.
- Never exposed to end users. Never automated.

Deploy hooks do **not** push new code into the running container — they kick off a normal CI build. The new code must already be in the Git commit the hook references.

---

## 14. Mastra Studio: Dev-Only

Mastra Studio is the framework's built-in admin UI. It runs as a separate process (`mastra dev`) and connects to the same Postgres database the application uses. We use it during development:

```bash
npm run dev:studio   # starts Studio on http://localhost:4111
```

Studio is **not** part of the production deployment. The production user interface is MastraClaw's own Next.js application, which exposes a focused, custom UI built for the personal-agent use case (not for framework debugging).

Optionally, in Phase 2 or 3, we can selectively embed individual components from `@mastra/playground-ui` (the React component library Studio is built on) into our own admin pages — for example, the trace timeline view. But this is opt-in and behind a wrapper layer (`src/lib/mastra-ui.ts`) so we can vendor or replace components if the upstream library makes breaking changes.

---

## 15. Observability

Mastra ships with `@mastra/observability` which provides OpenTelemetry-style tracing across agent invocations, tool calls, memory operations, and workflow steps. MastraClaw configures it with:

- **DefaultExporter** — writes traces into the Mastra storage (Postgres) for later inspection via Studio or our own admin UI.
- **SensitiveDataFilter** — redacts API keys, auth tokens, and PII from trace payloads before they leave the process.
- **Optional CloudExporter** — if `MASTRA_CLOUD_ACCESS_TOKEN` is set, additionally streams traces to Mastra Cloud.

For production-grade observability across the rest of the stack (Next.js, channel adapters, Cron jobs), we use the standard Vercel/Railway logging plus optional Langfuse / OpenTelemetry exporters configurable via env vars. This is described in `CLAUDE.md`.

---

## 16. What Lives Where — The Summary Table

| Concern | Location | Mutability |
|---|---|---|
| Mastra instance (one) | `src/mastra/index.ts` | Code (redeploy) |
| Code-defined agents (Main Agent, system sub-agents) | `src/mastra/agents/` | Code (redeploy) |
| Code-defined tools | `src/mastra/tools/` | Code (redeploy) |
| Workflows | `src/mastra/workflows/` | Code (redeploy) |
| Scorers | `src/mastra/scorers/` | Code (redeploy) |
| Channel adapters (Telegram, voice, web) | `src/lib/channels/` | Code (redeploy) |
| Built-in skills (shipped baseline) | `src/mastra/skills/built-in/` | Code (redeploy), copied to user workspace at onboarding |
| `scopedMastra` wrapper | `src/mastra/lib/scoped-mastra.ts` | Code (redeploy) |
| `SecretService` | `src/mastra/lib/secret-service.ts` | Code (redeploy) |
| Stored agents (user-created) | Supabase Postgres (Mastra storage) | Runtime |
| Prompt blocks | Supabase Postgres (Mastra storage) | Runtime |
| MCP client connections | Supabase Postgres (Mastra storage) | Runtime |
| Scorer configs | Supabase Postgres (Mastra storage) | Runtime |
| Memory threads, messages, working memory | Supabase Postgres (Mastra storage) | Runtime |
| Embeddings (semantic recall, RAG) | Supabase Postgres (pgvector) | Runtime |
| Workspaces (per agent, S3-prefixed) | Supabase Storage bucket | Runtime |
| Skill files (Markdown content) | Supabase Storage bucket | Runtime |
| Generated PDFs / images / artifacts | Supabase Storage bucket | Runtime |
| Bindings (channel → agent) | Supabase Postgres app table | Runtime |
| User settings | Supabase Postgres app table | Runtime |
| User secrets (LLM keys, bot tokens, ...) | Supabase Vault | Runtime |
| Bootstrap secrets (DB URL, S3 keys, service role) | Vercel/Railway env vars | Manual (host config) |
| Backups | Off-site (Backblaze / Hetzner / etc.) | Scheduled job |

---

## 17. Phase 1 Implementation Checklist

This is the actionable plan for getting Phase 1 to a working state. Each item is concrete and has a clear "done" criterion.

### 17.1 Foundation
- [ ] Replace `@mastra/libsql` with `@mastra/pg` in `package.json`. Pin both `@mastra/pg` and `@mastra/s3` to exact versions.
- [ ] Install `@mastra/s3@0.3.0`, `@supabase/ssr`, `@supabase/supabase-js`, `postgres` (raw query client for Vault).
- [ ] Add Supabase project, capture `DATABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_ROLE_KEY`, S3 access key + secret to local `.env.local`.
- [ ] Update `src/mastra/index.ts` to use `PostgresStore` for storage, `S3Filesystem` for the workspace filesystem, and to keep Editor + Observability enabled.
- [ ] Run `mastra dev` once to let Mastra create its Postgres tables.

### 17.2 Multi-tenancy foundation
- [ ] Create `supabase/migrations/0001_enable_rls.sql` that enables RLS and adds tenant policies on every Mastra table the storage adapter created (`mastra_agents`, `mastra_prompt_blocks`, `mastra_skills`, `mastra_mcp_clients`, `mastra_scorers`, `mastra_workspaces`, `mastra_memory_threads`, `mastra_memory_messages`, ...).
- [ ] Create `src/mastra/lib/scoped-mastra.ts` exactly as sketched in §4.3.
- [ ] Create `src/mastra/lib/errors.ts` with `ForbiddenError`, `NotFoundError`.
- [ ] Add an ESLint rule (or a CI grep) that fails the build when a file with `'use client'` imports from `@/mastra` or `@mastra/*`.
- [ ] Add a CI grep that fails the build when `mastra.editor.` is referenced outside of `src/mastra/lib/scoped-mastra.ts` or `src/mastra/index.ts`.

### 17.3 Auth
- [ ] Configure Supabase Auth in the Supabase dashboard. Magic Link is sufficient for Phase 1.
- [ ] Set up `@supabase/ssr` in Next.js. Create `src/lib/supabase/server.ts` and `src/lib/supabase/client.ts` (the latter only for safe operations like login UI; never imports `@/mastra`).
- [ ] Add a login page (`src/app/login/page.tsx`) and an auth middleware that protects `/api/*` and any signed-in pages.
- [ ] Helper: `getUserId()` server-side utility that returns the authenticated user's UUID or throws.

### 17.4 Secrets
- [ ] Enable Supabase Vault in the Supabase dashboard. Verify that `vault.secrets` and `vault.decrypted_secrets` exist.
- [ ] Add an RLS policy on `vault.decrypted_secrets` that only allows reading where `name like '<authuid>:%'`.
- [ ] Implement `src/mastra/lib/secret-service.ts` per §11.3.
- [ ] Build the setup wizard pages: at minimum, an LLM-key entry step and a Telegram bot token step.

### 17.5 The Main Agent
- [ ] Create `src/mastra/agents/main-agent.ts` as a code-defined agent. Sensible default model. Empty sub-agent list initially.
- [ ] Register the Main Agent in `src/mastra/index.ts`.
- [ ] Create a server-only chat Route Handler (`src/app/api/chat/route.ts`) that uses `scopedMastra(userId).invoke('main-agent', message)`.
- [ ] Create a minimal client chat UI that posts to that route.

### 17.6 Channels
- [ ] Create `bindings` table migration with RLS.
- [ ] Implement `src/lib/channels/router.ts` (resolution algorithm from §6.2).
- [ ] Implement `src/lib/channels/dispatch.ts` (binds resolved agent to scoped Mastra invocation).
- [ ] Implement Telegram inbound: `src/app/api/telegram/[bot]/route.ts`. Reads bot token from Vault, validates webhook signature, parses update, identifies the user and the bot, calls dispatch.
- [ ] Implement Telegram outbound: `src/lib/channels/telegram/send.ts`.
- [ ] Onboarding step: when a user completes setup, create the default Telegram binding (`channel='telegram', channel_account='<default>', agent_id='main-agent'`).

### 17.7 Workspaces & Skills
- [ ] Verify `S3Filesystem` connects to Supabase Storage. Bucket `workspaces` exists, RLS policy allows `users/<authuid>/...`.
- [ ] Onboarding step: create the user's default workspace folder in S3.
- [ ] Copy the bundled built-in skills from `src/mastra/skills/built-in/` to the user's workspace at first login.
- [ ] Skill management UI: list skills in the user's workspace, upload Markdown, view, edit, delete.

### 17.8 Backup
- [ ] Cron job (Vercel Cron / Railway scheduled task) that runs daily and dumps Postgres + syncs Storage to off-site.
- [ ] Document the restore procedure in `docs/runbook-restore.md`.

### 17.9 Observability
- [ ] Configure `Observability` in `src/mastra/index.ts` with `DefaultExporter` + `SensitiveDataFilter`.
- [ ] Verify traces show up in the Mastra storage.

### 17.10 Studio
- [ ] Verify `npm run dev:studio` starts Studio at `http://localhost:4111` and points at the same Postgres as the application.

When all of the above are done, Phase 1 ships.

---

## 18. Out of Scope for Phase 1

Things that are explicitly **not** part of Phase 1, even if mentioned elsewhere in this document:

- A second user. Onboarding flow stays single-user. Magic Link is enabled but only Patrick has an account.
- A skill marketplace.
- Deploy-Hook automation from inside the agent.
- A JSON workflow DSL.
- Direct sub-agent Telegram bots beyond proof-of-concept (the *infrastructure* is in place from day one — bindings, per-bot webhook routing, Vault token storage — but the production-quality wizard for "create new sub-agent bot" lands in Phase 2).
- Slack, Teams, WhatsApp, Discord channels.
- Org/team structures.
- Billing or quota.
- A formal admin role system. Patrick is the only user; "admin" is `userId === his uuid`.
- SOC2-grade audit logging beyond what `@mastra/observability` provides by default.

These are documented for future reference but not built now. The architecture supports them; they just are not the immediate work.

---

## 19. Open Questions

These are unresolved decisions that need answering before or during Phase 1, but do not block writing the bulk of the code:

1. **Which voice provider for STT?** ElevenLabs is committed for TTS. STT could be Whisper API, Sherpa ONNX, Apple/Google native, or a hosted alternative. Decision deferred until voice is being implemented.
2. **Cron infrastructure.** Vercel Cron is the simplest path, Trigger.dev is more powerful, a Postgres-table-based heartbeat runner (à la OpenClaw) is the most sovereign. Probably Vercel Cron in Phase 1, Trigger.dev or own table later.
3. **Memory tier storage layout.** Mastra's `@mastra/memory` provides the four-tier model. The exact configuration (sliding window size, semantic recall thresholds, working memory schema) should be tuned during early use.
4. **Skill format extensions.** AgentSkills format is the baseline. We may add MastraClaw-specific frontmatter fields for things like "requires MCP server X" or "applies to agent Y". Decided when first non-trivial skill is built.

---

## 20. Cross-References

- `CLAUDE.md` — Day-to-day coding conventions and quick references for Claude Code instances working in this repo.
- `REQUIREMENTS.md` — Product-level requirements: what the user can do, in plain language.
- `README.md` — High-level project pitch.
- Mastra documentation: https://mastra.ai/docs (always cross-check against `node_modules/@mastra/*/dist/docs/` because the framework moves fast).
- Supabase documentation: https://supabase.com/docs
