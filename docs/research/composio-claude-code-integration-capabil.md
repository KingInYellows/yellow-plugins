# Composio: Comprehensive Research Report for Claude Code Plugin Integration

**Date:** 2026-03-27
**Sources:** Perplexity Deep Research, Perplexity Reasoning (x2), Tavily Research (pro), Tavily Search (x3), Parallel Deep Research

---

## Summary

Composio is a managed tool integration platform that enables AI agents and LLM applications to discover, authenticate against, and execute actions across 1,000+ third-party service toolkits (exposing 11,000+ individual tools/actions). It acts as both a unified API and an MCP (Model Context Protocol) gateway, providing centralized OAuth/API-key management, a sandboxed remote execution environment (Workbench), and parallel tool execution -- all accessible via Python and TypeScript SDKs or REST API. For Claude Code plugin developers, Composio offers a single integration point to hundreds of services (Slack, Google Workspace, Linear, Notion, CRMs, cloud infrastructure, etc.) that would otherwise each require a dedicated MCP server, at the cost of an intermediary network hop and per-action pricing.

### Current State in Yellow Plugins

Composio is configured at the **user/Claude.ai level** (visible as `mcp__claude_ai_composio__*` tools), not within the yellow-plugins repository. The repo uses a modular MCP architecture with 14 plugins and native integrations (Perplexity, Tavily, EXA, Parallel Task, ast-grep, Linear, Semgrep, etc.). Composio would complement -- not replace -- these existing integrations.

---

## 1. Platform Overview

### What is Composio

Composio (composio.dev) is a managed integration control plane purpose-built for AI agents. Rather than requiring developers to build and maintain individual API integrations, Composio provides a unified layer that handles tool discovery, authentication lifecycle, credential storage, API versioning, and normalized execution.

### Architecture

The platform consists of three primary layers:

1. **Control Plane / Integration Layer** -- Stores tool definitions (toolkits/tools), auth configs, connected accounts, and policies. Performs token management and connector maintenance. Exposes REST API endpoints and MCP management endpoints.

2. **Agent Runtime Sessions (Tool Router)** -- A session encapsulates a runtime view of available tools for a given `user_id` and toolkit selection. Sessions return tool schemas formatted for the target agent/provider (OpenAI, Anthropic, etc.) and provide a session-scoped execution surface. Sessions are **immutable** -- changing toolkits or connections requires creating a new session.

3. **Remote Execution Runtimes** -- Composio offers persistent sandboxed environments (Workbench for Python/Jupyter, Remote Bash for shell commands) that agents can use to run code, process large outputs, and persist state across calls.

### Core Concepts

| Concept | Description |
|---------|-------------|
| **Toolkit** | A collection of related tools for an app (e.g., `GITHUB` toolkit). Named `{TOOLKIT}_{ACTION}` (e.g., `GITHUB_CREATE_ISSUE`) |
| **Tool / Action** | A discrete, callable operation with defined parameters, expected outputs, and error handling |
| **Meta Tools** | Composio-supplied tools for runtime discovery and orchestration (see Section 5) |
| **Connection / Connected Account** | A persisted authentication credential per user per toolkit. States: ACTIVE, INACTIVE, PENDING, INITIATED, EXPIRED, FAILED |
| **Auth Config** | Defines how a toolkit authenticates (OAuth, API key, basic auth). Created once per toolkit per project |
| **Session** | Runtime scope tying together a user, available toolkits, and auth configuration. Immutable after creation |
| **Entity** | Abstract representation of real-world objects enabling cross-service consistency |

---

## 2. Tool Ecosystem

### Scale

| Metric | Count | Notes |
|--------|-------|-------|
| Managed integrations | 500+ | Marketing/guidance pages |
| Toolkits | 1,000+ | Docs landing page and toolkits directory |
| Individual tools/actions | 11,000+ | Tools count across all toolkits |

### Categories and Notable Integrations

**Development & Version Control:** GitHub (86 tools, 620 actions), GitLab, Bitbucket, Docker Hub

**Project Management:** Linear, Jira, Asana (15 tools, 31 actions), Monday.com, Azure DevOps, Shortcut

**Communication:** Slack (15 tools, 19 actions), Discord (16 tools, 1 action), Discord Bot (16 tools, 50 actions), Microsoft Teams

