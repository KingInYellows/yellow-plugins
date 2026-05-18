# Repo Audit: Background Compounding Triggers
**Date:** 2026-05-18
**Branch:** agent/docs/compound-staging-plan
**Purpose:** Feed the `/workflows:plan` phase for the two-tier background compounding pipeline

---

## Item 1 — `prewarm-morph.sh`: Background Subshell + Disown + Atomic-Move Pattern

**File:** `plugins/yellow-morph/hooks/scripts/prewarm-morph.sh`
**Lines of interest:** 26, 31–36, 79–93

### Template pattern (verbatim, lines 79–93)

```bash
# set -uo pipefail  (line 26 — NO -e, intentional)

# json_exit helper (lines 31–36):
json_exit() {
  local msg="${1:-}"
  [ -n "$msg" ] && printf '[yellow-morph] %s\n' "$msg" >&2
  printf '{"continue": true}\n'
  exit 0
}

# Detached background subshell (lines 79–86):
(
  trap 'yellow_morph_release_install_lock' EXIT INT TERM
  if ! yellow_morph_do_install; then
    yellow_morph_cleanup_failed_install
  fi
) >/dev/null 2>&1 &
sub_pid=$!
disown

# Overwrite pid file with subshell's PID (lines 88–92):
printf '%s' "$sub_pid" > "${CLAUDE_PLUGIN_DATA}/.install.lock/pid" 2>/dev/null || true

json_exit
```

### Key design decisions documented in the header comments (lines 1–25)

- Parent acquires the lock with its own `$$` PID, then passes ownership to subshell via `$!`
- The subshell's trap is the SOLE release point for any acquired locks; parent has no EXIT trap so early exit does not orphan release
- All subshell output is redirected to `/dev/null` to keep the parent's `{"continue": true}` stdout uncorrupted
- `disown` detaches the subshell from the session so Claude Code SIGKILL on timeout does not cascade to the background process
- `$!` (captured in parent) is used instead of `$BASHPID` for bash 3.2+ portability

### For the compounding Stop hook — simplified application

The compounding Stop hook has no lock (no concurrent writers for the same session file), so the pattern collapses to:

```bash
# Detach background agent work; parent exits immediately
(
  # ... all haiku stager work here ...
) >/dev/null 2>&1 &
disown

printf '{"continue": true}\n'
exit 0
```

The `sub_pid` + pid file overwrite step is lock-specific to morph; it does not apply to the compounding stager.

**Plan reference:** "Use lines 79–93 of prewarm-morph.sh as the template, stripped of lock machinery."

---

## Item 2 — `stop.sh` (yellow-ruvector): Existing Stop Hook Structure

**File:** `plugins/yellow-ruvector/hooks/scripts/stop.sh` (45 lines total)

| Property | Value |
|---|---|
| `set` flags | `set -uo pipefail` (no `-e`, documented on line 5) |
| Timeout | **10 seconds** (in `plugin.json` `Stop` hook entry) |
| `json_exit()` | Lines 8–13 — identical shape to morph prewarm |
| `jq` guard | Line 16: `command -v jq >/dev/null 2>&1 \|\| json_exit "Warning: jq not found; skipping stop"` |
| stdin read | Line 19: `INPUT=$(cat)` |
| CWD parse | Line 20: `CWD=$(printf '%s' "$INPUT" \| jq -r '.cwd // ""' 2>/dev/null) \|\| CWD=""` |
| Final output | Line 44: `printf '{"continue": true}\n'` (bare, not via json_exit — this is the success path after real work) |

### `json_exit()` body (lines 8–13)

```bash
json_exit() {
  local msg="${1:-}"
  [ -n "$msg" ] && printf '[ruvector] %s\n' "$msg" >&2
  printf '{"continue": true}\n'
  exit 0
}
```

### Error paths

- `jq` not found → `json_exit "Warning: jq not found; skipping stop"` (line 16)
- `.ruvector/` not present → `json_exit` (silent, line 27)
- Neither `ruvector` nor `npx` found → `json_exit "Warning: neither ruvector nor npx found"` (line 36)
- `ruvector hooks session-end` fails → logs to stderr, does NOT `json_exit`; falls through to bare `printf '{"continue": true}\n'` on line 44

