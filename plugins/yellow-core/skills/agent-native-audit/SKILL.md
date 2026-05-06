---
name: agent-native-audit
description: "Audit checklist for evaluating an existing codebase against agent-native architecture principles. Inventories UI actions, agent tools, system prompts, and shared workspace patterns to identify parity gaps. Use when auditing a codebase for agent-native readiness, before adding new agent integration, or when deciding whether to extract orchestration logic from a workflow tool."
user-invokable: false
---

## What It Does

Step-by-step audit procedure for evaluating a codebase's agent-native
architecture maturity. Where `agent-native-architecture` codifies the
principles, this skill codifies the audit *process* — what to inventory,
what to measure, what to flag. The
`yellow-review:review:agent-native-reviewer` agent uses this checklist for
incremental PR reviews; `/yellow-debt:debt:audit`-style full audits use it
for codebase-wide assessments.

## When to Use

- Onboarding to a codebase that has agent integration and you need to
  understand its current parity status.
- Before adding a new agent capability — confirm existing patterns first.
- Auditing a codebase that's adding agent integration for the first time —
  identify the orphan-feature surface area.
- Triaging "the agent feels broken" complaints — narrow to which principle
  is failing.

## Usage

### Step 0: Triage

Answer three questions before scanning:

1. **Does this codebase have agent integration at all?** Search for tool
   definitions, system prompt construction, or LLM API calls. If none
   exists, every user-facing action is an orphan feature — that is the
   single top finding. Recommend where agent integration should be
   introduced.

2. **What stack?** Identify where UI actions and agent tools are defined
   using the table in `agent-native-architecture` skill.

3. **Incremental or full audit?** For a PR review, focus on new/modified
   code. For a full audit, scan systematically.

### Step 1: Map the Landscape

Inventory:

- **UI actions** — buttons, forms, navigation links, gestures, keyboard
  shortcuts. Grep for `onClick`, `onSubmit`, `onTap`, `Button`,
  `onPressed`, form actions.
- **Agent tools** — tool definitions and where registered. Grep for
  `tool(`, `function_call`, `tools:`, framework-specific decorators.
- **System prompt construction** — static string vs. dynamically built
  with runtime state. Grep for prompt template strings, prompt-builder
  functions.
- **Context sources** — where the agent gets information about resources,
  recent activity, capabilities, vocabulary.

### Step 2: Build the Capability Map

Cross-reference UI actions against agent tools:

```
| UI Action | Location | Agent Tool | In Prompt? | Priority | Status |
|-----------|----------|------------|------------|----------|--------|
| Rename project | src/projects/RenameDialog.tsx | rename_project | yes | must-have | OK |
| Archive project | src/projects/ArchiveBtn.tsx | (none) | n/a | must-have | GAP |
| Theme toggle | src/settings/Theme.tsx | (none) | n/a | low | observation |
```

Flag must-have and should-have gaps as Critical or Warning. Low-priority
gaps are Observations only.

### Step 3: Check Context Parity

Verify the system prompt includes:

- **Available resources** — files, data, entities the user can see
- **Recent activity** — what the user has done recently
- **Capabilities mapping** — what tool does what
- **Domain vocabulary** — app-specific terms explained

Red flags:

- System prompt is a static constant string with no runtime substitution
- Agent doesn't know what resources exist (asks "what's the project name?"
  when the project context should be injected)
- Agent doesn't understand app-specific terms

### Step 4: Check Tool Design

For each tool:

- **Inputs are data, not decisions** — `store(key, value)` is data;
  `process(message)` with internal categorization is a decision tool.
- **Output is rich enough to verify success** — return IDs, URLs, or
  structured confirmation, not just `"Done!"`.
- **Errors are actionable** — tell the agent what to try next.
- **Idempotent if commonly retried** — or returns audit-friendly
  output (timestamps, request IDs).

Workflow-tool detection:

- Tool body branches on input data (`if (priority > 3)`, `switch (category)`)
- Tool calls multiple downstream services in sequence
- Tool returns success regardless of which path it took (no surface for
  the agent to reason about which thing happened)

### Step 5: Check Shared Workspace

- Agent file operations use the same paths as the UI?
- UI observes changes the agent makes (file watching, reactive store)?
- No separate "agent sandbox"?
- Users can inspect and edit agent-created artifacts?

### Step 6: The Noun Test

After actions, audit by domain object. For every noun in the app,
the agent should:

1. Know what it is (context injection)
2. Have a tool to interact with it
3. See it documented in the system prompt

A noun failing all three is critical for must-have entities.

### Output

A capability map with status column, a list of gaps grouped by priority
tier, and a verdict: PASS / NEEDS WORK / CRITICAL.

```markdown
## Agent-Native Architecture Audit

### Summary
[App type, agent integration present, parity assessment]

### Capability Map
[Table from Step 2]

### Findings

#### Critical (Must Fix)
1. **[Issue]** — `file:line` — [Description]. Fix: [How]

#### Warnings (Should Fix)
1. **[Issue]** — `file:line` — [Description]. Recommendation: [How]

#### Observations
1. **[Observation]** — [Description]

### What's Working Well
- [Positive observations]

### Score
- **X/Y high-priority capabilities are agent-accessible**
- **Verdict:** PASS / NEEDS WORK / CRITICAL
```

### What This Skill Doesn't Cover

- **The principles themselves** — see `agent-native-architecture` skill
  for the canonical reference.
- **CLI agent-readiness** — see `cli-readiness-reviewer` and
  `agent-cli-readiness-reviewer` agents (yellow-review).
- **Generic code review** — this is a domain-specific audit; pair with
  `correctness-reviewer`, `security-sentinel`, etc. for full coverage.