**Email:** Gmail (6 tools, 02 actions), Outlook, SendGrid

**Productivity & Docs:** Notion (4 tools, 75 actions), Google Sheets (46 tools, 16 actions), Google Drive (8 tools, 97 actions), Google Docs, Confluence

**CRM & Sales:** HubSpot (22 tools, 92 actions), Salesforce, Pipedrive, Apollo, Attio

**Cloud & Infrastructure:** DigitalOcean (4 tools, 70 actions), AWS services, Google Cloud, Supabase (12 tools, 10 actions), Firebase

**Databases:** PostgreSQL, MySQL, MongoDB, Airtable

**Payments:** Stripe, Shopify (43 tools, 20 actions)

**AI/ML Services:** OpenAI, Anthropic Administrator, DeepSeek, Apify

**Other Notable:** Figma, Sentry, Datadog, Twilio, Zapier, Make

### Premium Tools

Some tools are classified as "premium" with separate rate limits and pricing (approximately 3x standard tool call cost). Examples include: search APIs, code execution environments (E2B), web scraping, model inference, and document processing tools.

---

## 3. MCP Server Integration

### How It Works

Composio acts as an MCP (Model Context Protocol) gateway. It generates per-session or per-user MCP URLs that any MCP-compatible client (Claude Code, Cursor, Windsurf, etc.) can consume. The flow:

1. Developer creates a Composio session via SDK specifying user and toolkits
2. Session object provides `session.mcp.url`
3. MCP URL is added to the client (e.g., Claude Code)
4. Client discovers and calls tools via standard MCP protocol
5. Composio handles credential management, execution, and response formatting

### Claude Code Configuration

**Step 1: Install SDK and set environment variables**
```bash
pip install composio-core python-dotenv
```

```env
COMPOSIO_API_KEY=your_composio_api_key_here
USER_ID=your_user_id_here
```

**Step 2: Generate MCP URL**
```python
import os
from composio import Composio
from dotenv import load_dotenv

load_dotenv()

composio_client = Composio(api_key=os.getenv("COMPOSIO_API_KEY"))
session = composio_client.create(
    user_id=os.getenv("USER_ID"),
    toolkits=["github", "slack", "linear"],
)
print(f"MCP URL: {session.mcp.url}")
```

**Step 3: Add to Claude Code**
```bash
claude mcp add --transport http composio-server "YOUR_MCP_URL" \
  --headers "X-API-Key:YOUR_COMPOSIO_API_KEY"
```

**Step 4: Verify**
```bash
claude mcp list
```

### Alternative: npx Quick Setup

```bash
npx @composio/mcp@latest setup "<customer_id>" "github-xxxxx-xx" --client claude
```

### MCP Caveats

- **Token consumption**: MCP tool schemas and large tool outputs consume model context tokens. Use selective `allowed_tools` and on-demand tool loading to mitigate.
- **Authentication header required**: MCP clients must send `X-API-Key` header; missing it causes 401 errors.
- **Session immutability**: Changing toolkits or connected accounts requires a new session (new MCP URL).

---

## 4. Remote Workbench (COMPOSIO_REMOTE_WORKBENCH)

### What It Is

A persistent Python sandbox (Jupyter-style) where agents can write and execute code. State persists across calls within a session. The `COMPOSIO_REMOTE_BASH_TOOL` runs commands in the same sandbox.

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `code_to_execute` | Yes | Python code to run |
| `thought` | No | Agent's reasoning for the code execution |
| `timeout` | No | Execution timeout (hard limit: 4 minutes) |
| `session_id` | No | Session ID for state persistence |

### Built-in Helpers

| Helper | Purpose |
|--------|---------|
| `run_composio_tool(tool_slug, arguments)` | Execute any Composio tool programmatically; returns `(tool_response_dict, error_message)` |
| `invoke_llm(query)` | Call an LLM for classification, summarization, extraction (max 200K chars input) |
| `upload_local_file(*file_paths)` | Upload files to Composio S3/R2 storage; returns download URL |
| `proxy_execute(method, endpoint, toolkit, ...)` | Direct API calls to connected services when no pre-built tool exists |
| `web_search` | Search the web for research or data enrichment |
| `smart_file_extract` | Extract text from PDFs, images, and other file formats |