**Confirmed:** 10s timeout is the correct Stop hook budget. New yellow-core Stop hook should match this.

---

## Item 3 — `context7-cache.sh`: `_lc_atomic_write()` Function

**File:** `plugins/yellow-research/hooks/lib/context7-cache.sh`
**Lines:** 166–172

```bash
# Atomic write: tmp file in same dir + mv (matches yellow-ci session-start.sh:156-158).
_lc_atomic_write() {
  local path="$1" content="$2"
  mkdir -p "$(dirname "$path")" 2>/dev/null || return 1
  local tmp="${path}.tmp.$$"
  printf '%s' "$content" > "$tmp" || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$path" || { rm -f "$tmp"; return 1; }
}
```

### Signature

```
_lc_atomic_write <destination_path> <content_string>
```

### Behavior

1. `mkdir -p` on the destination directory — safe to call even if it exists
2. Temp file is `<path>.tmp.$$` (PID-namespaced, same directory as destination)
3. `printf '%s'` (not `echo`) — preserves content exactly including trailing newlines
4. On write failure: removes tmp, returns 1
5. On `mv` failure: removes tmp, returns 1
6. On success: destination atomically replaced by the new content

### For the JSONL stager

The stager adaptation uses a slightly different pattern (staging directory is `pending/`, tmp is in `tmp/`):

```bash
# tmp/<session-id>.jsonl  →  pending/<session-id>.jsonl
STAGING_DIR="${HOME}/.claude/projects/${PROJECT_SLUG}/compound-staging"
TMP_FILE="${STAGING_DIR}/tmp/${SESSION_ID}.jsonl"
PENDING_FILE="${STAGING_DIR}/pending/${SESSION_ID}.jsonl"

mkdir -p "${STAGING_DIR}/tmp" "${STAGING_DIR}/pending"
printf '%s' "$JSONL_CONTENT" > "$TMP_FILE" || { rm -f "$TMP_FILE"; json_exit "tmp write failed"; }
mv "$TMP_FILE" "$PENDING_FILE" || { rm -f "$TMP_FILE"; json_exit "atomic move failed"; }
```

`_lc_atomic_write` is defined in a sourced lib. The stager is a standalone script — inline the equivalent rather than sourcing across plugin boundaries.

---

## Item 4 — `yellow-ci/hooks/scripts/session-start.sh`: SessionStart Structure

**File:** `plugins/yellow-ci/hooks/scripts/session-start.sh` (167 lines total)

### Structure at a glance

| Lines | Block |
|---|---|
| 1–9 | Header + shebang. Latency budget comment on line 4: `# Budget: 3s total (routing cache 1ms, filesystem 1ms, cache check 5ms, gh API 2s, parse 50ms, buffer 500ms)` |
| 7–9 | `set -uo pipefail`, comment explaining `-e` omission |
| 11–14 | `SCRIPT_DIR` derivation + source lib |
| 18–28 | `json_exit()` — two-branch: with jq emits `{"systemMessage": $msg, "continue": true}`; without jq falls back to bare `{"continue": true}` |
| 30–35 | Early exits: `[ ! -d ".github/workflows" ] && json_exit` |
| 37–43 | Fast path: read routing summary from pre-rendered cache (filesystem, no network) |
| 46–53 | gh CLI availability check → `json_exit "$routing_summary"` if absent |
| 55–95 | Cache check (60s TTL): derive `cache_key` via md5, check mtime, return cached result on hit |
| 97–106 | Cache miss: `timeout 2 gh run list ...` — the expensive network call, bounded by `timeout 2` |
| 108–122 | Parse results with jq |
| 124–153 | Build output string |
| 155–163 | Atomic write of cache result (lines 156–158): `printf '%s' "$output" > "${cache_file}.tmp" && mv "${cache_file}.tmp" "$cache_file"` |
| 165–166 | `json_exit "$output"` |

