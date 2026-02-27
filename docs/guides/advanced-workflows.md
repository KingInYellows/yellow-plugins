# Advanced Workflows

Complex multi-plugin chains, credential requirements, and customization
patterns. Read [Common Workflows](./common-workflows.md) first.

---

## Product to Code Pipeline

**Plugins required:** yellow-chatprd, yellow-linear, yellow-devin
**Credentials:** ChatPRD OAuth, Linear OAuth, Devin service user (`DEVIN_SERVICE_USER_TOKEN` + `DEVIN_ORG_ID`)

### Chain

```
/chatprd:setup → /chatprd:create → /chatprd:link-linear → /linear:delegate → /devin:status
```

### Step by Step

1. **`/chatprd:setup`** — Configure ChatPRD workspace (one-time setup). Sets
   default organization and project for all ChatPRD commands. **Required before
   any other ChatPRD command.**

2. **`/chatprd:create`** — Write a PRD, spec, or one-pager in ChatPRD. Returns
   a document ID for linking.

3. **`/chatprd:link-linear`** — Create Linear issues from the PRD. Breaks the
   spec into actionable issues with acceptance criteria.

4. **`/linear:delegate`** — Delegate a Linear issue to Devin for autonomous
   implementation. Reports the `SESSION_ID` directly in the "Next steps"
   section of the output.

5. **`/devin:status [session-id]`** — Check Devin's progress. Use the
   `SESSION_ID` reported directly in the `/linear:delegate` output — it is
   shown in the "Next steps" section.

### Graceful Degradation

| Missing Credential | Effect | Alternative |
|---|---|---|
| ChatPRD OAuth | `/chatprd:create` fails | Write specs manually |
| Linear OAuth | `/chatprd:link-linear` fails | Create issues manually |
| `DEVIN_SERVICE_USER_TOKEN` / `DEVIN_ORG_ID` | `/linear:delegate` fails | Implement manually via `/workflows:work` |

### Without Linear

Skip steps 3-5. Use `/workflows:plan` to break the PRD into implementation
tasks, then `/workflows:work` to implement.

---

## Technical Debt Lifecycle

**Plugins required:** yellow-debt
**Optional:** yellow-linear (for `/debt:sync`), yellow-devin (for delegation)

### Chain

```
/debt:audit → /debt:triage → /debt:fix → /debt:sync → /linear:delegate
```

### Step by Step

1. **`/debt:audit`** — Run 5 parallel scanner agents (AI patterns, complexity,
   duplication, architecture, security debt). Produces findings in
   `todos/debt/`. Takes 1-3 minutes for medium codebases.

2. **`/debt:triage`** — Interactively review each finding. Presented in severity
   order (critical first). Accept, reject, or defer with reason. Decisions are
   atomic and persist if interrupted.

3. **`/debt:fix`** — Agent-driven remediation of a specific accepted finding.
   The debt-fixer agent proposes changes and requires human approval before
   committing. **One finding at a time** — for batch processing, triage first to
   mark multiple findings as "ready", then run fix on each sequentially.

4. **`/debt:sync`** — Push accepted (ready) findings to Linear as issues.
   Requires yellow-linear.

5. **`/linear:delegate`** — Optionally delegate specific debt issues to Devin.

### Monitoring

The yellow-debt SessionStart hook automatically reminds you about high/critical
findings at the start of each session:
`[yellow-debt] N high/critical debt finding(s) pending triage. Run /debt:status for details.`

Use `/debt:status` at any time for a dashboard of current debt levels.

---

## Research to Implementation

**Plugins required (chain):** yellow-research + yellow-core
**Standalone:** yellow-research alone (for research without plan/work) or yellow-core alone (for plan/work without deep research)

### Deep Research Chain

```
/research:deep → /workflows:brainstorm → /workflows:plan → /workflows:work <plan-path>
```

1. **`/research:deep`** — Multi-source deep research saved to
   `docs/research/<slug>.md`. Use for comprehensive reports, competitive
   analysis, or technology evaluation.

2. **`/workflows:brainstorm`** — Reference the research output file when
   starting the brainstorm. The brainstorm command auto-detects brainstorm docs
   but does not auto-detect research files — mention the path explicitly.

3. **`/workflows:plan`** — Transform brainstorm into actionable plan. The plan
   command auto-detects the most recent brainstorm doc.

4. **`/workflows:work docs/plans/YYYY-MM-DD-<topic>-plan.md`** — Execute the
   plan. Pass the file path explicitly.

### Quick Research (No Files)

```
/research:code <query>
```

Returns an inline answer with code examples. No files created. Use for quick
lookups during active development.

---

## Cross-Plugin Orchestration

### Combining 3+ Plugins

Example: Feature with research, implementation, review, and tracking.

```
/research:deep "state management patterns"
/workflows:brainstorm
/workflows:plan
/gt-stack-plan
/workflows:work docs/plans/...
/smart-submit
/review:pr
/review:resolve
/linear:sync
```

### Plugin Load Order

Plugins load independently. Hooks run in parallel at SessionStart. Commands from
any plugin can be used at any time. Cross-plugin agent references (e.g.,
yellow-review using yellow-core's security-sentinel) degrade gracefully — the
spawning command logs a warning if the target agent's plugin is not installed.

---

## Hook Customization

### Available Hook Events

| Event | When | Plugins Using It |
|---|---|---|
| SessionStart | Session begins | yellow-ci, yellow-debt, yellow-ruvector |
| UserPromptSubmit | Before each user prompt | yellow-ruvector (memory recall) |
| PreToolUse | Before tool executes | gt-workflow (blocks `git push`) |
| PostToolUse | After tool executes | gt-workflow (commit message check), yellow-ruvector (records edits/commands) |
| Stop | Session ends | yellow-ruvector |

### Hook Patterns

**Blocking hook** (PreToolUse): Exit code 2 blocks the tool call. Use for
hard rules like "never use `git push`".

**Warn-only hook** (PostToolUse): Output a `systemMessage` but always
`"continue": true`. Use for soft suggestions like "consider conventional
commits".

**Reminder hook** (SessionStart): Check for pending state and output context.
Budget: 2-3 seconds. Always exit with `{"continue": true}`.

### Adding Project-Specific Hooks

Add hooks to your project's `.claude/settings.json` under the `"hooks"` key:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/my-hook.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Hooks must output valid JSON: `{"continue": true}` or
`{"continue": true, "systemMessage": "..."}`.

---

## Devin Delegation Patterns

**Plugins required:** yellow-devin
**Optional:** yellow-linear (for enriched delegation)

### Two Delegation Paths

**`/linear:delegate`** (enriched):
- Starts from a Linear issue with full context
- Devin receives issue title, description, acceptance criteria, and related
  issues
- Use when the task is already tracked in Linear

**`/devin:delegate`** (freeform):
- Starts from a text prompt
- You provide all context directly
- Use for ad-hoc tasks not tracked in Linear

### Session Management

After delegation:
- **`/devin:status`** — Check progress
- **`/devin:message`** — Send follow-up context
- **`/devin:cancel`** — Stop a running session
- **`/devin:archive`** — Clean up completed sessions

### Best Practices

- Provide clear acceptance criteria in the delegation prompt
- Include file paths and relevant context
- Check status periodically rather than waiting for completion
- Use `/devin:message` to course-correct if Devin goes off track