### Key Characteristics

- **Persistent state**: Variables, imports, files, and in-memory state persist across calls
- **Pre-installed libraries**: Common Python data science packages available; can auto-install missing packages
- **Parallelism**: Use `ThreadPoolExecutor` for bulk operations
- **Checkpointing**: Implement checkpoints in memory or files for long-running operations
- **Large response handling**: `COMPOSIO_MULTI_EXECUTE_TOOL` responses can be automatically synced to the workbench via `sync_response_to_workbench=true`, keeping the agent's context window lean

### Bulk Processing Pattern

```python
# Example: Process 100 items in parallel using Workbench
from concurrent.futures import ThreadPoolExecutor

items = [...]  # list of items to process
results = []

def process_item(item):
    response, error = run_composio_tool("TOOL_SLUG", {"arg": item})
    return {"item": item, "result": response, "error": error}

with ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(process_item, items))
```

### Use Cases

- Bulk operations (e.g., labeling 100 emails, processing CSV exports)
- Data analysis and transformation
- Multi-step workflows with intermediate state
- File generation and upload (reports, CSVs, images)
- Code testing and execution in agent-driven workflows

---

## 5. Remote Bash Tool (COMPOSIO_REMOTE_BASH_TOOL)

### What It Is

Executes bash commands in the same persistent sandbox as the Workbench.

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `command` | Yes | Bash command to execute |
| `session_id` | No | Session ID |

### Response Format

```json
{
  "data": {
    "stdout": "output here",
    "stdoutLines": 2,
    "stderr": "",
    "stderrLines": 0,
    "sandbox_id_suffix": "a1b2"
  },
  "successful": true
}
```

### Use Cases

- Processing large tool responses saved to remote files using `jq`, `awk`, `sed`, `grep`
- File system operations and data extraction
- System administration tasks in the sandbox
- Working directory: `/home/user` by default

### Important Note

File paths returned are **remote** (e.g., `/home/user/...`) and do not map to the local agent filesystem.

---

## 6. Multi-Execute Tool (COMPOSIO_MULTI_EXECUTE_TOOL)

### What It Is

A fast parallel executor that runs **up to 50 tools in parallel** across apps with structured outputs.

### Key Parameters

| Parameter | Description |
|-----------|-------------|
| `tools` | Array of tool calls with slugs and arguments |
| `sync_response_to_workbench` | Boolean; if `true`, large responses are saved to the remote sandbox |

### Rules and Best Practices

- Always use valid tool slugs discovered through `COMPOSIO_SEARCH_TOOLS` -- never invent slugs
- Ensure ACTIVE connections exist for all toolkits being executed
- Only batch **logically independent** tools with no required ordering
- Do not pass dummy or placeholder values
- Small data: process inline; large data: process in the workbench

### Typical Workflow Position

```
COMPOSIO_SEARCH_TOOLS -> COMPOSIO_MANAGE_CONNECTIONS (if needed) -> COMPOSIO_MULTI_EXECUTE_TOOL
```

---

## 7. Connection Management (COMPOSIO_MANAGE_CONNECTIONS)

### What It Is

A meta tool for runtime credential and connection management. Generates Connect Links so users can authorize third-party toolkits via OAuth or other auth methods.

### Key Parameters

| Parameter | Description |
|-----------|-------------|
| `toolkits` | List of toolkits to manage connections for |
| `reinitiate_all` | Boolean; re-initiate all connections |

### How It Works

1. Agent discovers tools via `COMPOSIO_SEARCH_TOOLS` and checks connection status
2. If a toolkit lacks an ACTIVE connection, agent invokes `COMPOSIO_MANAGE_CONNECTIONS`
3. Composio generates a Connect Link (OAuth authorization URL)
4. User completes authorization flow in browser
5. Connected account is stored and linked to the user ID
6. Agent can now execute tools for that toolkit

### Connected Account Lifecycle States

`ACTIVE` -> `INACTIVE` -> `PENDING` -> `INITIATED` -> `EXPIRED` -> `FAILED`

---

## 8. Complete Meta Tools Reference

