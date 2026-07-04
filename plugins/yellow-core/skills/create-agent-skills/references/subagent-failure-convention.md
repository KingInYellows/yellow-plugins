# Subagent Failure Convention (Output-File Pattern)

When an orchestrator spawns a subagent via the Task tool, the Task tool's
return value is not always reliable for distinguishing partial success
from complete failure (see
[GitHub Issue #24181](https://github.com/anthropics/claude-code/issues/24181)).
A formal structured-failure payload has been proposed upstream
([Issue #25818](https://github.com/anthropics/claude-code/issues/25818))
but is not yet shipped.

**Community-adopted workaround: the output-file convention.**

## When the convention applies

Use this convention for orchestrators spawning **prose-emitting**
agents. Prose stdout cannot be deterministically parsed for
partial-failure signals; the file-based result + `status` field is the
structural signal.

Current adopters:

- `/workflows:work` Phase 3 reviewers (canonical) — structured JSON
  result files per reviewer agent
- `/research:deep` ⇄ `research-conductor` (yellow-research) — a single
  prose-emitting subagent returning a long research synthesis; the
  conductor writes `<run_dir>/synthesis.md` and returns a compact
  confirmation + path, with inline return only when the artifact write
  fails

Skip when every spawned agent returns strict structured JSON validated
against a documented schema, or already returns a compact status line.
Documented exemptions:

- `/review:pr` Step 5 — the canonical compact-return JSON case:
  reviewers emit schema-bound findings through TaskOutput, so adding
  `$RUN_DIR` there would duplicate the return contract.
- `staging-promoter` (yellow-core) — already returns a compact status
  line; same shape as the compact-return exemption.

If an orchestrator mixes compact-return agents with prose emitters, use
this convention only for the prose emitters or split those emitters into
a workflow that can enforce file-backed results.

The convention's scope, in one line: **prose-emitting orchestrators
need it; compact-return-JSON orchestrators don't.**

## For subagent authors

Instruct the subagent (in its system prompt or spawning prompt) to write a
structured result file before exiting:

```json
{
  "agent": "security-sentinel",
  "status": "success",
  "findings": [
    { "severity": "P1", "file": "src/auth.ts", "line": 42, "finding": "..." }
  ]
}
```

Or on failure:

```json
{
  "agent": "security-sentinel",
  "status": "failed",
  "reason": "timeout analyzing src/auth.ts after 60s",
  "partial_findings": []
}
```

Write the file to a path the orchestrator provides. Orchestrators MUST scope
result files to a per-run directory so concurrent sessions cannot collide
(e.g., two review sessions running on different PRs at the same time). The
canonical path is:

```text
$RUN_DIR/agent-result-<agent-name>.json
```

where `$RUN_DIR` is a unique directory the orchestrator creates at the
start of the run (see orchestrator example below) and passes to each agent
via the spawn prompt. The spawned agent receives the literal directory path
in its prompt; it cannot inherit a shell variable from the orchestrator's
process.

**Atomic write semantics.** Agents MUST write to a `.tmp` filename first,
then `mv` to the final `.json` filename. POSIX rename is atomic with
respect to concurrent readers on the same filesystem, so the orchestrator
sees either the complete result file or no file at all — never a partial
write. The orchestrator MUST glob only `*.json`, never `*.tmp`. Sequence:

```bash
RUN_DIR="/tmp/yellow-work-abc123"
RESULT_TMP="$RUN_DIR/agent-result-${AGENT_NAME}.tmp"
RESULT_FINAL="$RUN_DIR/agent-result-${AGENT_NAME}.json"
printf '%s\n' "$JSON_PAYLOAD" > "$RESULT_TMP" && mv "$RESULT_TMP" "$RESULT_FINAL"
```

If the agent crashes between the `>` and the `mv`, the orchestrator finds
no `.json` file and treats the agent as failed — the partial `.tmp` is
invisible. Lock files are unnecessary because each agent owns a unique
filename.

## For orchestrator authors

1. Create a unique run directory at the start of the workflow:

   ```bash
   # Uses $TMPDIR (or /tmp). Avoids CLAUDE_PLUGIN_DATA — that variable IS
   # documented, but as the plugin's PERSISTENT data directory (survives
   # plugin updates; see code.claude.com/docs/en/plugins-reference), which
   # is the wrong home for ephemeral per-run scratch. Rely on the OS
   # tempdir instead.
   RUN_DIR=$(mktemp -d -t run-XXXXXXXX) && printf '%s\n' "$RUN_DIR"
   ```

   Capture the printed path. Bash variables do NOT survive across
   separate Bash tool calls in command files (each call is a fresh
   subprocess), so the orchestrator must substitute the literal path
   value into subsequent Task input prompts rather than referencing
   `$RUN_DIR` by name. If `mktemp` fails (disk full, permission
   denied) the captured path is empty — error out before spawning
   agents; an empty `run_dir` causes every agent to write to a
   non-existent path and silently appear "failed".

2. Pass the **literal path** (not the variable name) to each spawned
   agent so the agent writes to
   `<run_dir>/agent-result-<agent-name>.tmp` then atomically renames
   to `<run_dir>/agent-result-<agent-name>.json`. The agent owns the
   `.tmp` → `.json` rename; the orchestrator only reads `.json`.

3. After the Task call returns, read the result file rather than relying on
   the Task return value. Treat `status: "success"` as the only signal that
   the agent completed its work — `status: "failed"`, missing file, or
   invalid JSON all indicate incomplete work that the orchestrator should
   surface.

   **Note for command-file authors:** in Claude Code command `.md` files each
   fenced bash block runs in a fresh subprocess (see
   `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`),
   so `$RUN_DIR` from Step 1 is NOT in scope here. The block below is
   illustrative shell logic — in a command file, either re-derive the path
   in the same fence, or pass the **literal path captured from `mktemp -d`**
   to the agent's Task input instead of the variable name.

```bash
RESULT="$RUN_DIR/agent-result-${AGENT_NAME}.json"
if [ ! -f "$RESULT" ]; then
  report_failed "$AGENT_NAME" "result file missing"
elif ! jq -e . "$RESULT" >/dev/null 2>&1; then
  report_failed "$AGENT_NAME" "result file is not valid JSON"
elif ! STATUS=$(jq -er .status "$RESULT" 2>/dev/null); then
  # jq -er exits non-zero for both absent .status AND .status: null —
  # both indicate a malformed agent output and are treated identically here
  report_failed "$AGENT_NAME" "missing or null \"status\" field"
elif [ "$STATUS" != "success" ]; then
  REASON=$(jq -r '.reason // "no reason given"' "$RESULT")
  report_failed "$AGENT_NAME" "$REASON"
else
  # process findings from "$RESULT"
  :
fi
```

The two-stage check (`jq -e .` for JSON validity, then `jq -er .status` for
field presence) avoids the misleading "not valid JSON" diagnosis when the
file parses correctly but `.status` is null or absent.

1. Clean up the run directory at the end of the workflow:
   `rm -rf "<literal mktemp path>"`. Result files may contain diff
   excerpts including secrets or credentials; retention in `/tmp` is a
   data-residue risk on multi-user or long-lived machines. Skip cleanup
   only when explicitly retaining files for post-run debugging, and
   document the retention in the orchestrator's user-visible output
   (so the user knows where the residue lives).

## Why files and not stdout

Stdout parsing is unreliable — the Task tool may suppress trailing output,
agents may emit unstructured prose alongside the JSON, and context
truncation can drop the final line. Files are durable and can be read
even if the agent crashes mid-execution.