### "Check cache then maybe trigger background work" flow

yellow-ci uses the **read cache → on hit return early → on miss do expensive work → write cache → return** pattern. The yellow-core SessionStart hook needs a different flow:

**Read staging dir → check count + age → if threshold met: spawn background reviewer → always return immediately.**

The key structural difference: yellow-ci does the expensive work inline (bounded by `timeout 2`) and caches the result. The compounding hook NEVER does expensive work inline — it only counts files and spawns a background job. The timeout budget is therefore shorter (the 3s budget in yellow-ci is dominated by the 2s gh call; the compounding hook should target <100ms).

### `json_exit()` variant for SessionStart with systemMessage

```bash
json_exit() {
  if [ -n "${1:-}" ] && command -v jq >/dev/null 2>&1; then
    jq -n --arg msg "$1" '{"systemMessage": $msg, "continue": true}'
  elif [ -n "${1:-}" ]; then
    printf '[yellow-ci] Warning: jq not available; cannot emit system message\n' >&2
    printf '{"continue": true}\n'
  else
    printf '{"continue": true}\n'
  fi
  exit 0
}
```

The compounding SessionStart hook can use this two-branch form if it wants to surface a system message ("Staging reviewer dispatched — N entries queued"). The simpler bare `json_exit` from stop.sh/prewarm-morph is fine if no system message is needed.

---

## Item 5 — `knowledge-compounder.md`: Tools, M3 Gates, Non-Interactive Paths, File Write Helpers

**File:** `plugins/yellow-core/agents/workflow/knowledge-compounder.md` (418 lines)

### Frontmatter

```yaml
name: knowledge-compounder
description: 'Extract and document recently solved engineering problems using parallel subagents...'
model: sonnet
memory: project
tools:
  - Task
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
  - ToolSearch
```

`AskUserQuestion` is in the tools list. The non-interactive mode must either remove it from the invocation's allowed tools or bypass the gate via `$ARGUMENTS` signaling.

### M3 Confirmation Gate locations

**Primary gate (lines 199–212):** Before any writes. Triggered after Phase 1 extraction, after routing decision.

```markdown
## M3 Confirmation
Use AskUserQuestion before any writes. Show:
- Routing decision with rationale
- Resolved file paths
- MEMORY.md section title (if applicable)
Options: "Write [route]" / "Adjust routing" / "Cancel"
```

**Secondary gate (lines 331–375, Context Budget Precheck):** If assembled content > `$KC_CONTEXT_BUDGET` (default 200 lines), a second `AskUserQuestion` fires before writing.

Both gates are inline prompt instructions — they cannot be disabled without modifying the agent body or via a flag in the Task prompt.

### Existing non-interactive signal

Lines 159–161:

```markdown
When spawned by `/workflows:compound`, all findings are worthy (user explicitly
requested compounding) — apply Routing Decision directly without severity filter.
```

This is a **severity-filter bypass** only — it does NOT suppress M3 confirmation. There is currently NO fully non-interactive code path. The `staging-reviewer` cannot delegate to `knowledge-compounder` as-is without hitting AskUserQuestion.

### How to add non-interactive mode (recommended approach)

The Task prompt can include a sentinel:

```
mode: background
```

Add a branch at the top of the M3 Confirmation section:

```markdown
**Background mode:** If the Task prompt contains `mode: background`, skip
AskUserQuestion and apply the routing decision directly. Route defaults:
DOC_ONLY → write solution doc; BOTH → write solution doc + MEMORY.md entry.
Context Budget Precheck also skips — write single-file unconditionally.
```

This is additive — interactive invocations (no `mode: background` in prompt) are unaffected.

### File write helpers