| Meta Tool | Slug | Purpose |
|-----------|------|---------|
| Search Tools | `COMPOSIO_SEARCH_TOOLS` | Discover relevant tools across 1,000+ apps with execution plans |
| Get Tool Schemas | `COMPOSIO_GET_TOOL_SCHEMAS` | Retrieve complete input schemas for specific tools |
| Multi-Execute | `COMPOSIO_MULTI_EXECUTE_TOOL` | Execute up to 50 tools in parallel |
| Manage Connections | `COMPOSIO_MANAGE_CONNECTIONS` | Handle OAuth, API key, and other auth methods |
| Remote Workbench | `COMPOSIO_REMOTE_WORKBENCH` | Run Python code in persistent sandbox |
| Remote Bash | `COMPOSIO_REMOTE_BASH_TOOL` | Execute bash commands in sandbox |

---

## 9. Composio vs Native MCP Servers

### Comparison Matrix

| Factor | Composio | Native MCP Servers |
|--------|----------|-------------------|
| **Breadth** | 1,000+ toolkits via single integration | One server per service |
| **Auth management** | Centralized OAuth/API-key lifecycle for all services | Each server requires individual auth setup |
| **Maintenance** | Composio handles API changes, deprecations, updates | Developer responsible for monitoring and patching each server |
| **Setup time** | Minutes per service (generate MCP URL) | Hours per service (install, configure, maintain) |
| **Multi-user** | Built-in session/user management | Most native servers are single-user by default |
| **Cross-service orchestration** | `COMPOSIO_MULTI_EXECUTE_TOOL` batches across services | Must orchestrate multiple server calls manually |
| **Latency** | Adds one network hop through Tool Router | Direct connection to service API |
| **Cost** | Per-action pricing ($0.249/1K additional calls) | Free for open-source implementations (plus hosting) |
| **Customization** | Limited to Composio's tool schemas (custom tools experimental, TS-only) | Full control over implementation |
| **Data residency** | Cloud-hosted (VPC/on-prem for enterprise) | Self-hosted, full control |
| **Tool depth** | Standardized coverage; may not expose every API endpoint | Specialized implementations can be deeper |

### Recommendation

**Use Composio when:**
- Integrating with 5+ services simultaneously
- OAuth lifecycle management is a burden
- Rapid prototyping is the priority
- Cross-service workflows are needed (e.g., "create GitHub issue AND notify Slack AND update Linear")

**Use native MCP servers when:**
- Single-service focus with advanced/specialized needs
- Cost-sensitive with predictable infrastructure
- Performance-critical (latency cannot tolerate intermediary)
- Full compliance control and data residency required
- Deep customization of tool behavior needed

**Hybrid approach (recommended for production):**
Use Composio for breadth across many services while running dedicated native MCP servers for critical, high-frequency services (e.g., native GitHub CLI for daily git operations, native Linear MCP for issue management, Composio for Slack/email/calendar/CRM).

---

## 10. Authentication & Security

### Supported Auth Methods

- **OAuth 2.0** -- Authorization Code + PKCE, dynamic client registration, token refresh management
- **API Keys** -- Encrypted storage, rotation support, environment-based configuration
- **Basic Auth** -- Username/password for legacy services
- **Custom Auth Configs** -- Developers can supply their own OAuth client credentials and scopes
- **Bearer Tokens** -- For services using bearer token authentication

### Security Architecture

| Feature | Detail |
|---------|--------|
| **Credential encryption** | AES-256 encryption for stored credentials; HTTPS for transmission |
| **Token management** | Automatic refresh before expiration; revocation support |
| **Multi-tenancy** | Strict user data segregation; no cross-account data leakage |
| **Audit logging** | Enterprise: audit trails for every tool call |
| **Compliance** | SOC 2 Type II, ISO 27001:2022 (enterprise tier) |
| **Deployment options** | Cloud (default), VPC, On-Premises (enterprise) |
| **Rate limiting** | Per-organization, rolling 10-minute window with standard headers |

### Important Caveats

- Low-level sandboxing details for Workbench/Remote Bash (containerization, network policies) are not publicly documented
- Data retention policies for tool call payloads are not specified in public docs
- Encryption-at-rest details beyond token encryption (BYOK, CMK) are enterprise-only

---

## 11. Pricing & Limitations

### Pricing Tiers

