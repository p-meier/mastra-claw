# MastraClaw — Requirements

## Vision

MastraClaw is an enterprise-ready personal AI agent for executives, founders, solopreneurs, and small business leaders. It replaces a human executive assistant — managing email, calendar, research, content, and enterprise data access — available 24/7 via voice, chat, and web interface.

The product ships as a **minimal, curated base** with a secretary agent and core skills. Additional capabilities (social media management, CRM integration, custom workflows) are delivered as installable modules or custom consulting engagements.

---

## 0. Core Principle — Human-in-the-Loop

**No destructive action without explicit user approval.** This is the foundational reliability principle of MastraClaw.

The agent MUST request approval before:
- Sending any email
- Publishing any social media post
- Modifying calendar events (create, move, cancel)
- Executing any action that affects external systems
- Spending money (API calls above threshold, purchases)

Approval can be granted via any connected channel (Telegram, Teams, Web UI). The agent presents a clear summary of what it intends to do and waits for explicit confirmation. Configurable per action type: some actions can be set to auto-approve after the user builds trust (e.g., "always auto-approve calendar event creation").

Timeout handling: if no approval within a configurable window, the agent sends a reminder. After a second timeout, the task is parked and flagged in the review board.

---

## 1. Base Agent — Secretary Mode

The core deliverable. A personal agent that functions as an executive assistant.

### 1.1 Email Management
- Read, compose, and send emails on behalf of the user
- Organize emails into folders/labels based on personal preferences and rules
- Summarize inbox (unread count, priorities, flagged items)
- Draft replies with context from previous conversations
- Integration: IMAP/SMTP, Gmail API, Microsoft Graph (Outlook)
- Composio.dev for unified email provider abstraction

### 1.2 Calendar Management
- View, create, modify, and cancel calendar events
- Detect scheduling conflicts
- Suggest optimal meeting times
- Integration: Google Calendar, Microsoft 365, CalDAV
- Prepare pre-meeting context (who is the person, last interaction, company background)

### 1.3 Daily Morning Brief
- Implemented as a **default skill** that ships with MastraClaw
- User can customize the skill (content, format, sections) without coding
- Automated daily digest delivered at a configured time (scheduled task)
- Contents: today's schedule, priority emails, open tasks/reviews, news relevant to the user's industry
- Delivered as text (chat), audio (voice message), or both
- Configurable: what sections to include, delivery time, delivery channel

### 1.4 Reminders & Scheduled Tasks
- **One-off reminders**: "Remind me at 3pm to call Wolfgang"
- **Recurring tasks**: "Every Monday at 9am, send me a summary of last week's LinkedIn engagement"
- Cron-based scheduling system with UI management
- Delivery to any connected channel
- Failure notifications if a scheduled task fails

### 1.5 Memory & Personalization
- **Setup Interview**: On first use, the agent interviews the user about their role, business, preferences, communication style, key contacts, and industry
- Stored as structured working memory, accessible across all sessions
- Agent learns preferences over time (observational memory)
- User can view and edit stored memory via web UI
- Memory consolidation via Mastra's Observational Memory: agent autonomously stores and retrieves facts it notices. A scheduled "reflection" workflow could periodically consolidate and structure accumulated observations (similar to OpenClaw's "Dreaming" concept).

### 1.6 Voice I/O
- **Speech-to-Text input**: User sends voice messages via Telegram/Teams/Web, agent transcribes and processes
- **Text-to-Speech output**: Agent responds with audio messages that can be listened to on mobile
- ElevenLabs for high-quality TTS, configurable voice/model
- Support for Whisper or Sherpa ONNX as STT alternatives
- Full conversation flow: user speaks → agent processes → agent responds with voice + text

### 1.7 Multimodal Understanding
- Understand images sent by the user (screenshots, photos, documents)
- Process PDFs and extract content
- Analyze attachments in context of the conversation

### 1.8 Document Generation & Storage
- Generate PDFs in corporate identity (letterhead, branding, fonts)
- Generate slide decks (PPTX) for presentations
- Generate Word documents (DOCX) for reports and proposals
- Templates configurable per user/company — delivered as customizable skills
- Output delivered in chat, via email, or stored in document store
- **File Storage**: All generated documents stored in **Convex File Storage** (primary), searchable and accessible via MCP
- **Optional**: MinIO (S3-compatible) as alternative storage backend for on-premise deployments with large file volumes