- **Solution docs:** `Write` tool to `$GIT_ROOT/docs/solutions/$CATEGORY/$FINAL_SLUG.md`
- **Solution doc amend:** `Edit` tool (appends `## Update — YYYY-MM-DD` section)
- **MEMORY.md:** `Edit` tool, re-read immediately before edit (TOCTOU protection, lines 403–404)
- **Directory creation:** `mkdir -p "$GIT_ROOT/docs/solutions/$CATEGORY"` inline bash
- **Slug collision loop:** Lines 284–292, appends numeric suffix up to `-10`
- **Post-write verification:** `[ -f "$GIT_ROOT/docs/solutions/$CATEGORY/$FINAL_SLUG.md" ]` (lines 392–397)

### Phase 0 MEMORY_PATH derivation (lines 43–51) — critical for Item 7

```bash
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PROJECT_SLUG="$(printf '%s' "$GIT_ROOT" | tr '/' '-')"
MEMORY_PATH="$HOME/.claude/projects/$PROJECT_SLUG/memory/MEMORY.md"
```

`PROJECT_SLUG` is `tr '/' '-'` applied to the absolute git root. The leading slash becomes a leading hyphen.

---

## Item 6 — `compound-lifecycle/SKILL.md`: Cosine Dedup Logic and `hooks_recall` Usage

**File:** `plugins/yellow-core/skills/compound-lifecycle/SKILL.md` (415 lines)

### 0.82 cosine threshold — where it is defined

**Lines 210–220 (Step 5b, Optional precision pass):**

```markdown
3. **Optional precision pass — ruvector cosine.** When
   `mcp__plugin_yellow-ruvector_ruvector__hooks_recall` is available,
   query each pass-2 candidate's `problem:` line and check whether the
   paired candidate appears in top-3 with cosine ≥ 0.82. Drop pairs
   below 0.82; keep pairs ≥ 0.82.

Threshold rationale: 0.82 is the calibrated default for paragraph-level
semantic equivalence on markdown corpora (Universal Sentence Encoder
convention; Pinecone case study). Surface 0.78–0.90 as "review
suggestions"; mark ≥ 0.90 as "high-confidence overlap" but still gate
on user approval.
```

### How it calls `hooks_recall`

- Tool name used: `mcp__plugin_yellow-ruvector_ruvector__hooks_recall`
- Call pattern: pass the candidate's `problem:` field as the query string
- Interprets: checks whether the paired candidate appears in top-3 results

### Whether the staging-reviewer can reuse this code path

**Yes, directly.** The staging-reviewer's dedup semantic pass is:
> call `hooks_recall` with `candidate_text` as query; if any result scores ≥ 0.82, skip promotion

This is the same tool and threshold. The staging-reviewer should also mirror the graceful degradation from the skill:

```markdown
When ruvector is unavailable, skip the semantic pass and promote based on
content-hash dedup + priority threshold alone.
```

The `hooks_recall` MCP tool is also called in `compound.md` Step 3 with an identical pattern (line 81: `call mcp__plugin_yellow-ruvector_ruvector__hooks_recall with query=content, top_k=1. If score > 0.82, skip`).

**The staging-reviewer does not need to implement new ruvector integration — it reuses the established `hooks_recall` + 0.82 pattern verbatim.**

---

## Item 7 — Auto-Memory Project Hash Derivation (HIGHEST PRIORITY)

### Definitive answer: it is NOT a hash — it is a slash-to-hyphen encode

The `<hash>` in `~/.claude/projects/<hash>/` is a filesystem path encoding, not an MD5 or any cryptographic hash.

### Three independent sources confirm the identical derivation

**Source 1: `knowledge-compounder.md` lines 49–50**

```bash
PROJECT_SLUG="$(printf '%s' "$GIT_ROOT" | tr '/' '-')"
MEMORY_PATH="$HOME/.claude/projects/$PROJECT_SLUG/memory/MEMORY.md"
```

**Source 2: `session-historian.md` lines 123–125**

```bash
# Encode CWD: replace every '/' with '-'. The leading slash becomes a
# leading hyphen — do NOT strip it. /home/user/foo -> -home-user-foo.
ENCODED=$(printf '%s' "$PWD" | sed 's|/|-|g')
PROJECT_DIR="$HOME/.claude/projects/$ENCODED"
```

