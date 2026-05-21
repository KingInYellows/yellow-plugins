# Feature: `setup:claude-web` Command

**Plan date:** 2026-05-18
**Brainstorm:** `docs/brainstorms/2026-05-18-setup-claude-web-command-brainstorm.md`
**Research:** `docs/research/how-claude-code-web-works-and-repository.md`
**Detail level:** STANDARD
**Target plugin:** `yellow-core` (minor bump — additive command)

---

## Problem Statement

Claude Code Web (the browser-hosted cloud agent at `claude.ai/code`) runs in
ephemeral Ubuntu VMs that have no access to a developer's `~/.claude/`
settings, user-scope MCP servers, or locally-installed plugins. Everything the
web agent can use must live in the repository. The failure mode is silent: an
agent that works perfectly locally runs in a cloud session without the tools
and context the developer expects, and there is no obvious diagnostic path
from the symptom ("CI failed") back to the cause ("settings.json missing
`enabledPlugins`").

A single command that audits the current repo and scaffolds the project-scope
files Claude Code Web needs eliminates this class of surprise — and gives the
yellow-plugins ecosystem a canonical answer for downstream repos that want
cloud-session readiness without reading the research doc.

---

## Current State

- `yellow-core` already owns the `setup:` namespace via two commands:
  `setup/all.md` (the marketplace-wide dashboard aggregator) and
  `statusline/setup.md` (status line installer).
- No command currently scaffolds `.claude/settings.json`, bootstrap scripts,
  `.gitattributes`/`.gitignore` patterns, or `.github/workflows/claude.yml`.
- Existing setup-command precedents the new command will mirror:
  - `plugins/yellow-chatprd/commands/chatprd/setup.md` — M3 AskUserQuestion
    gate before write, post-write Read verification
  - `plugins/yellow-ci/commands/ci/setup.md` — tiered interactivity, optional
    section gates, multi-step audit
  - `plugins/yellow-core/commands/statusline/setup.md` — atomic
    Python-based settings.json merge
  - `plugins/yellow-ruvector/commands/ruvector/setup.md` — `.gitignore`
    idempotent append pattern
- `validate-setup-all.js` does NOT enumerate `commands/setup/*.md` and does
  NOT require new commands to appear in `setup:all` — confirmed by reading
  the validator's `loadCommandNames` function and `COMMAND_PLUGIN_MAP`.

---

## Proposed Solution

A single new command, `setup:claude-web`, at
`plugins/yellow-core/commands/setup/claude-web.md`. The command:

1. Audits the current git repo for Claude Code Web readiness via a
   single-pass Bash block that emits `key: value` lines.
2. Displays the audit as a status table.
3. Tier 1 — Auto-writes safe additive edits (`.gitattributes` and
   `.gitignore` line appends) without prompting.
4. Tier 2 — Uses AskUserQuestion to confirm before creating new files
   (`.claude/settings.json`, `scripts/install_pkgs.sh`,
   `.github/workflows/claude.yml`) or merging into existing config.
5. Tier 3 — Emits warnings (CLAUDE.md size, STDIO MCP incompatibility,
   plugin env vars, lockfile gaps) without writing or prompting.
6. Fixes executable bits on bootstrap scripts.
7. Always emits a summary block listing files changed, env vars the user
   must set manually, warnings, and next steps.

The command runs against the current git worktree (no `--target` argument
in v1). Re-running on a fully-configured repo produces zero writes —
idempotency is the invariant.

### Key design decisions (locked from brainstorm)

| Decision | Choice |
|---|---|
| File location | `plugins/yellow-core/commands/setup/claude-web.md` |
| Command name | `setup:claude-web` |
| Interaction model | Tiered (auto / AskUserQuestion / warn) |
| Settings.json merge | Python-based atomic write (mirrors `statusline/setup.md`) |
| `setup:all` integration | Deferred (orthogonal scopes) |
| Marker file | None (files self-evidence) |
| Dry-run flag | None (Tier 2 gates serve the same role) |
| `--target` flag | None (CWD only) |

### Open questions resolved during research

- **SessionStart matcher syntax:** Use `"matcher": "*"`. Confirmed by
  reading all 9 existing yellow-plugins plugin.json SessionStart entries
  (`yellow-ci`, `yellow-ruvector`, `yellow-research`, …) — all use `"*"`.
  Official docs (`code.claude.com/docs/en/hooks`) confirm `*` is the
  universal wildcard.
- **Step 8 scope:** Only scripts referenced in `.claude/settings.json`
  hooks get their executable bits fixed. Not all tracked `*.sh` files
  in the repo. Narrower scope avoids surprising mutation of unrelated
  scripts.
- **`[Skip]` semantics:** Per `ci:setup.md` precedent — skip this step
  only, proceed to next step. Never abort the command on a single skip.
- **`CLAUDE_PROJECT_DIR` fallback:** Generated hook command uses
  `"${CLAUDE_PROJECT_DIR:-$PWD}"/scripts/install_pkgs.sh` to defend
  against the env var being unset in non-standard invocation contexts.

---

## Implementation Plan

### Phase 1: Foundation

- [ ] **1.1** Branch off main via Graphite:
      `gt branch create agent/feat/setup-claude-web-command`
- [ ] **1.2** Create `plugins/yellow-core/commands/setup/claude-web.md`
      with frontmatter only (no body yet) to confirm validator passes
      before filling in step content:
      ```yaml
      ---
      name: setup:claude-web
      description: "Prepare a repository for Claude Code Web: audit and scaffold .claude/settings.json, bootstrap script, .mcp.json transport compatibility, .gitattributes, .gitignore, and GitHub Actions workflow. Use when first enabling cloud sessions, after adding MCP servers, or when cloud sessions fail to find expected tools."
      argument-hint: ''
      allowed-tools:
        - Bash
        - Read
        - Write
        - AskUserQuestion
      ---
      ```
- [ ] **1.3** Run `pnpm validate:agents` against the empty-body file
      to confirm frontmatter is accepted. Expected: passes (no rules
      apply to command-body content yet).
- [ ] **1.4** Normalize line endings: `sed -i 's/\r$//'
      plugins/yellow-core/commands/setup/claude-web.md`

### Phase 2: Command Body Implementation

The body follows a 9-step structure that mirrors `ci:setup.md`. Each
step is a numbered section in the markdown.

#### 2.1 — Step 1: Detect Repo Root

Single Bash block:
- Check `command -v git >/dev/null 2>&1` first; if missing, emit
  `[setup:claude-web] Error: git is not installed.` and stop.
- Run `git rev-parse --show-toplevel 2>/dev/null` to find repo root.
- If empty: emit `This command must be run from inside a git repository.`
  and stop.
- Detect worktree state: compare `git rev-parse --git-dir` to
  `git rev-parse --git-common-dir`. If they differ, emit a warning:
  `[setup:claude-web] Note: running inside a git worktree. Files will be
  written to this worktree.`
- Output: `repo_top: <path>` for use by Step 2.

#### 2.2 — Step 2: Comprehensive Audit (single Bash call)

One Bash block that emits `key: value` lines under section headers
(`=== Settings ===`, `=== Git Attributes ===`, etc.). Vocabulary for
values: `ok | missing | present | corrupt | error | yes | no`.

Audit checks (in order):

```
=== Settings ===
settings_json: exists | missing
settings_json_valid: yes | no | n/a       (jq empty exit code)
settings_has_session_start: yes | no | n/a
settings_has_allow: yes | no | n/a
settings_has_deny: yes | no | n/a
settings_has_env: yes | no | n/a
settings_session_start_has_install_pkgs: yes | no | n/a

=== Bootstrap ===
install_pkgs_exists: yes | no
install_pkgs_has_remote_gate: yes | no | n/a
install_pkgs_exec_bit: yes | no | n/a

=== Lockfiles ===
pkg_manager_pnpm: yes | no
pkg_manager_yarn: yes | no
pkg_manager_npm: yes | no
pkg_manager_uv: yes | no
pkg_manager_pip: yes | no
pkg_manager_cargo: yes | no
pkg_manager_bundler: yes | no
pkg_manager_composer: yes | no
pkg_manager_go: yes | no

=== Git Attributes ===
gitattributes_exists: yes | no
gitattributes_text_auto: present | missing
gitattributes_sh_eol: present | missing

=== Git Ignore ===
gitignore_exists: yes | no
gitignore_env: present | missing
(repeats for: .env.*, .env.local, *.pem, *.key, .aws/, .ssh/, secrets/, credentials/)

=== MCP ===
mcp_json_exists: yes | no
mcp_json_valid: yes | no | n/a
mcp_stdio_count: <integer>
mcp_stdio_servers: <space-separated names>

=== GitHub Actions ===
workflows_dir: yes | no
claude_action_present: yes | no | n/a

=== CLAUDE.md ===
claude_md_lines: <integer>
claude_md_bytes: <integer>

=== Pathology ===
claude_dir_is_file: yes | no                (.claude exists but is not a directory)
scripts_dir_is_file: yes | no               (scripts/ exists but is not a directory)
```

**Defensive patterns required (per MEMORY.md):**
- Every `jq` call captures exit code: `jq ... 2>/dev/null || printf 'key:
  error\n'`. No `2>/dev/null` standalone.
- `~/.claude.json` read guarded by `[ -r ~/.claude.json ]`.
- File-size guard on `.gitignore` / `.gitattributes`: skip pattern checks
  if file is > 1 MiB and emit `gitignore_size: too_large`.

- [ ] **2.2.1** Write the audit Bash block (one fenced code block, single
      `tool: Bash` call in the command body).
- [ ] **2.2.2** Verify the audit produces clean key-value output on a
      fixture: an empty git repo, a partially-configured repo, and a
      fully-configured repo. Adjust outputs to use consistent vocabulary.

#### 2.3 — Step 3: Display Audit Table

LLM step (no tool call beyond text output). The command body instructs
the agent to parse the audit's key-value output and emit a markdown
table with columns: Component | Status | Action. Status values:
`OK | MISSING | PARTIAL | WARN | NEEDS ATTENTION | CORRUPT`. Action
text describes what Step 4–8 will do.

Mark items "→ will auto-fix" in the Action column for Tier 1 items, so
the user sees the projected end-state from the audit table before
prompts begin.

#### 2.4 — Step 4: `.gitattributes` and `.gitignore` (Tier 1, no gate)

Single Bash block. Uses these idempotent-append helpers:

```bash
_ensure_trailing_newline() {
  local f="$1"
  [ -f "$f" ] && [ -s "$f" ] && \
    tail -c1 "$f" | od -An -c | tr -d ' ' | grep -q '\\n' || \
    printf '\n' >> "$f"
}

_append_if_missing() {
  local f="$1" line="$2"
  grep -qF -- "$line" "$f" 2>/dev/null || {
    _ensure_trailing_newline "$f"
    printf '%s\n' "$line" >> "$f"
  }
}
```

Items to append:

**`.gitattributes`:**
- `* text=auto`
- `*.sh eol=lf`

**`.gitignore`:**
- `.env`
- `.env.*`
- `.env.local`
- `*.pem`
- `*.key`
- `.aws/`
- `.ssh/`
- `secrets/`
- `credentials/`

Group `.gitignore` additions under a `# Claude Code Web — sensitive
file protection` comment block if any are missing.

Output a per-file summary: `[setup:claude-web] .gitattributes: appended
2 lines | .gitignore: appended 4 lines | no changes needed`.

#### 2.5 — Step 5: `.claude/settings.json` (Tier 2, AskUserQuestion gate)

**5a — If `claude_dir_is_file: yes`:**
Emit `[setup:claude-web] Error: .claude exists as a regular file, not
a directory. Manual repair required.` and skip to Step 6.

**5b — If `settings_json: missing`:**
Show the scaffold template (full JSON, pretty-printed) as a code block in
the response. Then:
```
AskUserQuestion:
  question: "Write `.claude/settings.json` with a SessionStart hook template
  and empty permissions.allow?"
  options: ["Write it", "Skip"]
```
- If `[Write it]`: write via Python-based atomic write (mirrors
  `statusline/setup.md:439-484` — write to `.tmp`, validate with
  `json.load`, `os.replace` to target).
- If `[Skip]`: emit `[setup:claude-web] Skipping .claude/settings.json
  scaffold.` and proceed to Step 6. Do NOT execute any write commands.

**5c — If `settings_json: exists` AND `settings_json_valid: no`:**
Emit `[setup:claude-web] Warning: .claude/settings.json is not valid JSON
(jq cannot parse it; may contain comments). Skipping settings merge.
Manual repair required before re-running.` Skip to Step 6.

**5d — If `settings_json: exists` AND `settings_json_valid: yes` AND
all required keys present:**
Emit `[setup:claude-web] .claude/settings.json: all required keys present.`
Skip to Step 6.

**5e — If `settings_json: exists` AND `settings_json_valid: yes` AND
some keys missing:**
Show a diff-style summary: "Will add: hooks.SessionStart entry,
permissions.allow entries (N), permissions.deny entries (N), env block
(only if absent)." Then:
```
AskUserQuestion:
  question: "Merge these additions into existing `.claude/settings.json`?"
  options: ["Merge", "Skip"]
```
- If `[Merge]`: run Python atomic merge with these rules:
  - `permissions.allow`: append entries not already present (preserve
    order of existing).
  - `permissions.deny`: append entries not already present.
  - `hooks.SessionStart`: append a new entry IF no existing entry's
    `hooks[].command` matches `*install_pkgs.sh*` (substring).
  - `env`: set `{"NODE_ENV": "test"}` only if `env` key is absent at all.
    Do NOT touch existing `env` block.
- If `[Skip]`: emit `[setup:claude-web] Skipping settings.json merge.`
  Proceed to Step 6.

**Post-write verification (5f):**
- Bash: `jq -e '.hooks.SessionStart | length > 0' .claude/settings.json
  && jq -e '.permissions.allow | type == "array"' .claude/settings.json`
- If non-zero exit: emit `[setup:claude-web] Error: settings.json write
  verification failed.` and stop.
- Then use Read tool: confirm the SessionStart entry's `command` field
  contains `install_pkgs.sh`.

**SessionStart hook entry template (used in merge):**
```json
{
  "matcher": "*",
  "hooks": [
    {
      "type": "command",
      "command": "\"${CLAUDE_PROJECT_DIR:-$PWD}\"/scripts/install_pkgs.sh"
    }
  ]
}
```

**`permissions.allow` defaults to seed (only added if missing):**
- `Bash(<detected install command>)`
- `Bash(git status)`
- `Bash(git diff)`
- `Bash(git log)`

**`permissions.deny` defaults:**
- `Read(**/.ssh/**)`
- `Read(**/.aws/**)`
- `Read(**/.env)`
- `Read(**/.env.*)`

#### 2.6 — Step 6: `scripts/install_pkgs.sh` + SessionStart wire-up (Tier 2)

**6a — Package manager detection logic:**

Priority order (first match wins by default): `pnpm > yarn > npm > uv >
pip > cargo > bundler > composer > go`.

If multiple lockfiles detected:
```
AskUserQuestion:
  question: "Multiple package managers detected: [list]. Which install
  command should the bootstrap script run?"
  options: [each detected manager, "Run all (sequential)", "Skip"]
```
- If `[Skip]`: skip Step 6 entirely.
- Otherwise: use the user's choice.

**6b — If `scripts_dir_is_file: yes`:**
Emit `[setup:claude-web] Error: scripts exists as a regular file, not
a directory. Manual repair required.` and skip to Step 7.

**6c — If `install_pkgs_exists: yes`:**
- If `install_pkgs_has_remote_gate: yes`: emit `[setup:claude-web]
  scripts/install_pkgs.sh exists and has CLAUDE_CODE_REMOTE gate.` Skip
  to Step 7.
- If `install_pkgs_has_remote_gate: no`: emit a warning with the exact
  fix instruction:
  ```
  [setup:claude-web] Warning: scripts/install_pkgs.sh exists but lacks
  the CLAUDE_CODE_REMOTE gate. Without it, the script will run on every
  local session too.

  Add this at line 2 of your script:
      if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then exit 0; fi
  ```
  Do NOT overwrite the user's script. Skip to Step 7.

**6d — If `install_pkgs_exists: no`:**
Build the install command from the detected (or user-chosen) package
manager. Show the script that would be written. Then:
```
AskUserQuestion:
  question: "Write `scripts/install_pkgs.sh` (package manager: <name>)?"
  options: ["Write it", "Skip"]
```
- If `[Write it]`:
  ```bash
  mkdir -p scripts
  INSTALL_CMD="<derived from detection>"
  cat > "scripts/install_pkgs.sh" << __EOF_INSTALL_PKGS__
  #!/bin/bash
  # Note: -e omitted intentionally — hook must exit 0 on all gate paths
  set -uo pipefail

  # Gate: only run full installs in cloud sessions
  if [ "\$CLAUDE_CODE_REMOTE" != "true" ]; then
    exit 0
  fi

  # Project root with safe fallback
  PROJECT_DIR="\${CLAUDE_PROJECT_DIR:-\$PWD}"
  cd "\$PROJECT_DIR" || exit 1

  # Detected package manager: ${INSTALL_CMD}
  ${INSTALL_CMD}

  exit 0
  __EOF_INSTALL_PKGS__
  chmod +x scripts/install_pkgs.sh
  git update-index --chmod=+x scripts/install_pkgs.sh
  printf '[setup:claude-web] Wrote scripts/install_pkgs.sh\n'
  ```
  (`\$VAR` escapes preserve literal dollar signs; `${INSTALL_CMD}`
  expands at write time. Use unquoted heredoc per
  `composio:setup.md:190` precedent.)
- If `[Skip]`: emit `[setup:claude-web] Skipping scripts/install_pkgs.sh.`
  Proceed to Step 7.

**6e — Post-write verification:**
- Bash: `[ -f scripts/install_pkgs.sh ] && grep -q 'CLAUDE_CODE_REMOTE'
  scripts/install_pkgs.sh && grep -q 'exit 0' scripts/install_pkgs.sh`
- If non-zero exit: emit error and stop.
- Then Read tool: confirm gate and install command lines are present.

#### 2.7 — Step 7: `.github/workflows/claude.yml` (Tier 2, conditional)

**7a — If `workflows_dir: no`:**
Emit `[setup:claude-web] No .github/workflows/ directory found. Skipping
claude.yml (GitHub Actions not in use in this repo).` Proceed to Step 8.

**7b — If `claude_action_present: yes`:**
Emit `[setup:claude-web] Workflow using anthropics/claude-code-action
already present. Skipping.` Proceed to Step 8.

**7c — Otherwise:**
Show the workflow template (full YAML). Then:
```
AskUserQuestion:
  question: "Write `.github/workflows/claude.yml`?"
  options: ["Write it", "Skip"]
```
- If `[Write it]`: write the workflow via Write tool, then `sed -i
  's/\r$//' .github/workflows/claude.yml` to strip any CRLF.
- If `[Skip]`: emit skip message. Proceed to Step 8.

**Workflow template:**
```yaml
# Set ANTHROPIC_API_KEY in GitHub repository secrets before this runs.
# Adjust `permissions` to match your security policy — contents: write is
# needed for auto-fix push behavior.
name: Claude Code
on:
  pull_request:
    types: [opened, synchronize, reopened]
  issue_comment:
    types: [created]

permissions:
  contents: write
  pull-requests: write
  issues: read

jobs:
  claude:
    runs-on: ubuntu-latest
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

<!-- deepen-plan: external -->
> **Research (2026-05-18):** The template above diverges from Anthropic's
> canonical `claude-code-action@v1` shape in four ways the implementer
> should fix before writing:
>
> 1. **`if:` filter triggers Claude unconditionally on every PR.** The
>    `github.event_name == 'pull_request'` arm fires on every open/sync/
>    reopen with no `@claude` guard. Anthropic's canonical pattern gates
>    every trigger on `contains(...body, '@claude')`. Replace the bare PR
>    arm with a `pull_request_review_comment` arm that includes the same
>    `@claude` substring check.
> 2. **Missing `pull_request_review_comment` trigger.** Anthropic's
>    canonical form subscribes to three comment surfaces: `issue_comment`,
>    `pull_request_review_comment`, and `issues`. The scaffolded `on:`
>    block should add `pull_request_review_comment: { types: [created] }`.
> 3. **`issues: read` should be `issues: write`.** Anthropic's
>    recommended permissions block for the `@claude`-mention workflow is
>    `contents: write`, `pull-requests: write`, `issues: write`. Optional:
>    add `actions: read` if the workflow needs to query check-run state.
> 4. **`@v1` is current** (latest tag v1.0.124, August 2025). The input
>    name `anthropic_api_key` (underscores) is correct. There is **no**
>    `system_prompt:` input in v1 — do not emit one. For instruction
>    injection use `claude_args: --append-system-prompt "..."`.
>
> Canonical references:
> - https://github.com/anthropics/claude-code-action (README + releases)
> - https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md
> - https://code.claude.com/docs/en/github-actions
<!-- /deepen-plan -->

#### 2.8 — Step 8: Executable Bits (Tier 1, scoped to hook-referenced scripts)

After Step 5 has finalized settings.json, scope the chmod fix to ONLY
scripts referenced in `.claude/settings.json` hooks:

```bash
# Extract all hook command paths from settings.json
HOOK_SCRIPTS=$(jq -r '
  [.hooks // {} | to_entries[].value[]?.hooks[]?.command]
  | map(select(. != null))
  | map(capture("(?<path>[^\"]+\\.sh)"; "g") | .path)
  | flatten
  | unique
  | .[]
' .claude/settings.json 2>/dev/null)

for raw_path in $HOOK_SCRIPTS; do
  # Strip "$CLAUDE_PROJECT_DIR" or ${CLAUDE_PROJECT_DIR:-$PWD} prefix
  rel=$(printf '%s' "$raw_path" | sed -E 's|.*\}/||; s|.*"/||; s|.*\$PWD"/||')
  full="$repo_top/$rel"
  if [ -f "$full" ] && git ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
    mode=$(git ls-files --format='%(objectmode) %(path)' -- "$rel" | awk '{print $1}')
    if [ "$mode" = "100644" ]; then
      chmod +x "$full"
      git update-index --chmod=+x "$rel"
      printf '[setup:claude-web] Fixed executable bit: %s\n' "$rel"
    fi
  fi
done
```

If no hook-referenced scripts found, skip silently. Print no output.

#### 2.9 — Step 9: Summary Output

LLM step. Always emitted. Aggregates information from Steps 2–8:

```text
═══════════════════════════════════════════════════════════
  Claude Code Web Setup — Summary
═══════════════════════════════════════════════════════════

Files written/modified:
  ✓ .gitattributes — appended N lines
  ✓ .gitignore — appended N lines
  ✓ .claude/settings.json — scaffolded (or merged)
  ✓ scripts/install_pkgs.sh — created
  ✓ .github/workflows/claude.yml — created
  (or "none — no changes needed")

🔑 REQUIRED MANUAL ACTION
   Set ANTHROPIC_API_KEY as a GitHub repository secret:
   https://github.com/<repo>/settings/secrets/actions

Env vars to set in cloud environment UI at claude.ai/code:
  - <plugin>.<key> (for plugin '<plugin>')
  - <mcp server> env vars (from .mcp.json placeholders)
  (or "none")

Warnings requiring human review:
  ⚠ CLAUDE.md is N lines (>200 recommended for cloud agent context)
  ⚠ .mcp.json contains STDIO server '<name>' — may not work in web sandbox
  ⚠ scripts/install_pkgs.sh exists but lacks CLAUDE_CODE_REMOTE gate
  (or "none")

Next steps:
  1. Set ANTHROPIC_API_KEY as a GitHub repository secret
  2. Set the env vars listed above in the cloud environment UI
  3. Install the Claude GitHub App (required for Auto-fix)
  4. Test a cloud session: open claude.ai/code and select this repo

For details on Claude Code Web architecture:
  docs/research/how-claude-code-web-works-and-repository.md
```

Note: the "🔑 REQUIRED MANUAL ACTION" block is visually prominent
(separate from "Next steps") because missing the secret is the most
common cause of subsequent CI failures.

### Phase 3: Quality & Documentation

- [ ] **3.1** Update `plugins/yellow-core/CLAUDE.md` "Commands" count
      and list (e.g., `### Commands (8)` → `### Commands (9)`, add the
      new bullet).
- [ ] **3.2** Update `plugins/yellow-core/README.md` Commands table
      (add a new row).
- [ ] **3.3** Run `pnpm changeset`:
      - Plugin: `yellow-core`
      - Bump: `minor`
      - Message: `feat(yellow-core): add /setup:claude-web command to
        scaffold Claude Code Web readiness in any repo`
- [ ] **3.4** Run validators:
      - `pnpm validate:agents` (must pass)
      - `pnpm validate:plugins`
      - `pnpm validate:setup-all` (confirm no failure from absence)
      - `pnpm test:unit`
      - `pnpm typecheck`
      - `pnpm lint`
- [ ] **3.5** CRLF normalize: `sed -i 's/\r$//'
      plugins/yellow-core/commands/setup/claude-web.md`
- [ ] **3.6** Manual smoke test on a fresh fixture repo (see test
      matrix below): minimum two scenarios from Phase 4 (fresh repo +
      fully-configured repo) before commit.
- [ ] **3.7** Commit: `gt commit create -m "feat(yellow-core): add
      /setup:claude-web command"`
- [ ] **3.8** Submit: `gt stack submit`

---

## Technical Details

### Files to create

| Path | Purpose |
|---|---|
| `plugins/yellow-core/commands/setup/claude-web.md` | The command itself |
| `.changeset/<auto-named>.md` | Minor bump for yellow-core |

### Files to modify

| Path | Change |
|---|---|
| `plugins/yellow-core/CLAUDE.md` | Commands count (8 → 9), add bullet, optional "Cloud Sessions" section |
| `plugins/yellow-core/README.md` | Commands table row |

### Dependencies

No new dependencies. The command uses only Bash, jq, Python 3, and git —
all of which are universally available in development environments and
the Claude Code Web sandbox per official docs.

### `plugin.json`

`plugins/yellow-core/.claude-plugin/plugin.json` has NO `commands:`
array — Claude Code auto-discovers from the file tree. No manifest
edit required.

### Validators that will run on this change

- `validate-agent-authoring.js` — `validateCommandFiles` scans all
  `commands/*.md` for `BASH_SOURCE` usage. We don't use it. Passes.
- `validate-plugin.js` — only validates `plugin.json`. Unchanged.
  Passes.
- `validate-setup-all.js` — confirmed via `loadCommandNames` that it
  does NOT require new `setup:*` commands to be listed in
  `setup:all.md`. Passes.

---

## Acceptance Criteria

15 testable criteria; every one should pass before the PR merges:

1. Fresh git repo with no `.claude/` and answering `[Write it]` to all
   Tier 2 prompts produces: valid `.claude/settings.json`, executable
   `scripts/install_pkgs.sh`, updated `.gitattributes`, updated
   `.gitignore`, and `claude.yml` (if `.github/workflows/` exists).
2. `[Skip]` for all Tier 2 prompts still executes Tier 1 writes and
   produces the summary block.
3. Re-running on a fully configured repo produces zero file writes
   and zero Tier 2 prompts.
4. Existing `.claude/settings.json` with partial config triggers merge
   prompt; merging preserves all existing keys.
5. Outside a git repo: clear error message, no writes.
6. Corrupt JSON in settings.json: warning emitted, merge skipped,
   remaining steps continue.
7. Two lockfiles (pnpm + npm): AskUserQuestion prompts user to pick.
8. STDIO MCP warnings never block the command.
9. Tier 1 appends are idempotent: second run does not duplicate lines.
10. Step 8 executable-bit fix applies ONLY to scripts referenced in
    settings.json hooks (not all tracked `*.sh` files).
11. Settings.json `env` block: only added if absent; never mutated.
12. `claude.yml` skipped silently if no `.github/workflows/` directory.
13. After `install_pkgs.sh` write: `git ls-files --format` shows mode
    `100755`.
14. Step 9 summary block always prints.
15. `permissions.deny` entries appended, never replaced.

---

## Edge Cases & Error Handling

| Scenario | Handling |
|---|---|
| `.claude` exists as a regular file | Error in Step 5; skip to Step 6 |
| `scripts` exists as a regular file | Error in Step 6; skip to Step 7 |
| `.claude/settings.json` is JSONC (comments) | Warning; skip merge; continue |
| `.claude/settings.json` is corrupt JSON | Warning; skip merge; continue |
| `.mcp.json` is invalid JSON | Audit emits `mcp_json_valid: no`; warn in summary; continue |
| `.gitignore` > 1 MiB | Skip pattern checks; emit `gitignore_size: too_large` warning |
| Git not in PATH | Step 1 errors out cleanly |
| Git worktree invocation | Step 1 emits warning; continues |
| Multiple lockfiles | Step 6 AskUserQuestion picks one |
| `~/.claude.json` permission denied | Audit emits `user_mcp_readable: no`; advisory only |
| `install_pkgs.sh` has inverted gate | Warning with fix; no overwrite |
| `.gitattributes` already has `*.sh text` | Append `*.sh eol=lf`; note that last rule wins |
| Org restricts allowed Actions | Summary mentions org-policy considerations |

---

## Security Notes

- Audit MUST NOT echo values from `.mcp.json` or `~/.claude.json` — only
  keys, server names, and types. Implementation rule: use
  `jq -r '.mcpServers | keys[]'` and `.mcpServers[].type`, never `[]`
  alone (which would dump nested env blocks).
- All user inputs are enum picks from AskUserQuestion — no free-text
  interpolated into file writes or shell commands.
- Generated `claude.yml` header comment explicitly notes that
  `contents: write` permission is needed for auto-fix and should be
  reviewed against the org's security policy.
- Generated `install_pkgs.sh` uses hardcoded install commands from a
  finite set of detected lockfiles — no user-typed input becomes part
  of the script body.

---

## Performance Notes

- Single-pass audit (Step 2) reads ~15 small files and runs ~30 grep/jq
  invocations. Bounded constant work for a typical repo.
- Step 8 chmod loop is bounded by number of hook-referenced scripts
  (usually 0–3, never more than a handful).
- `.gitattributes` / `.gitignore` size guard: skip pattern check if
  file > 1 MiB to defend against pathological inputs.

---

## Test Matrix (manual smoke tests)

Run at least the bolded scenarios before commit. Document outcomes in
the PR description.

| # | Fixture | Expected | Priority |
|---|---|---|---|
| 1 | **Empty dir (no `.git`)** | Early exit with "must be run from inside a git repository" | **MUST** |
| 2 | **Fresh git repo, no `.claude/`, no lockfiles** | Tier 1 writes succeed; Tier 2 prompts; skips claude.yml | **MUST** |
| 3 | Fresh git repo with `pnpm-lock.yaml` only | Bootstrap script uses `pnpm install --frozen-lockfile` | SHOULD |
| 4 | Fresh git repo with `pnpm-lock.yaml` AND `package-lock.json` | AskUserQuestion prompts user to pick | SHOULD |
| 5 | Existing valid settings.json, no hooks | Merge prompt; merge adds SessionStart entry; preserves existing keys | SHOULD |
| 6 | Existing settings.json with invalid JSON | Warning; merge skipped; remaining steps continue | SHOULD |
| 7 | Existing settings.json as JSONC (with `//` comments) | Same as invalid JSON | OPTIONAL |
| 8 | Existing `install_pkgs.sh` WITH correct gate | "Already exists" reported; no write | SHOULD |
| 9 | Existing `install_pkgs.sh` WITHOUT gate | Warning with exact fix; no overwrite | SHOULD |
| 10 | `.github/workflows/` with `anthropics/claude-code-action` already | Skip; no prompt | SHOULD |
| 11 | No `.github/workflows/` directory | Step 7 skipped silently | MUST |
| 12 | **Fully configured repo** | Zero writes; zero Tier 2 prompts; "No changes needed" | **MUST** |
| 13 | `.mcp.json` with `type: stdio` `command: "npx"` | "may work" warning | OPTIONAL |
| 14 | `.mcp.json` with `type: stdio` custom binary | "will not work" warning | OPTIONAL |
| 15 | `.mcp.json` invalid JSON | Warning; MCP audit skipped | SHOULD |
| 16 | `.claude` as a regular file | Error in Step 5; continue to Step 6 | SHOULD |
| 17 | Worktree invocation | Warning shown before writes begin | OPTIONAL |
| 18 | CLAUDE.md > 200 lines | Tier 3 warning in summary | SHOULD |

---

## v1 Out of Scope (deferred to follow-ups)

- `--target <dir>` argument
- `--dry-run` flag
- Marker file (`.claude/.web-setup-complete`)
- `claude mcp list` shell-out
- Scaffolding `.devcontainer/devcontainer.json`
- Auto-migrating STDIO MCP servers to HTTP
- Integration into `setup:all` dashboard ("Cloud readiness" section)
- Automated testing of live cloud sessions
- Setting `ANTHROPIC_API_KEY` directly (requires GitHub UI)
- Modifying `CLAUDE.md` or writing `AGENTS.md` for the target repo

---

## References

- Brainstorm: `docs/brainstorms/2026-05-18-setup-claude-web-command-brainstorm.md`
- Research: `docs/research/how-claude-code-web-works-and-repository.md`
- Precedent command — atomic settings.json merge: `plugins/yellow-core/commands/statusline/setup.md:439-484`
- Precedent command — post-write Read verification: `plugins/yellow-chatprd/commands/chatprd/setup.md:140-149`
- Precedent command — tiered interactivity + audit: `plugins/yellow-ci/commands/ci/setup.md`
- Precedent command — `.gitignore` idempotent append: `plugins/yellow-ruvector/commands/ruvector/setup.md:75`
- Precedent command — heredoc delimiter `__EOF_<CONTEXT>__`: `plugins/yellow-composio/commands/composio/setup.md:190-209`
- Validator surface: `scripts/validate-agent-authoring.js`, `scripts/validate-plugin.js`, `scripts/validate-setup-all.js`
- Official Claude Code Web docs: `code.claude.com/docs/en/claude-code-on-the-web`, `code.claude.com/docs/en/hooks`
- Bash anti-patterns reference: `MEMORY.md` "Command File Anti-Patterns" and "Bash Hook & Validation Patterns" sections

<!-- deepen-plan: external -->
> **Research (2026-05-18):** Verified-current Anthropic sources for the
> primitives this command scaffolds:
>
> - **`anthropics/claude-code-action` (v1.0.124, Aug 2025)** —
>   https://github.com/anthropics/claude-code-action
>   (canonical workflow, input names, permissions guidance)
> - **GitHub Actions integration docs** —
>   https://code.claude.com/docs/en/github-actions
>   (migration table, claude_args replacement for custom_instructions)
> - **Hooks reference** —
>   https://code.claude.com/docs/en/hooks
>   (SessionStart matcher syntax: `"*"`, `""`, pipe-separated
>   `"startup|resume"` all valid; array form NOT supported)
> - **Cloud session env vars** —
>   https://code.claude.com/docs/en/claude-code-on-the-web
>   (`CLAUDE_CODE_REMOTE=true` confirmed canonical; sibling
>   `CLAUDE_CODE_REMOTE_SESSION_ID` available for transcript URLs but
>   not used as a gate)
> - **Env vars reference** —
>   https://code.claude.com/docs/en/env-vars
>   (confirms `CLAUDE_CODE_WEB` / `CLAUDE_CLOUD_SESSION` are NOT
>   public — do not branch on them)
>
> Prior-art check (2026-05-18): Anthropic has NOT shipped a
> `claude code init` / `claude code web-init` equivalent; no community
> plugin in the marketplace scaffolds cloud-session readiness. This
> command does not duplicate existing tooling.
<!-- /deepen-plan -->

