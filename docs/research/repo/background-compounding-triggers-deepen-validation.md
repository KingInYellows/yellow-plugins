---
title: "Background Compounding Triggers — Deep Validation"
date: 2026-05-18
plan: plans/background-compounding-triggers.md
---

# Background Compounding Triggers — Deep Validation

Validation of the plan's key assumptions against actual codebase state.

---

## Q1 (CRITICAL): How does a bash hook script invoke a Claude Code agent?

**Finding: No existing hook in the codebase invokes an LLM call. This is an
unimplemented pattern and constitutes a fundamental architectural gap.**

Audit result across all 18 hook scripts:

| Hook file | LLM invocation? |
|-----------|----------------|
| `yellow-ruvector/hooks/scripts/stop.sh` | No — delegates to `ruvector hooks session-end` CLI (vector DB only) |
| `yellow-ruvector/hooks/scripts/session-start.sh` | No — delegates to `ruvector hooks session-start` CLI |
| `yellow-ruvector/hooks/scripts/pre-tool-use.sh` | No — delegates to `ruvector hooks` CLI |
| `yellow-ruvector/hooks/scripts/post-tool-use.sh` | No — delegates to `ruvector hooks post-edit` CLI |
| `yellow-ruvector/hooks/scripts/user-prompt-submit.sh` | No — delegates to `ruvector hooks recall` CLI |
| `yellow-morph/hooks/scripts/prewarm-morph.sh` | No — runs `npm ci` (package install) in a disowned subshell |
| `yellow-research/hooks/write-credential-status.sh` | No — HTTP curl to `context7.com` REST API (data, not LLM) via disowned subshell; also writes credential-status.json |
| `yellow-ci/hooks/scripts/session-start.sh` | Not inspected for LLM calls (CI runner detection only) |
| `yellow-debt/hooks/scripts/session-start.sh` | Not inspected for LLM calls |
| `yellow-composio/hooks/check-mcp-url.sh` | Not inspected for LLM calls |
| `gt-workflow/hooks/check-commit-message.sh` | No — pattern matching on commit subject line |
| `gt-workflow/hooks/check-git-push.sh` | No — git command validation |

No hook anywhere in the codebase contains references to:
- `anthropic`, `ANTHROPIC_API_KEY`
- `haiku`, `claude-haiku`, `claude-3`, `claude --`
- Any HTTP call to `api.anthropic.com`
- Any `Task`, `Agent`, or main-loop-primitive invocation

**The claude CLI IS available at `/home/kinginyellow/.local/bin/claude` (v2.1.143).
It supports non-interactive operation via `claude -p "prompt" --model haiku`
and `--bare` mode.** However, no existing hook uses it — this is an entirely
novel pattern in this codebase.

**What the plan must specify explicitly:**

The plan says the Stop hook's disowned subshell "invokes a Haiku agent via
Agent tool invocation." This is architecturally incoherent as written — the
Agent tool is a main-loop primitive inside a Claude Code session, not a shell
command. The only viable shell-level paths are:

1. **`claude -p "prompt" --model haiku --bare`** — shells out to the local
   claude CLI binary in non-interactive print mode. This is a fresh
   sub-process, not a sub-agent of the current session. It does not share the
   parent session's context, memory, or MCP connections. It would read the
   session transcript from a file (if accessible) and produce output to stdout.
   Requires that the transcript path is deterministic and readable by the
   subshell.
2. **Direct Anthropic API via `curl`** — `curl https://api.anthropic.com/v1/messages`
   with `ANTHROPIC_API_KEY`. Requires the key to be available in the hook
   environment. The yellow-morph and yellow-research patterns show that hooks
   can use curl for external API calls, but those target data APIs (context7,
   npm), not LLM APIs.
3. **Write to a staging dir only (no LLM in hook)** — the hook writes a raw
   transcript excerpt to the staging dir; a subsequent SessionStart hook
   dispatches an agent (via Task tool inside the Claude Code session) to
   process it. This defers the LLM call to the next session's main loop.