**Source 3: `session-history/SKILL.md` lines 92 (canonical comment)**

```markdown
- **Claude Code:** `test -d "$HOME/.claude/projects/$(printf '%s' "$PWD" | sed 's|/|-|g')" && echo available || echo missing`
  — note: the encoding REPLACES `/` with `-` (the leading slash becomes a leading hyphen),
  it does NOT strip the leading slash. For `/home/user/projects/foo`, the encoded form is
  `-home-user-projects-foo`.
```

### Confirmed: the user's memory path matches this derivation exactly

The system-reminder shows the user's memory path as:
```
/home/kinginyellow/.claude/projects/-home-kinginyellow-projects-yellow-plugins/memory/MEMORY.md
```

Applied: `/home/kinginyellow/projects/yellow-plugins` → `tr '/' '-'` → `-home-kinginyellow-projects-yellow-plugins`. Confirmed.

### Canonical implementation for the stager and reviewer

Both must use the **same** derivation. The stager runs from a Stop hook (CWD may or may not be the git root). The reviewer runs as an agent. Both must anchor to `git rev-parse --show-toplevel` to get a stable path:

```bash
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PROJECT_SLUG="$(printf '%s' "$GIT_ROOT" | tr '/' '-')"
STAGING_BASE="${HOME}/.claude/projects/${PROJECT_SLUG}/compound-staging"
```

**Do NOT use `sed 's|/|-|g'` vs `tr '/' '-'` interchangeably** — they produce identical output for simple paths, but `sed` is slower. `knowledge-compounder` uses `tr`; the stager and reviewer should also use `tr` for consistency.