| Plan | Price | Tool Calls/Month | Key Features |
|------|-------|-------------------|-------------|
| **Free / Hobby** | $0 | 10,000 | All apps, 100 connected accounts, Discord support, 1-month log retention |
| **Starter** | $119/month | 100,000 | Custom apps, 5,000 connected accounts, email + technical support, 1-year log retention |
| **Growth** | $229/month | 2,000,000 | Unlimited connected accounts/executions, Slack support, all features |
| **Enterprise** | Custom | Custom | Dedicated SLA, SOC-2, custom API volume, VPC/On-Prem, SSO |

**Overage:** $0.249 per 1,000 additional calls beyond plan limits

*Note: Pricing varies across sources. Verify current pricing at composio.dev/pricing.*

### Rate Limits

| Plan | Requests per 10-min Window |
|------|---------------------------|
| Hobby / Starter | 20,000 |
| Growth | 100,000 |
| Enterprise | Unlimited |

Rate limit responses include headers: `X-RateLimit`, `X-RateLimit-Remaining`, `X-RateLimit-Window-Size`, `Retry-After`. Exceeding the limit returns HTTP 429.

### Premium Tool Limits

- Free tier: 100/min standard, 1,000/hour premium
- Paid tier: 5,000/min standard, 10,000/hour premium
- Premium tools cost approximately 3x a standard tool call

---

## 12. SDK & API

### Python SDK

**Package:** `composio` (PyPI), v0.11.4 (March 2026), Apache 2.0

```python
from composio import Composio

client = Composio(api_key="your-api-key")
session = client.create(user_id="user@example.com", toolkits=["github"])
tools = session.tools()

result = client.tools.execute(
    tool_slug="GITHUB_CREATE_ISSUE",
    arguments={"repo": "owner/repo", "title": "Bug report", "body": "Details..."}
)
```

Features: Async support (`AsyncComposio`), type hints, built-in retries, custom tool definitions, provider adapters (OpenAI, Anthropic, LangChain, CrewAI, LlamaIndex, Gemini)

### TypeScript SDK

**Package:** `@composio/core` (npm), v0.6.7

```typescript
import { Composio } from '@composio/core';

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
const tools = await composio.tools.get('user123', { toolkits: ['GITHUB'] });
```

Features: Full TypeScript types, Promise-based, schema modifiers, WebSocket for triggers

### REST API

**Base URL:** `https://api.composio.dev/v3`

Key Endpoints:
```
POST   /tool_router/{session_id}/execute_meta  -- Execute meta tools
GET    /toolkits                                -- List toolkits
POST   /tools/execute/{tool_slug}              -- Execute a specific tool
POST   /connected_accounts                      -- Create connections
POST   /mcp/servers                             -- Create MCP server config
```

### Provider Packages

| Language | Package | Framework |
|----------|---------|-----------|
| Python | `composio-openai` | OpenAI |
| Python | `composio-anthropic` | Anthropic |
| Python | `composio-langchain` | LangChain |
| Python | `composio-crewai` | CrewAI |
| Python | `composio-llamaindex` | LlamaIndex |
| TypeScript | `@composio/openai` | OpenAI |
| TypeScript | `@composio/anthropic` | Anthropic |
| TypeScript | `@composio/langchain` | LangChain |
| TypeScript | `@composio/vercel` | Vercel AI SDK |
| TypeScript | `@composio/mastra` | Mastra |

---

## 13. Value for Claude Code Plugin Workflows

### High-Value Use Cases for Yellow Plugins

#### 1. Communication Layer (Slack, Email, Discord)
**Gap filled:** Yellow plugins currently have no Slack, email, or Discord integration.
- Post build/deployment notifications to Slack channels via `SLACK_SEND_MESSAGE`
- Send email reports via `GMAIL_SEND_EMAIL`
- Create Discord announcements for releases
- Thread-aware Slack messaging for PR review notifications

#### 2. Document Management (Notion, Google Workspace)
**Gap filled:** No document/spreadsheet integration exists.
- Create Notion pages with project documentation or meeting notes
- Update Google Sheets with metrics/status tracking
- Generate Google Docs with reports from Workbench-produced data
- Sync Confluence pages with codebase documentation