Option 3 is the only pattern that aligns with the existing architecture. The
plan's Phase 1.3 (Haiku agent invoked from disowned bash subshell) requires
either inventing a new pattern (claude CLI subprocess) or re-architecting
so the LLM call happens inside a SessionStart handler.

**Gap severity: BLOCKER.** The plan must be updated to specify the exact
mechanism for reaching an LLM from the Stop hook before implementation can
begin.

---

## Q2 (CRITICAL): Does any hook use `async: true` in plugin.json?

**Finding: No. Zero plugins use `async: true` in their hook registrations.**

Full search across all 8 plugin.json files with hooks:
`gt-workflow`, `yellow-ci`, `yellow-composio`, `yellow-debt`,
`yellow-morph`, `yellow-research`, `yellow-ruvector`, `yellow-semgrep`.

The schema in use is:

```json
{
  "SessionStart": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/<name>.sh",
          "timeout": 3
        }
      ]
    }
  ]
}
```

No `"async"` key appears anywhere. The "async" background pattern used by
yellow-morph and yellow-research is implemented entirely within the hook
script itself via a disowned subshell — **the parent script returns
`{"continue": true}` immediately; a bash subshell (`(...)>/dev/null 2>&1 &
disown`) does the background work.** This is runtime-level async, not a
schema-level `async: true` key.

No existing plugin in this marketplace uses `async: true`. Per the official
Claude Code hooks reference, `async: true` IS a supported optional command-hook
field ("if true, runs in the background without blocking") — it simply has no
precedent in this marketplace. The established pattern here is the
disowned-subshell technique, which the plan adopts as its primary mechanism.

---

## Q3 (CRITICAL): Does any agent use `disallowedTools`?

**Finding: Yes — multiple agents use `disallowedTools` in frontmatter.
No precedent for `disallowedTools` in Task tool invocations (inline dispatch).**

Confirmed instances in agent frontmatter:

```
plugins/yellow-core/agents/review/security-reviewer.md:10
plugins/yellow-core/agents/review/security-lens.md:10
plugins/yellow-core/agents/review/security-sentinel.md:11
plugins/yellow-review/agents/review/pr-test-analyzer.md:11
plugins/yellow-review/agents/review/project-compliance-reviewer.md:11
plugins/yellow-review/agents/review/silent-failure-hunter.md:14
plugins/yellow-review/agents/review/code-simplifier.md:11
plugins/yellow-review/agents/review/comment-analyzer.md:11
plugins/yellow-review/agents/review/type-design-analyzer.md:14
```

Canonical frontmatter form (from `security-reviewer.md`):

```yaml
---
name: security-reviewer
description: "..."
model: sonnet
memory: project
tools:
  - Read
  - Grep
  - Glob
disallowedTools:
  - Write
  - Edit
  - MultiEdit
---
```

And from `silent-failure-hunter.md` (adds `background: true`):

```yaml
---
name: silent-failure-hunter
...
background: true
tools:
  - Read
  - Grep
  - Glob
  - ToolSearch
  - mcp__plugin_yellow-research_ast-grep__find_code
  - mcp__plugin_yellow-research_ast-grep__find_code_by_rule
disallowedTools:
  - Write
  - Edit
  - MultiEdit
---
```

**`disallowedTools` appears only in agent frontmatter, never in Task tool
invocations** — there is no precedent for passing `disallowedTools` as a
parameter to `Task(...)` call syntax in any command or agent body in the
codebase. The plan's `staging-reviewer` with `disallowedTools: [AskUserQuestion]`
must be enforced via the agent's frontmatter, not via runtime Task dispatch
parameters.

**Note on runtime enforcement:** `disallowedTools` in frontmatter is
enforced by Claude Code's scheduler at the subagent boundary — this is
structurally enforced, not prose-only. The yellow-core CLAUDE.md explicitly
describes it: "The runtime `disallowedTools: [Write, Edit, MultiEdit]` block
on those agents enforces the read-only contract." `AskUserQuestion` is a
valid tool name to deny (it is a first-class Claude Code tool), so
`disallowedTools: [AskUserQuestion]` in the staging-reviewer frontmatter
should be valid.

