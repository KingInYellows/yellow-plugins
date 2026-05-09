---
name: agent-native-architecture
description: "Reference for agent-native architecture principles: action parity, context parity, shared workspace, primitives over workflows, and dynamic context injection. Use when authoring agent integrations or designing tool surfaces."
user-invokable: false
---

## What It Does

Codifies the five principles that distinguish "agent-native" architecture
from "agent-as-afterthought" — the patterns the
`yellow-review:review:agent-native-reviewer` agent checks against. This skill
is the canonical reference; the reviewer agent applies it.

## When to Use

- Authoring or modifying agent tool definitions, system prompt construction,
  or LLM-integration scaffolding.
- Designing a feature where users and agents will both act on shared data.
- Evaluating whether a UI action has a corresponding agent capability.
- Deciding whether a tool should be a primitive or a workflow.

## Usage

### The Five Principles

1. **Action Parity** — Every UI action has an equivalent agent tool. If a
   user can rename a project via a button, the agent must have a
   `rename_project` tool. Exceptions are intentional human-only flows
   (CAPTCHA, 2FA, OAuth consent, biometric auth) and purely cosmetic UI
   (animations, theme toggling).

2. **Context Parity** — Agents see the same data users see. The system
   prompt must include available resources (files, entities, recent
   activity), capability mappings (which tool does what), and domain
   vocabulary. Static system prompts that don't reflect runtime state
   produce agents that don't know what exists.

3. **Shared Workspace** — Agents and users operate in the same data space.
   Agent file operations use the same paths as the UI; the UI observes
   changes the agent makes (via shared store, file watching, or reactive
   binding). Anti-pattern: agent writes to `agent_output/` while user works
   in `documents/` — separate sandboxes break collaboration.

4. **Primitives over Workflows** — Tools are composable primitives whose
   inputs are data, not decisions. A `store_item(key, value)` tool is
   correct; a `process_feedback(message)` tool that internally categorizes
   + prioritizes + notifies is a workflow tool that strips the agent of
   reasoning agency.

   **Exception:** Workflow tools are acceptable when they wrap
   safety-critical atomic sequences (a payment must charge + record +
   receipt as one unit) or external orchestration the agent shouldn't
   step-through (a deploy tool).

5. **Dynamic Context Injection** — System prompts include runtime app
   state, not just static instructions. The prompt at build-time names
   the agent's role; the prompt at request-time names the user's current
   project, recent files, available entities, and which capabilities apply
   to this specific call.

### The Noun Test

For every domain noun in the app (project, document, task, message,
report — whatever the entities are), verify the agent can:

1. **Know what it is** — domain vocabulary in the system prompt
2. **Interact with it** — at least one tool whose target is this noun
3. **Discover the capability** — the tool is named in the prompt or
   surfaced in onboarding

A noun that fails all three is a critical gap for must-have entities.

### Anti-Pattern Catalog

| Anti-Pattern | Signal | Fix |
|---|---|---|
| Orphan Feature | UI action with no agent tool | Add tool; document in prompt |
| Context Starvation | Agent unaware of resources or terms | Inject resources + vocabulary into prompt |
| Sandbox Isolation | Agent reads/writes separate data space | Use shared workspace |
| Silent Action | Agent mutates state, UI doesn't update | Reactive binding or file watching |
| Capability Hiding | Users can't discover agent capabilities | Surface in agent responses |
| Workflow Tool | Tool encodes business logic | Extract primitives; orchestrate in prompt |
| Decision Input | Tool accepts decision enum | Accept data; let agent decide |

### Priority Tiers

Not every gap is equal — prioritize findings by impact:

- **Must have parity:** Core domain CRUD, primary user workflows, actions
  that modify user data.
- **Should have parity:** Secondary features, read-only views with
  filtering/sorting.
- **Low priority:** Settings/preferences UI, onboarding wizards, admin
  panels, purely cosmetic actions.

Critical findings only apply to must-have and should-have tiers; low-priority
gaps are observations.

### Stack-Specific Tool Locations

| Stack | Agent tools live at |
|---|---|
| Vercel AI SDK (Next.js) | `tool()` in route handlers; `tools` param in `streamText`/`generateText` |
| LangChain / LangGraph | `@tool` decorators; `StructuredTool` subclasses |
| OpenAI Assistants | `tools` array in assistant config |
| Claude Code plugins | `agents/*.md`, `skills/*/SKILL.md`, tool lists in frontmatter |
| Rails + MCP | `tool()` in MCP server definitions; `.mcp.json` |
| Generic | `tool(`, `function_call`, `tools:`, tool registration patterns |

### What This Skill Doesn't Cover

- **CLI agent-readiness** — see `yellow-review:review:cli-readiness-reviewer`
  and `yellow-review:review:agent-cli-readiness-reviewer` for CLI-specific
  agent optimization (non-interactive defaults, structured output, etc.).
- **Agent authoring conventions** — see
  `yellow-core:create-agent-skills` for how to write Claude Code agents and
  skills.
- **MCP integration patterns** — see `yellow-core:mcp-integration-patterns`
  for ruvector and morph integration patterns.