### 1.9 YouTube Summarization
- User shares a YouTube URL → agent extracts transcript → generates summary
- Output as text, audio briefing, or email
- Skill or lightweight workflow

---

## 2. Research Module

### 2.1 Company Research
- Research a company on demand: financials, leadership, recent news, competitive landscape
- Data sources: NorthData, Handelsregister, Crunchbase, company websites
- Web scraping: Firecrawl, Apify
- AI-enhanced search: Perplexity, Parallel AI
- Output: structured briefing document (PDF + audio), stored in document store

### 2.2 Person/Contact Research
- Research a person before a meeting: LinkedIn profile, mutual connections, recent activity, published articles
- LinkedIn integration via Apify or official API
- Cross-reference with internal CRM data if connected
- Output: one-page briefing, optionally read aloud

### 2.3 Ad-Hoc Mobile Briefing
- User says: "I'm heading to company XYZ, brief me"
- Agent runs company + key contacts research in background
- Delivers PDF and/or audio briefing to mobile channel
- Must work asynchronously — user triggers, agent works, agent delivers when ready

### 2.4 Industry Monitoring
- Configurable watchlists: companies, people, topics, competitors
- Periodic scan (scheduled) with alerts on significant changes
- Sources: news APIs, RSS, LinkedIn, company filings

---

## 3. Channels & Delivery

### 3.1 Supported Channels
- **Telegram** — Primary mobile channel, voice messages, inline keyboards
- **Microsoft Teams** — Enterprise standard, required for corporate adoption
- **Slack** — Tech/startup teams
- **Discord** — Community/internal teams
- **Web UI** — Built-in chat interface (see section 5)
- Additional channels via Vercel Chat SDK as needed

### 3.2 Channel Architecture
- One main agent accessible from all channels
- Cross-channel notifications: task started in web UI, notification delivered to Telegram
- Channel-specific formatting (Telegram markdown vs. Teams adaptive cards)
- User allowlist per channel for security

### 3.3 Voice-First Mobile Experience
- Optimized for on-the-go usage via Telegram/Teams voice messages
- Agent responds with both text and audio
- Quick commands: "Brief me on XYZ", "What's on my calendar?", "Draft an email to..."

### 3.4 Slash Commands
Predefined shortcuts for frequent actions, available in all channels and web UI chat:

| Command | Action |
|---------|--------|
| `/brief` | Trigger daily morning brief on demand |
| `/research <company/person>` | Start a company or person research |
| `/remind <time> <message>` | Set a one-off reminder |
| `/email` | Show inbox summary, start composing |
| `/calendar` | Show today's/this week's schedule |
| `/status` | Show pending tasks, running workflows, open reviews |
| `/memory` | Show what the agent knows about the user |
| `/help` | List available commands and capabilities |

Slash commands are implemented as skills — users and developers can add custom commands by adding new skills.

---

## 4. Scheduled & Background Tasks

### 4.1 Scheduling System
- Cron-based scheduler for recurring tasks (daily briefs, weekly reports, content publishing)
- One-off scheduled tasks (reminders, delayed sends)
- UI for managing schedules (create, edit, disable, view run history)
- Configurable delivery channel per schedule

### 4.2 Background Task Execution
- Long-running tasks (research, content creation) run asynchronously
- Agent notifies user when task is complete
- Queue mode: user can queue multiple tasks from mobile, agent processes sequentially
- Task status visible in web UI

### 4.3 Event-Based Triggers (Future)
- Mastra's API already supports external triggers — webhooks can be set on any endpoint
- Example: "When an email from X arrives, summarize it and send to Telegram"
- Not an MVP priority — most use cases are covered by polling-based scheduled tasks
- Social media module and similar extensions use their own polling cycles for data synchronization

---

## 5. Web UI

### 5.1 Design Principles
- **Non-technical users**: Must be usable by a CEO who is not a developer
- **Clean, minimal interface**: No developer jargon, no JSON editing
- **Mobile-responsive**: Usable on tablet and phone
- Standard UI framework (Next.js + shadcn/ui) for extensibility

### 5.2 Chat Interface
- Full chat with the agent, markdown rendering, file attachments
- Voice input/output in browser
- Message history with search
- Session management (new conversation, continue existing)