---

## Q4: How does compound-lifecycle handle ruvector MCP unavailability?

**Finding: Graceful degradation via conditional guards, not error handling.**

The compound-lifecycle SKILL.md (474 lines, read in full) uses a consistent
"when ruvector is available" guard pattern rather than try/catch logic:

1. **Staleness scoring:** w3 (embedding_age_days) and w4 (days_since_retrieved)
   contribute 0 when ruvector is unavailable. The formula degrades to:
   `0.4 * days_since_modified * (0.3 / max(inbound_refs, 1) + 0.7)`.
   The skill explicitly notes this degradation in the final report under
   "ruvector available: yes|no — degraded scoring".

2. **Overlap detection (Step 5b):** The third precision pass (cosine similarity)
   is labeled "Optional" and guarded with "When
   `mcp__plugin_yellow-ruvector_ruvector__hooks_recall` is available" — no
   error propagation, just skip.

3. **Retrieval recency (Step 4):** Only called "when ruvector is available";
   when unavailable, treats `days_since_retrieved = days_since_modified` as
   conservative fallback.

4. **Final report field:** `ruvector available: <yes|no — degraded scoring>`
   is a required field, making the degradation visible to the user without
   blocking.

**Pattern for the staging-reviewer to mirror:** Guard each ruvector call with
an availability check (ToolSearch result or try-and-skip). On failure, log
the degradation in output, continue with reduced functionality. Do not block
or error — this is a background operation.

---

## Q5: Can a disowned bash subshell invoke Task tool (main-loop primitive)?

**Finding: No. Task is a main-loop primitive. Disowned subshells do shell
work only — they cannot invoke Claude Code agent primitives.**

Audit of the two existing disowned-subshell patterns:

**yellow-morph `prewarm-morph.sh` (lines 79-92):**
```bash
(
  trap 'yellow_morph_release_install_lock' EXIT INT TERM
  if ! yellow_morph_do_install; then
    yellow_morph_cleanup_failed_install
  fi
) >/dev/null 2>&1 &
sub_pid=$!
disown
```
The subshell runs `yellow_morph_do_install` — which sources
`lib/install-morphmcp.sh` and calls `npm ci`. Pure shell/npm work.

**yellow-research `write-credential-status.sh` (lines 30-34):**
```bash
(
  . "$CACHE_LIB" && _lc_prewarm
) >/dev/null 2>&1 &
disown
```
`_lc_prewarm` calls `curl https://context7.com/api/v1/search` — HTTP to
a data REST API. Not an LLM call, not an agent invocation.

**Conclusion:** Both patterns perform pure shell/CLI/HTTP work and return
immediately. Neither pattern invokes an LLM or spawns an agent. Task tool is
a primitive that exists only in Claude Code's main event loop — a bash
subprocess cannot call it.

**The plan's Phase 1.4 description of spawning a `staging-reviewer` agent
"via Task tool from inside a disowned bash subshell" is architecturally
impossible.** The agent dispatch must happen inside the Claude Code session
(main loop), not from within a shell subprocess. The feasible design is:

- **Stop hook:** write transcript excerpt to staging dir (pure shell work),
  then exit. No LLM call.
- **SessionStart hook:** detect non-empty staging dir, then emit a
  `systemMessage` instructing Claude to process the staging entries — OR,
  the hook just signals existence; the session's first prompt reads it via
  a command/agent invoked by the user or by an auto-trigger mechanism.
- The Task tool dispatch happens inside a proper session context, not from
  a hook subshell.

Alternatively, the claude CLI (`claude -p "..." --model haiku --bare`) can be
called from a disowned subshell, but this starts a fully independent child
session with no access to the parent session's Task graph, MCP connections,
or agent registry. Its output is written to disk; the next session reads the
file. This is viable but requires the plan to explicitly address:
(a) where the output is written, (b) how the next session detects it,
(c) that the child session has no `Task` dispatch capability back to the
parent.