#### 3. CI/CD Enhancement (Beyond yellow-ci)
**Overlap:** yellow-ci covers GitHub Actions diagnosis well; Composio adds breadth.
- Execute diagnostic scripts in Workbench sandbox
- Cross-platform CI monitoring (Azure DevOps, CircleCI, etc.)
- Integrate with cloud deployment services (AWS Lambda, DigitalOcean)

#### 4. Calendar/Scheduling
- Create Google Calendar events for release schedules
- Block time for code reviews
- Schedule standup reminders

#### 5. Cloud Infrastructure
- Query AWS/GCP/Azure resources
- DigitalOcean droplet management
- Supabase database operations

#### 6. CRM Integration
- Create/update HubSpot deals when milestones are reached
- Sync Salesforce contacts with project stakeholders
- Track customer-reported issues across Zendesk and GitHub

#### 7. Bulk Processing via Workbench
**Unique value:** The Workbench enables batch workflows that are awkward in Claude Code's local context.
- Process hundreds of items via `ThreadPoolExecutor` in a persistent sandbox
- Offload large data processing from the agent's context window
- Use `sync_response_to_workbench=true` to keep context lean during multi-execute

### Integration Architecture Options

**Option A: User-Level MCP (Current State)**
Composio configured at `~/.claude/settings.json` as a global MCP server. Tools appear as `mcp__claude_ai_composio__*`. No plugin changes needed.

**Option B: Plugin-Bundled MCP**
A `yellow-composio` plugin that bundles Composio as an MCP server with setup command, connection management, and workflow commands.

**Option C: SDK Integration in Existing Plugins**
Individual plugins (e.g., yellow-ci, yellow-linear) call Composio SDK for specific cross-service actions.

**Recommended:** Start with Option A (current state) to evaluate tool quality and latency. If Composio proves valuable, create a thin `yellow-composio` plugin (Option B) for setup/connection management while keeping high-frequency tools (Linear, GitHub) on native MCP servers.

---

## 14. Evidence Gaps & Open Questions

The following items are not fully documented publicly and should be confirmed before production adoption:

1. **Sandbox isolation details** -- How Workbench and Remote Bash are isolated between tenants
2. **Data retention policies** -- Exact retention windows for tool call payloads, logs, and telemetry
3. **Encryption specifics** -- BYOK, CMK options, encryption-at-rest scope
4. **File lifecycle** -- How long artifacts in Workbench persist, download windows, automatic cleanup
5. **Per-tool payload size limits** -- Not consistently documented across tools
6. **MCP RBAC granularity** -- Per-user/per-group tool visibility beyond `allowed_tools`
7. **SLA specifics** -- Exact uptime and response-time guarantees for non-enterprise tiers
8. **Custom tools via MCP** -- Currently TypeScript-only and experimental; MCP support "coming soon"

---

## Sources

- [Composio Official Docs](https://docs.composio.dev/docs)
- [Composio Toolkits Directory](https://docs.composio.dev/toolkits)
- [Composio Tools & Toolkits](https://docs.composio.dev/docs/tools-and-toolkits)
- [Composio Workbench Docs](https://docs.composio.dev/docs/workbench)
- [Composio MCP Integration](https://composio.dev/toolkits/composio/framework/claude-code)
- [Composio How It Works](https://docs.composio.dev/docs/how-composio-works)
- [Composio Authentication Docs](https://docs.composio.dev/docs/authentication)
- [Composio Pricing](https://composio.dev/pricing)
- [Composio Rate Limits](https://docs.composio.dev/reference/rate-limits)
- [Composio Enterprise](https://composio.dev/enterprise)
- [Composio Python SDK (PyPI)](https://pypi.org/project/composio/)
- [Composio TypeScript SDK (npm)](https://www.npmjs.com/package/@composio/core)
- [Composio GitHub Repository](https://github.com/ComposioHQ/composio)
- [Composio SDK Blog Post](https://composio.dev/blog/new-sdk-preview)
- [Composio MCP Reference API](https://docs.composio.dev/reference/api-reference/mcp)
- [Composio Meta Tools: Search Tools](https://docs.composio.dev/reference/meta-tools/search_tools)
- [Composio MCP Troubleshooting](https://docs.composio.dev/docs/troubleshooting/mcp)
- [mcp.composio.dev](https://mcp.composio.dev)