### 5.3 Task/Review Board
- Kanban-style board for tasks that need user review
- Columns: Pending → In Review → Approved → Done
- Per-task conversation thread (user can discuss with agent about a specific task)
- Drag-and-drop status changes
- Inspired by Paperclip's issue system

### 5.4 Workflow Launcher
- List of available workflows with descriptions
- One-click trigger with parameter input (simple form, not code)
- View running/completed workflow status
- Scheduled workflow management

### 5.5 Settings & Configuration
- Agent personality and preferences
- Connected accounts (email, calendar, LinkedIn, etc.)
- Channel management (connect/disconnect Telegram, Teams, etc.)
- Notification preferences
- Memory viewer/editor
- Template management (email templates, document templates)

### 5.6 Onboarding Wizard
- Guided first-time setup
- Connect channels, configure email/calendar, set preferences
- Agent interview for personalization
- Also triggerable via Claude Code setup skill

### 5.7 Dashboard
- Overview: today's schedule, pending reviews, recent agent activity
- Usage/cost metrics (tokens, API calls)
- Active scheduled tasks

---

## 6. Social Media Module (Extension)

A separately installable module, not part of the base agent.

### 6.1 LinkedIn Management (MVP)
- Create text posts, image posts, article posts
- Image generation via Nano Banana 2 / Nano Banana Pro
- Video generation via Google Veo 3.1 / Kling / Runway / SeaDream
- Post scheduling with publishing queue
- Idea capture → Research → Draft → Review → Publish pipeline

### 6.2 Content Pipeline
- Kanban board for content lifecycle (Idea → Research → Draft → Review → Scheduled → Published)
- Per-content conversation (refine a post with the agent)
- Templates for recurring content types
- User says: "I read an article about X, make a LinkedIn post about it for the day after tomorrow"
- Agent: researches topic → drafts post → generates image → places in review queue → notifies user

### 6.3 Analytics (Future)
- Post performance tracking
- Engagement metrics
- Best posting time suggestions

---

## 7. Enterprise Integration

### 7.1 MCP Server (Read Access)
- Expose agent data via MCP for Claude Code, Claude Cowork, IDEs
- Read access to enterprise data sources connected via MCP client
- MCP as the universal gateway for external AI tools to query internal systems

### 7.2 CRM Integration (Custom Development)
- Salesforce, HubSpot, Pipedrive connector
- Query pipeline, deals, contacts from mobile via agent
- Custom development per client — not part of base product

### 7.3 Custom Workflows (Consulting)
- Family Office target identification workflows
- Investment memo generation
- Industry-specific automation
- Delivered as installable workflow packages

### 7.4 Composio.dev Integration
- Unified API connection layer
- Secrets management for third-party services
- MCP server aggregation
- Reduces integration complexity

---

## 8. Architecture Constraints

### 8.1 Small Codebase
- Core stays minimal — complexity in frameworks and packages
- New capabilities as skills, tools, and workflows — not core code changes
- No bloated framework with 50+ built-in skills
- Base product ships with essential skills only, rest is modular

### 8.2 Module System
- Core agent + installable modules (social media, CRM connectors, industry packs)
- Modules are self-contained: own workflows, tools, skills, UI components
- Standard interface for module registration
- Modules can add UI pages/tabs to the web dashboard

### 8.3 Transcription Integration
- Granola, Otter.ai, or similar meeting transcription tools
- Agent can process meeting transcripts and extract action items
- Follow-up reminders based on meeting outcomes

### 8.4 Technology Stack
- Agent Framework: Mastra.ai
- Database: Convex.dev (reactive, vector search, full-text search, durable functions)
- Web UI: Next.js + shadcn/ui + Tailwind CSS
- Channels: Vercel Chat SDK
- Model Routing: Vercel AI SDK + AI Gateway
- Durable Execution: Inngest / Workflow SDK
- Observability: Langfuse / Langsmith / OpenTelemetry
- Voice: ElevenLabs (TTS) + Whisper/Sherpa ONNX (STT)
- Validation: Zod

---

## 9. Security & Compliance

### 9.1 Approval Gates (Human-in-the-Loop)
- See Section 0 — this is the core reliability principle
- Implemented as Mastra processors and/or workflow approval steps
- Approval UI in Telegram (inline buttons) and web UI (review board)