**Important:** The Stop hook receives `cwd` in its stdin JSON (`jq -r '.cwd // ""'`). Use that as the starting point for git root resolution in the stager shell script, not `$PWD` (which may be the hook runner's CWD, not the project root).

### Worktree consideration

The brainstorm doc's compound-staging path is `~/.claude/projects/<hash>/compound-staging/`. For worktrees, `git rev-parse --show-toplevel` returns the worktree root, not the main working tree root. Two worktrees of the same repo will produce different slugs and different staging directories. The brainstorm does not address this — the plan phase must decide: use `git worktree list --main | head -1` to anchor to the main tree, or accept per-worktree isolation.

---

## Item 8 — `yellow-core/plugin.json`: Hooks Block Status

**File:** `plugins/yellow-core/.claude-plugin/plugin.json` (22 lines)

**Current content:**

```json
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json",
  "name": "yellow-core",
  "version": "1.17.0",
  "description": "...",
  "author": {...},
  "homepage": "...",
  "repository": "...",
  "license": "MIT",
  "keywords": [...]
}
```

**No `hooks` block.** The `hooks` key is entirely absent. Yellow-core currently has zero registered hooks.

### Required additions (inline schema from yellow-ruvector reference)

The Stop hook entry must follow this exact shape (from `yellow-ruvector/plugin.json` lines 82–93):

```json
"hooks": {
  "Stop": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/stop.sh",
          "timeout": 10
        }
      ]
    }
  ],
  "SessionStart": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.sh",
          "timeout": 3
        }
      ]
    }
  ]
}
```

**yellow-research's SessionStart entry** (lines 89–101 of its `plugin.json`) is an alternative reference for the SessionStart shape — identical schema, different script path and 3s timeout.

**Timeout values:**
- Stop: 10s (matches yellow-ruvector precedent; brainstorm says the parent exits immediately so actual work is done in the disowned subshell — the 10s budget covers only the fork+disown)
- SessionStart: 3s (matches yellow-ruvector and yellow-ci precedent; brainstorm confirms the check is filesystem-only, well under 100ms)

---

## Item 9 — Bats Test Pattern for Hooks (from yellow-ruvector)

### Available bats test files in yellow-ruvector

```
plugins/yellow-ruvector/tests/
  stop.bats              — Stop hook tests
  pre-tool-use.bats      — PreToolUse hook tests
  post-tool-use.bats     — PostToolUse hook tests
  user-prompt-submit.bats — UserPromptSubmit hook tests
  validate.bats          — shared lib (validate.sh) tests
```

Note: there is **no `session-start.bats`** in yellow-ruvector — the session-start hook is not bats-tested there. yellow-ci also has no session-start bats test; its hook coverage is via `redaction.bats`, `validate.bats`, `resolve-runner-targets.bats`, and `ssh-safety.bats`.

### `stop.bats` structure (62 lines) — canonical template

```bash
#!/usr/bin/env bats
bats_require_minimum_version 1.5.0

setup() {
  PROJECT_ROOT="$(mktemp -d)"
  RUVECTOR_DIR="$PROJECT_ROOT/.ruvector"
  mkdir -p "$RUVECTOR_DIR"
  HOOK_SCRIPT="$BATS_TEST_DIRNAME/../hooks/scripts/stop.sh"
  # Stub real binary with a mock that exits 0 silently
  MOCK_BIN="$(mktemp -d)"
  printf '#!/bin/sh\nexit 0\n' > "$MOCK_BIN/ruvector"
  chmod +x "$MOCK_BIN/ruvector"
}

teardown() {
  rm -rf "$PROJECT_ROOT" "$MOCK_BIN"
}

run_hook() {
  echo '{}' | PATH="$MOCK_BIN:$PATH" CLAUDE_PROJECT_DIR="$PROJECT_ROOT" bash "$HOOK_SCRIPT"
}

# Test: outputs continue:true when initialized
# Test: outputs continue:true when dir missing (graceful degradation)
# Test: outputs continue:true when CLI fails (fail-closed on tool error)
# Test: output is always valid JSON (pipe through jq)
```

### For the new yellow-core stop.sh + session-start.sh

The plan should specify these bats tests:

**`plugins/yellow-core/tests/stop.bats`:**
- `@test "outputs continue:true immediately"` — fork+disown, assert JSON before agent can run
- `@test "outputs continue:true when CLAUDE_PROJECT_DIR unset"` — graceful degradation
- `@test "outputs continue:true when jq not installed"` — tool guard
- `@test "writes JSONL to tmp/ before pending/ move"` — verify atomic move (mock haiku agent via stub script)
- `@test "output is valid JSON"` — pipe through `jq`

**`plugins/yellow-core/tests/session-start.bats`:**
- `@test "outputs continue:true when no pending files"` — empty staging dir, skip
- `@test "outputs continue:true when count < threshold and age < 24h"` — below both thresholds
- `@test "spawns reviewer when count >= 5"` — create 5 fake JSONL files, assert reviewer script invoked
- `@test "spawns reviewer when oldest file > 24h"` — touch file with `touch -d '25 hours ago'`, assert threshold fires
- `@test "output is valid JSON always"` — all paths produce parseable output

The test harness pattern: `mktemp -d` for staging dir, `CLAUDE_PROJECT_DIR=<tmpdir>` env injection, `PATH` manipulation to stub any called binaries.

---

## Item 10 — `compound.md`: Structure and Conventions for `compound/review-staged.md`

**File:** `plugins/yellow-core/commands/workflows/compound.md` (99 lines total)

### Frontmatter

```yaml
---
name: workflows:compound
description: Document a recently solved problem to compound team knowledge into memory or solution docs
argument-hint: '[optional: brief context about the fix]'
allowed-tools:
  - Bash
  - Read
  - Task
  - ToolSearch
  - mcp__plugin_yellow-ruvector_ruvector__hooks_recall
  - mcp__plugin_yellow-ruvector_ruvector__hooks_remember
  - mcp__plugin_yellow-ruvector_ruvector__hooks_capabilities
---
```

### Step structure

```
Step 1: Validate Context     — bash guard, docs/solutions/ existence check
Step 2: Delegate to Agent    — Task tool → knowledge-compounder, injection fencing on $ARGUMENTS
Step 3: Persist to Ruvector  — optional ruvector hooks_remember with 0.82 dedup pre-check + retry logic
Step 4: Report Results
```

### Conventions to mirror in `compound/review-staged.md`

1. **Name field:** `workflows:review-staged` (sibling to `workflows:compound`)
2. **allowed-tools:** `Bash`, `Read`, `Task`, `ToolSearch`, plus ruvector MCP tools (same list)
3. **Step 1 guard:** Check `docs/solutions/` exists AND check that staging dir has entries; if staging is empty, output a message and stop
4. **Step 2:** `Task(subagent_type: "yellow-core:workflow:staging-reviewer")` — not `knowledge-compounder` directly
5. **Injection fencing:** Not needed for `$ARGUMENTS` (staging reviewer does not process user-supplied untrusted text), but apply if passing any path-derived content
6. **Step 3 (ruvector):** Same pattern as compound.md Step 3 — after staging-reviewer completes, if docs were written, call `hooks_remember` with the promoted content; skip if ruvector unavailable
7. **No M3 gate in the command itself** — the command is a manual drain trigger; the staging-reviewer handles its own dedup logic (no AskUserQuestion in the reviewer; promotion is automatic for survivors above threshold)

### Structural diff from `compound.md`

| Property | `compound.md` | `review-staged.md` |
|---|---|---|
| Trigger | User ran `/workflows:compound` | User ran `/compound:review-staged` |
| Agent spawned | `knowledge-compounder` | `staging-reviewer` (new) |
| Context passed | Last 25 turns + $ARGUMENTS | Staging dir path (derived, not from user) |
| M3 gate | In `knowledge-compounder` | None (non-interactive by design) |
| Ruvector step | hooks_remember after agent | Same — hooks_remember after agent |

---

## Cross-Cutting Notes for the Plan

### Files to Create

| File | Notes |
|---|---|
| `plugins/yellow-core/hooks/scripts/stop.sh` | Mirrors ruvector stop.sh structure; adds background subshell (prewarm-morph pattern lines 79–86); writes JSONL to staging |
| `plugins/yellow-core/hooks/scripts/session-start.sh` | Mirrors yellow-ci structure; filesystem-only checks; spawns reviewer via disown if threshold met |
| `plugins/yellow-core/agents/workflow/staging-reviewer.md` | New non-interactive agent; ruvector dedup + promote via knowledge-compounder with `mode: background` |
| `plugins/yellow-core/commands/workflows/review-staged.md` | Sibling to compound.md; manual drain trigger |
| `plugins/yellow-core/tests/stop.bats` | 5 tests per Item 9 spec |
| `plugins/yellow-core/tests/session-start.bats` | 5 tests per Item 9 spec |

### Files to Modify

| File | Change |
|---|---|
| `plugins/yellow-core/.claude-plugin/plugin.json` | Add `"hooks"` block with Stop (10s) + SessionStart (3s) entries |
| `plugins/yellow-core/agents/workflow/knowledge-compounder.md` | Add `mode: background` branch at M3 Confirmation section (lines 199–212) to suppress AskUserQuestion |

### Open question resolutions for the plan

**Q: Worktree anchor for staging dir path**
Recommendation: use `git rev-parse --show-toplevel` on the main worktree (derivable via `git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel`, or by parsing `git worktree list --porcelain` for the first `worktree ` line). Rationale: staging entries represent project-level learnings, not worktree-specific state. Alternative: accept per-worktree isolation (simpler, matches current behavior for auto-memory). Defer to plan phase. Plan opted for per-worktree isolation per D5 in plans/background-compounding-triggers.md — this recommendation is research-only and was not adopted.

**Q: knowledge-compounder non-interactive mode**
Mechanism: add `mode: background` sentinel to the Task prompt. The agent body checks for this string and skips AskUserQuestion gates. This is safe — interactive callers never include `mode: background` in their prompts. The plan must add a short paragraph to the M3 Confirmation section of `knowledge-compounder.md`.

**Q: 0.82 threshold for staging-reviewer**
Confirmed directly from compound-lifecycle SKILL.md line 212 and compound.md line 81. Use `hooks_recall` with `top_k=1`, skip if score ≥ 0.82. No new calibration needed.