---

## Q6: How to add a content-presence rule to validate-agent-authoring.js

**Finding: The file is 474 lines. Content-presence checking uses the
`validateCommandFiles` function pattern. BASH_SOURCE check is the canonical
example.**

The validator's structure:

```
main()
  ├─ validateAgentFile()   — per-agent frontmatter rules (V1/V2/V3/V4/W1.5)
  ├─ buildTwoToThreeSegmentMap()
  ├─ validateSubagentReferences() — cross-file subagent_type registry check
  └─ validateCommandFiles()  — per-command content-presence rules
```

**Canonical content-presence pattern (`validateCommandFiles`, lines 390-402):**

```js
function validateCommandFiles(commandFiles, errors) {
  for (const filePath of commandFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = extractFrontmatter(content);
    const codeBlocks = content.match(/```[^\n]*\n[\s\S]*?```/g) || [];
    const codeContent = (frontmatter || '') + '\n' + codeBlocks.join('\n');
    if (codeContent.includes('BASH_SOURCE')) {
      errors.push(
        `${relative(filePath)}: markdown command sources plugin files via BASH_SOURCE; ...`
      );
    }
  }
}
```

**Pattern to follow for a new content-presence rule (RULE 14):**

1. Add the rule inside `validateCommandFiles` (for command files) or
   `validateAgentFile` (for agent files), depending on what file type is
   targeted.
2. For agent-body content checks, add after the frontmatter block checks
   in `validateAgentFile`, operating on `content` (full file text).
3. Use `content.includes(...)` for literal string checks or
   `content.match(/regex/)` for pattern checks.
4. Errors use `errors.push(relative(filePath) + ': <rule description>')`.
5. The function receives `errors` by reference via the `ctx` object in
   `validateAgentFile`, or directly in `validateCommandFiles`.

**For a rule that checks agent body content (not just frontmatter):**

```js
// Inside validateAgentFile, after frontmatter checks:
const body = content.slice(content.indexOf('---', 3) + 3).trimStart();
if (!body.includes('expected-content-token')) {
  errors.push(`${relative(filePath)}: missing required content marker`);
}
```

**Important:** `extractFrontmatter` extracts only the frontmatter text.
`content` is the full file. Body = content after the closing `---` of
frontmatter. No separate body-extraction helper exists — derive it inline.

---

## Summary of Plan Risks

| # | Risk | Severity | Finding |
|---|------|----------|---------|
| Q1 | Hook scripts cannot invoke LLM agents directly | **BLOCKER** | Zero precedent in codebase. Plan Phase 1.3 ("Haiku agent via Agent tool") is architecturally incoherent. Must specify: `claude -p` CLI subprocess OR curl-to-API OR defer LLM to next SessionStart |
| Q2 | `async: true` in plugin.json has no precedent | **Gap** | `async: true` is a supported optional hook field (official docs) but is used by no current plugin — no marketplace precedent. Background async is implemented as disowned-subshell within the hook script. Plan uses the disowned-subshell pattern as its primary mechanism. |
| Q5 | Task tool cannot be called from a disowned bash subshell | **BLOCKER** | Confirmed by auditing both existing subshell patterns (morph, research). Both do pure shell/HTTP work. Agent dispatch requires main-loop context. Plan Phase 1.4 design is infeasible as described. |
| Q3 | `disallowedTools` pattern is viable | Confirmed | Well-established in 9 agents across 2 plugins. Must be in frontmatter, not Task invocation parameters. AskUserQuestion is a valid tool name to deny. |
| Q4 | ruvector MCP unavailability handling | Confirmed | Graceful-degradation pattern (conditional guards, degraded-mode note in output). Staging-reviewer should mirror the same "when ruvector is available" guard structure. |
| Q6 | Adding RULE 14 to validate-agent-authoring.js | Confirmed | `validateCommandFiles` is the canonical pattern. Full file is 474 lines; add inside `validateCommandFiles` for command targets or inside `validateAgentFile` for agent targets. |