### 9.2 Budget & Cost Control
- **Already provided by Mastra Studio** — token usage, cost tracking, per-agent metrics
- Additional: configurable monthly limits with auto-pause per agent
- Alerts at threshold levels via notification channel

### 9.3 Audit Trail
- **Already provided by Mastra Observability** — full tracing via Langfuse/Langsmith/OpenTelemetry
- All agent actions, tool calls, workflow steps traced with timestamps
- SensitiveDataFilter redacts credentials before export
- Sufficient for SOC 2 and enterprise compliance requirements

### 9.4 Security Stack (from CLAUDE.md)
- Separate compute contexts (trusted harness vs. untrusted sandbox)
- PII detection and redaction (`PIIDetector` processor)
- Prompt injection detection (`PromptInjectionDetector` processor)
- Content moderation (`ModerationProcessor`)
- Sensitive data filtering in observability
- Self-hostable for data sovereignty

---

## 10. Notifications & Proactive Behavior

Notifications are delivered via the user's primary mobile channel (typically Telegram).

- Task completed → notify on Telegram even if started via web UI
- Review needed → push to Telegram
- Scheduled task failed → alert immediately
- Approval request → deliver to Telegram with inline action buttons
- Proactive: "You have a meeting with X in 30 minutes — here's the briefing" (scheduled)
- Proactive: "Your LinkedIn post draft from yesterday is still pending review"
- No separate notification infrastructure needed — Telegram IS the notification channel

---

## 11. Multi-Language (Day One)

Multi-language is a standard feature from day one, not an afterthought.

- Agent conversational language configurable (German, English, etc.)
- DACH market primary: German interaction, but research/output in any language
- Templates and UI in German and English
- Model instructions in the user's preferred language
- Language preference stored in user profile (setup interview)

---

## 12. Updateability & Module Management

How the system stays current and how capabilities are added.

### 12.1 Core Updates
- MastraClaw core is a Git repository — updates via `git pull` + `npm install`
- Upstream framework updates (Mastra, Convex, Vercel AI SDK) are dependency bumps, not source rewrites
- Breaking changes documented in CHANGELOG, migration guides provided
- Semantic versioning for release management

### 12.2 Module Installation
- Modules (social media, CRM connectors, industry packs) are npm packages or Git submodules
- Install via CLI: `npx mastraclaw add @mastraclaw/social-media`
- Or manually: add to workspace, register in Mastra config
- Modules are self-contained: own workflows, tools, skills, optional UI components
- Module registry (future): browsable catalog of available modules

### 12.3 Skill Management
- Skills are markdown files — add/edit/remove without code changes
- Default skills ship with the base agent, user can customize them
- Custom skills can be added via the web UI or by dropping files into the skills directory
- Skills are versioned alongside the project

### 12.4 Configuration Updates
- Agent personality, preferences, connected accounts — all via web UI
- No code editing required for standard configuration changes
- Environment variables for infrastructure (API keys, database URLs)
- Settings exportable/importable for backup and migration

---

## Competitive Analysis

### vs. OpenClaw

OpenClaw is a finished product (CLI-first personal assistant). MastraClaw is a framework-based enterprise agent. Key differences and what we adopt:

| Feature | OpenClaw | MastraClaw Status |
|---------|----------|-------------------|
| 20+ channels | Built-in: Telegram, Discord, Slack, Signal, iMessage, WhatsApp, Teams, Matrix, IRC, WeChat, LINE | **Covered** — Vercel Chat SDK for major channels. Niche channels (Signal, iMessage, WeChat) not planned. |
| ~55 bundled skills | Apple Notes, Reminders, Spotify, Obsidian, Notion, Trello, 1Password, smart home | **Different approach** — We ship minimal base skills. Additional capabilities via Composio.dev, not custom skill code. |
| Dreaming (memory consolidation) | Cron-driven short-term → long-term promotion (3 presets) | **Covered** — Mastra's Observational Memory handles this. Optional reflection workflow for deeper consolidation (Tier 4). |
| Progressive skill disclosure | Agent scans descriptions, loads full SKILL.md only if relevant | **Available** — SkillSearchProcessor exists in Mastra. Not our default pattern (we use scoped assignment). |
| TaskFlow (durable background) | State bags for multi-step persistence | **Covered** — Mastra workflows + Inngest provide superior durable execution. |
| ClawHub (skill marketplace) | Community skill repository | **Future (Tier 4)** — Module registry planned, not MVP. |
| CLI-first onboarding | `openclaw onboard --install-daemon` | **Different approach** — Web UI wizard + Claude Code setup skill. |
| Slash commands | `/summarize`, `/remember`, etc. | **Adopted** — Section 3.4. Implemented as skills. |
| MCP bridge (mcporter) | Decoupled, hot-reload | **Covered** — Mastra's built-in MCP client/server. |
| Per-channel identity | Different avatar/name per channel | **Not planned** — Low value for enterprise use case. |

**Summary**: OpenClaw optimizes for breadth (55 skills, 20 channels). MastraClaw optimizes for enterprise depth (compliance, workflows, approval gates, structured data). Most OpenClaw features are either covered by our stack or handled differently via Composio.dev and Mastra's built-in capabilities.

### vs. Paperclip

Paperclip is an orchestration layer for managing external agents as employees. MastraClaw is a self-contained agent framework. Key differences and what we adopt:

| Feature | Paperclip | MastraClaw Status |
|---------|-----------|-------------------|
| Kanban board | Full drag-and-drop, 7 columns | **Adopted (Tier 2)** — Simplified columns for task/review management. |
| Per-task conversations | Threaded comments, @mentions, attachments | **Adopted (Tier 2)** — Critical for content review and task refinement. |
| Budget/cost control | Per-agent monthly budgets, auto-pause, incidents | **Covered** — Mastra Studio provides cost tracking. Additional limits configurable. |
| Approval gates | Request → approve/reject with comments | **Adopted (Tier 1)** — Core principle. Human-in-the-Loop via Mastra suspend/resume. |
| Org chart | SVG agent hierarchy visualization | **Not planned** — Our agent count is smaller, orchestrator/specialist is flat. |
| Multi-company | One deployment, isolated data per company | **Future (Tier 4)** — Multi-tenant consideration, not MVP. |
| Plugin SDK | Sandboxed workers, event bus, UI slots | **Different approach** — Our module system is simpler: npm packages with workflows/tools/skills. |
| Routines with concurrency | Coalesce, skip, always_enqueue policies | **Adopted** — Concurrency policies important for scheduled tasks. Via Inngest. |
| Audit trail | Immutable activity log | **Covered** — Mastra Observability + Langfuse provides full tracing. |
| Agent heartbeat | Wake on schedule, check, work, exit | **Not needed** — Mastra agents are always-on via API. |

**Summary**: Paperclip's strongest contribution to our thinking is the Kanban board with per-task conversations and the approval gate pattern. Both adopted. Their budget/cost and audit features are already covered by Mastra Studio and Langfuse.

---

## Priority Tiers

### Tier 1 — MVP (Base Personal Agent)
- **Human-in-the-Loop** (approval gates for all destructive actions)
- Email management (read, write, organize)
- Calendar management
- Daily morning brief (default skill, user-customizable)
- Reminders (one-off + recurring)
- Voice I/O (Telegram + Web)
- Memory & personalization (setup interview)
- Multi-language (German + English from day one)
- Telegram channel integration
- Web UI (chat + basic settings + onboarding wizard)
- Document generation (PDF) + Convex File Storage
- YouTube summarization
- Basic company/person research
- Module system (install/update mechanism)

### Tier 2 — Enterprise Ready
- Microsoft Teams integration
- Task/review board (Kanban with per-task conversations)
- Scheduled tasks with UI management
- Ad-hoc mobile briefings (PDF + audio)
- MCP server exposure
- Slide generation (PPTX)
- Dashboard (today's overview, usage metrics)

### Tier 3 — Modules & Extensions
- Social media module (LinkedIn MVP)
- Video generation (Veo 3.1, Kling, SeaDream)
- CRM integration (Salesforce, HubSpot) — custom dev
- Industry monitoring / watchlists
- Custom workflow packages (Family Office, etc.)
- Granola/transcription integration
- MinIO/S3 storage backend (on-premise option)

### Tier 4 — Future
- Memory consolidation ("Dreaming" / reflection workflows)
- Skill marketplace / module registry
- Multi-tenant / multi-company
- Additional channels (Signal, WhatsApp, iMessage)
- Event-based triggers / webhooks
- Offline queue mode
