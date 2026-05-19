# Brainstorm: `setup:claude-web` Command

**Date:** 2026-05-18
**Topic:** How to design and build the `setup:claude-web` command in yellow-core
**Research basis:** `docs/research/how-claude-code-web-works-and-repository.md`
**Status:** Ready for `/workflows:plan`

---

## What We're Building

A new command, `setup:claude-web`, that prepares a user's repository for use
with Claude Code Web (the browser-hosted, cloud-VM execution surface at
`claude.ai/code`). The command audits and scaffolds the configuration files that
Claude Code Web requires — those that must live inside the repository because
the web sandbox has no access to `~/.claude/settings.json`, user-scope MCP
servers, or locally installed plugins. It lives at
`plugins/yellow-core/commands/setup/claude-web.md` and is invoked as
`/setup:claude-web`.

The command runs against the current working repository (wherever the user invokes
it). It does not accept a `--target` argument in v1.

---

## Why This Approach

Claude Code Web's ephemeral VM model means that everything working locally —
user-scope settings, shell exports, `claude mcp add` entries, locally installed
plugins — is invisible in a cloud session. The failure mode is silent: the
agent runs but without the tools and context the developer expects. A single
idempotent setup command that audits and scaffolds the required project-scope
files eliminates this class of surprise.

Placement in `yellow-core/commands/setup/` is correct: yellow-core already owns
the `setup:` namespace and `setup:all` aggregator. The command follows the same
shape as `ci:setup` and `chatprd:setup` — Bash audit steps, tiered
AskUserQuestion gates before any write, idempotency via detect-before-write.

---

## Key Decisions

### 1. v1 Scope

v1 implements all 11 checklist items from the research (Part C), tiered by
risk:

**Tier 1 — Auto-write (safe, additive-only, no existing content displaced):**
- C.6: `.gitattributes` — append `* text=auto` and `*.sh eol=lf` only if missing
- C.8: `.gitignore` — append missing sensitive-file patterns only
- C.9: Executable bits — `chmod +x` + `git update-index --chmod=+x` for scripts
  referenced in settings.json hooks that lack the bit

**Tier 2 — AskUserQuestion before write (creates new files or modifies config):**
- C.1: `.claude/settings.json` — scaffold if absent; merge if present
- C.2: `scripts/install_pkgs.sh` — write if absent; inspect + warn if present
- C.5: `.github/workflows/claude.yml` — scaffold if absent; skip if any
  `claude-code-action` workflow exists

**Tier 3 — Warn only (human judgment required):**
- C.3: `.mcp.json` — audit STDIO server entries, warn but never rewrite
- C.4: `enabledPlugins` / plugin userConfig — warn about missing env vars,
  never modify
- C.7: CLAUDE.md size — warn if >200 lines or >25 KB, never modify
- C.10: Lockfile consistency — warn if package manager detected but lockfile
  missing/gitignored, never modify

**Tier 4 — Summary (always runs):**
- C.11: Final summary block — files written, env vars needed, warnings, next steps

**Rejected from v1:**
- `--target <dir>` argument: YAGNI. Every real use case involves the current
  repo. Can be added later without breaking the existing interface.
- Dry-run mode: Adds flag-parsing complexity. Tier 2 AskUserQuestion gates
  already achieve "review before write" at each step.
- Marker file: Files written are self-evidencing; re-running the command detects
  its own prior writes. A marker file adds state without adding value.
- `claude mcp list` shell-out: The `claude` CLI is not guaranteed to be in PATH
  in all invocation contexts. Read `.mcp.json` and user-scope `~/.claude.json`
  directly instead (advisory only; user-scope servers cannot be moved
  automatically).

### 2. Interaction Model

**Tiered** (not fully unattended, not fully interactive):

The model follows `ci:setup` precedent: safe, additive file appends (Tier 1)
execute without asking; file creation or config modification (Tier 2) requires
AskUserQuestion confirmation; structural decisions (Tier 3) emit warnings only.

Rationale: Tier 1 writes (gitattributes lines, gitignore entries, chmod) have
zero destructive potential — they can only add, never subtract or overwrite.
Tier 2 writes create new files or modify existing config, which can disrupt a
carefully tuned setup. Confirmation gates here follow the M3 pattern already
used by chatprd:setup (show what would be written, ask "Save this?" or "Write
this file?"). AskUserQuestion must be used — not prose asking — for every
Tier 2 prompt.

### 3. File Structure

**Location:** `plugins/yellow-core/commands/setup/claude-web.md`

**Frontmatter:**

```yaml
---
name: setup:claude-web
description: "Prepare a repository for Claude Code Web: audit and scaffold .claude/settings.json, bootstrap script, .mcp.json transport compatibility, .gitattributes, .gitignore, and GitHub Actions workflow. Use when first enabling cloud sessions, after adding MCP servers, or when cloud sessions fail to find expected tools."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - AskUserQuestion
---
```

Notes on `allowed-tools`:
- No `ToolSearch` needed: no deferred MCP tools are invoked.
- `Edit` is listed because Step 5 (settings.json merge) may use Edit to add
  keys to an existing file rather than wholesale-replacing it.
- No MCP tool names needed: the command does not call any MCP servers.

### 4. Step-by-Step Command Body Outline

```
Step 1: Detect Repo Root
Step 2: Comprehensive Audit (single Bash call)
Step 3: Classify and Display Audit Results
Step 4: .gitattributes and .gitignore (Tier 1 — auto-write, no gate)
Step 5: .claude/settings.json (Tier 2 — AskUserQuestion gate)
Step 6: scripts/install_pkgs.sh + SessionStart hook wire-up (Tier 2 — AskUserQuestion gate)
Step 7: .github/workflows/claude.yml (Tier 2 — AskUserQuestion gate, conditional)
Step 8: Executable bits (Tier 1 — auto-fix)
Step 9: Summary Output (always)
```

**Step 1: Detect Repo Root**

Single Bash call:
```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$repo_top" ] && printf 'repo_top: %s\n' "$repo_top" || printf 'repo_top: NOT_FOUND\n'
```

If `repo_top` is NOT_FOUND: report "This command must be run from inside a git
repository." and stop. Do not proceed.

**Step 2: Comprehensive Audit**

Single Bash call collecting all signals needed for Steps 3-8. Outputs a
key-value report. Checks performed:

- `.claude/settings.json` exists? Has `hooks.SessionStart`? Has
  `permissions.allow`? Has `enabledPlugins`?
- `scripts/install_pkgs.sh` exists? Has `CLAUDE_CODE_REMOTE` gate?
- Package manager lockfiles: `pnpm-lock.yaml`, `yarn.lock`,
  `package-lock.json`, `uv.lock`, `requirements.txt`, `Cargo.lock`,
  `Gemfile.lock`, `composer.lock`, `go.sum`
- `.mcp.json` exists? For each entry: `type` value (stdio vs http/sse);
  for stdio entries: `command` value (npx/python/node = "maybe-ok" vs other =
  "warn")
- `.gitattributes` exists? Has `text=auto`? Has `*.sh eol=lf`?
- `.gitignore` exists? Covers: `.env`, `.env.*`, `.env.local`, `*.pem`,
  `*.key`, `.aws/`, `.ssh/`, `secrets/`, `credentials/`?
- `.github/workflows/` contains any file with `anthropics/claude-code-action`?
- `CLAUDE.md` line count and byte size
- `~/.claude.json` exists? (user-scope MCP detection; advisory only)
- For each `enabledPlugins` entry: corresponding plugin.json path in plugin
  cache; `userConfig` keys without defaults

The audit MUST run as a single Bash call (following `setup:all` precedent) to
avoid PATH drift between calls and to keep the step count low.

**Step 3: Classify and Display Audit Results**

Print a compact audit table — one row per check area, status (OK / MISSING /
WARN / NEEDS ATTENTION). Example:

```text
Claude Code Web Readiness Audit
================================
  .claude/settings.json      MISSING       Will scaffold
  scripts/install_pkgs.sh    MISSING       Will scaffold (pnpm detected)
  SessionStart hook          MISSING       Will add to settings.json
  permissions.allow          MISSING       Will scaffold empty list
  .mcp.json                  OK            No STDIO servers detected
  .gitattributes             PARTIAL       Missing *.sh eol=lf
  .gitignore                 PARTIAL       Missing: .env.*, *.key, .aws/, .ssh/
  CLAUDE.md                  WARN          312 lines (>200 recommended)
  GitHub Actions             MISSING       Will scaffold claude.yml
  Lockfile                   OK            pnpm-lock.yaml present and tracked
  Plugins (enabledPlugins)   N/A           No enabledPlugins in project settings
```

**Step 4: .gitattributes and .gitignore (Tier 1)**

If `.gitattributes` is missing required entries: append them. Do not rewrite
the file; use `printf >> file` pattern via Bash.

If `.gitignore` is missing any of the sensitive-path patterns: append the
missing ones under a `# Claude Code Web — sensitive file protection` comment
block. Do not rewrite; append only.

Both operations are automatic (no AskUserQuestion). Print what was appended.

**Step 5: .claude/settings.json (Tier 2)**

If file is absent: show the template that would be written. Ask via
AskUserQuestion: "Write `.claude/settings.json` with a SessionStart hook
template and empty permissions.allow?" Options: `[Write it]` / `[Skip]`.

If file exists but is missing keys: show exactly which keys would be added
(SessionStart hook entry, permissions.allow list, or env block). Ask via
AskUserQuestion: "Merge these additions into existing `.claude/settings.json`?"
Options: `[Merge]` / `[Skip]`.

If file exists and already has all required keys: report "settings.json looks
good" and skip.

**Merge strategy for existing settings.json:**
- `permissions.allow`: read existing array, append new entries if not already
  present. Never remove entries.
- `hooks.SessionStart`: read existing array. If `scripts/install_pkgs.sh` hook
  not already present, append it. Do not replace existing hooks.
- `permissions.deny`: append sensitive-path deny entries not already present.
- `env`: only add `NODE_ENV: test` if no `env` block exists at all (do not add
  if env block is present — user may have customized it).
- All other existing keys: preserved unchanged.

**Step 6: scripts/install_pkgs.sh + SessionStart wire-up (Tier 2)**

Detect package manager from audit results (pnpm > yarn > npm > uv/pip > cargo
> bundler > composer > go, in priority order; if multiple detected, report all
and ask which to include in the script).

If `scripts/install_pkgs.sh` exists:
- Inspect for `CLAUDE_CODE_REMOTE` gate. If missing: warn
  "[setup:claude-web] Warning: scripts/install_pkgs.sh is missing the
  CLAUDE_CODE_REMOTE gate — it will run on every local session too." Do NOT
  overwrite. User must fix manually.
- If gate is present: report "Bootstrap script already exists and has
  CLAUDE_CODE_REMOTE gate." Skip write.

If `scripts/install_pkgs.sh` does not exist:
- Show the script that would be written (with detected package manager install
  command, CLAUDE_CODE_REMOTE gate, explicit `exit 0`).
- Ask via AskUserQuestion: "Write `scripts/install_pkgs.sh`?" Options:
  `[Write it]` / `[Skip]`.
- If written: `chmod +x scripts/install_pkgs.sh` and
  `git update-index --chmod=+x scripts/install_pkgs.sh` immediately after.

Bootstrap script canonical template:
```bash
#!/bin/bash
# Gate: only run full installs in cloud sessions
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

# Detected package manager: [pnpm|yarn|npm|pip|cargo|bundle|composer|go]
[install command here]

exit 0
```

The SessionStart hook entry for settings.json (also written in Step 5 if
triggered):
```json
{
  "type": "command",
  "command": "\"$CLAUDE_PROJECT_DIR\"/scripts/install_pkgs.sh"
}
```

**Step 7: .github/workflows/claude.yml (Tier 2)**

Run only if the repo has a `.github/workflows/` directory (i.e., it already
uses GitHub Actions).

If any workflow file already contains `anthropics/claude-code-action`: report
"GitHub Actions workflow with claude-code-action already present. Skipping."
and skip.

If no such workflow exists: show the minimal template that would be written.
Ask via AskUserQuestion: "Write `.github/workflows/claude.yml`?" Options:
`[Write it]` / `[Skip]`.

Template follows the canonical pattern from the research (Part B.8):
- Triggers: `pull_request` (opened/synchronize/reopened) and `issue_comment`
  (created, filtered to `@claude` mentions)
- Permissions: `contents: write`, `pull-requests: write`, `issues: read`
- Single job with `actions/checkout@v4` + `anthropics/claude-code-action@v1`
- `ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}`
- Comment at top: "# Note: Set ANTHROPIC_API_KEY in GitHub repository secrets"

**Step 8: Executable Bits (Tier 1)**

After all writes are complete, check every `*.sh` file referenced in
`.claude/settings.json` hooks (the now-current version after Step 5):

```bash
git ls-files --format='%(objectmode) %(path)' -- '*.sh'
```

For any `.sh` file that is tracked by git but has mode `100644` (not executable):
run `chmod +x <file>` and `git update-index --chmod=+x <file>`. Report which
files were fixed.

**Step 9: Summary Output**

Always printed, regardless of what was written or skipped.

```text
Setup Complete — Claude Code Web Readiness
==========================================

Files written/modified:
  [list or "none"]

Env vars to set in cloud environment UI:
  [list of plugin userConfig keys without defaults, with plugin name]
  [list of MCP server env var placeholders found in .mcp.json]
  ANTHROPIC_API_KEY  →  GitHub repository secrets (for claude.yml)

Warnings requiring human review:
  [CLAUDE.md size warning if applicable]
  [STDIO MCP server warnings if applicable]
  [Missing lockfile warnings if applicable]
  [install_pkgs.sh missing CLAUDE_CODE_REMOTE gate if applicable]

Next steps:
  1. Set ANTHROPIC_API_KEY as a GitHub repository secret
  2. Set any listed env vars in the cloud environment UI at claude.ai/code
  3. Connect the Claude GitHub App (required for Auto-fix)
  4. Test a cloud session: open claude.ai/code, select this repo
```

### 5. Idempotency Rules

| Item | Detect | Action if already present |
|---|---|---|
| `.gitattributes` lines | `grep -qF` for each required line | Skip that line; append only missing ones |
| `.gitignore` lines | `grep -qF` for each pattern | Skip that pattern; append only missing ones |
| `settings.json` hooks.SessionStart | Check for `install_pkgs.sh` in existing hook commands | Skip if already wired; merge if not |
| `settings.json` permissions.allow | Read existing array | Append only entries not already present |
| `scripts/install_pkgs.sh` | `[ -f scripts/install_pkgs.sh ]` | Inspect for CLAUDE_CODE_REMOTE gate; never overwrite |
| `.github/workflows/claude.yml` | `grep -rl 'claude-code-action'` in workflows dir | Skip if any match found |
| Executable bits | `git ls-files --format='%(objectmode) %(path)'` | Fix only files with mode 100644 |

Re-running the command on a fully configured repo produces: no writes, no
warnings (other than CLAUDE.md size if applicable), and a "No changes needed"
summary. This is the idempotency invariant.

### 6. Conflict-Handling Policy

**settings.json with an existing SessionStart hook that does something else:**
Append a new entry to the `SessionStart` array rather than replacing. The array
can have multiple hooks. Do not remove or reorder existing hooks. Warn if the
existing hook uses `set -e` without the recommended workaround (MEMORY.md
anti-pattern: `set -e` in hooks that must output JSON).

**settings.json with existing permissions.allow entries:**
Preserve all existing entries. Only append the new ones. Never remove entries
the user may have added.

**scripts/install_pkgs.sh already exists with different content:**
Do not overwrite. Inspect and warn about missing CLAUDE_CODE_REMOTE gate if
absent. Suggest the user review the script and add the gate manually.

**CLAUDE.md is large:**
Warn only. Never modify. Size reduction requires human judgment about what to
keep.

**.mcp.json with STDIO servers:**
Warn with specifics (which server, which command value). Never rewrite. The
user must decide whether to migrate to HTTP transport, add the binary to the
bootstrap script, or accept the server won't work in cloud sessions.

**No `.github/workflows/` directory:**
Skip Step 7 entirely. Do not create the `.github/` directory tree. Only scaffold
`claude.yml` if GitHub Actions is already in use.

### 7. Naming and Namespace Decisions

| Decision | Choice | Rejected alternatives |
|---|---|---|
| Command name | `setup:claude-web` | `setup:web` (ambiguous — could mean web app setup), `setup:remote` (not the term Anthropic uses), `web:setup` (breaks the `setup:` namespace convention) |
| File location | `plugins/yellow-core/commands/setup/claude-web.md` | New top-level `web/` namespace (unnecessary fragmentation), separate plugin (YAGNI — yellow-core already owns setup:) |
| `setup:all` delegation name | `setup:claude-web` | — |

### 8. Integration Policy with `setup:all`

**v1: Not integrated into `setup:all`.** Rationale:

`setup:all` checks plugin-specific readiness (credentials, MCP visibility,
local tool availability). `setup:claude-web` checks *repo-scope* configuration
for cloud sessions. These are orthogonal concerns: a developer may have all
plugins configured locally but have a repo that is cloud-unready, or vice versa.

`setup:all` also runs per-user (it checks `~/.claude/settings.json` and tool
paths). `setup:claude-web` runs per-repo (it writes files to the current git
worktree). Mixing them would confuse the scope of each.

Deferred to a follow-up: adding a "Cloud readiness" section to `setup:all`'s
dashboard that reports on the current repo's cloud readiness using the same
Bash probes from Step 2 of `setup:claude-web` — without invoking the setup
command. This gives visibility without conflating the two concerns.

### 9. v1 Out-of-Scope

The following items were explicitly scoped out of v1:

- `--target <dir>` argument for targeting a repo other than the CWD
- Dry-run mode (`--dry-run` flag)
- Marker file (`.claude/.web-setup-complete` or similar)
- `claude mcp list` shell-out for user-scope MCP detection (too fragile — `claude`
  CLI not guaranteed in PATH)
- Scaffolding `.devcontainer/devcontainer.json` (research confirms: not consumed
  by web sandbox)
- Writing `AGENTS.md` or modifying `CLAUDE.md`
- Docker-in-Docker or submodule detection (empirically unverified behavior)
- Auto-migrating STDIO MCP servers to HTTP (requires user knowledge of the
  server's HTTP endpoint)
- Integration into `setup:all` dashboard
- Automated testing of the cloud session itself (out of scope for a setup
  command)
- Setting `ANTHROPIC_API_KEY` directly (cannot be done from a command; must be
  done in GitHub UI)

---

## Open Questions

These are questions to validate before or during implementation — they do not
block writing the command but affect specific behaviors:

1. **Plugin marketplace format in `.claude/settings.json`**: The research (Part
   B.5) notes that the exact key for plugin marketplace declarations in
   `.claude/settings.json` (vs. the GitHub Action `plugin_marketplaces` param)
   is unconfirmed. If `enabledPlugins` without a marketplace URL is insufficient
   to install plugins in the web sandbox, the Tier 3 plugin audit warning needs
   to be updated to also check for a marketplace URL. **Resolution:** Test a
   live cloud session with a `settings.json` that has `enabledPlugins` but no
   marketplace URL.

2. **`CLAUDE_PROJECT_DIR` vs `$PWD` in hook command path**: The canonical hook
   pattern from the research uses `"$CLAUDE_PROJECT_DIR"/scripts/install_pkgs.sh`.
   Confirm this env var is reliably set when SessionStart hooks fire in the web
   sandbox. MEMORY.md has a warning about unset `CLAUDE_PROJECT_DIR` with a
   fallback to `$PWD` (from PR #72). The generated hook should include the
   fallback advisory.

3. **SessionStart hook matcher value**: The research (Part B.2) shows
   `"matcher": "startup|resume"`. Confirm this is the correct matcher syntax
   (pipe-separated vs array vs single string). If the matcher is wrong, the
   hook silently never fires.

4. **`git update-index --chmod=+x` cross-platform behavior**: Verify this works
   correctly on WSL2 (where most users in this repo author code). This is the
   safer alternative to relying on `chmod` alone for git-tracked executable bits.

5. **`settings.json` JSON merge strategy**: The command uses Read + Edit (or
   Read + jq + Write) to merge keys into an existing `settings.json`. Confirm
   that `jq` is available in the web sandbox (research confirms yes — it is
   pre-installed). The merge logic itself runs locally (at command invocation
   time), but if the command is ever invoked from within a web session, jq
   availability matters.

6. **Tier 1 appends and CRLF**: Per MEMORY.md, files created via the Write
   tool on WSL2 get CRLF. `.gitattributes` and `.gitignore` are text files
   where CRLF could cause issues. Use `printf` via Bash for appends (not the
   Write tool) to avoid CRLF introduction on WSL2.

---

## Implementation Notes for `/workflows:plan`

When turning this into a plan:

- The command body should follow the exact step structure above.
- Each Tier 2 AskUserQuestion must use the pattern: show what would be
  written, then ask. The "Cancel/Skip" branch must have an explicit stop
  instruction (MEMORY.md anti-pattern: missing skip guards).
- The `install_pkgs.sh` template must use `printf '%s'` for any variable
  interpolation — never inline substitution in a heredoc (MEMORY.md anti-pattern:
  heredoc delimiter collision). Use `__EOF_INSTALL_PKGS__` as the delimiter.
- The settings.json merge must use `jq` with `--argjson` flags, not string
  interpolation, to avoid producing invalid JSON.
- After every Write call, the next step should `Read` the written file and verify
  key fields are present (following chatprd:setup and ci:setup precedent).
- The audit Bash block (Step 2) MUST be a single call. Do not split into
  multiple Bash calls; this avoids PATH drift and keeps the command responsive.
- `pnpm validate:agents` must pass before the PR. Key checks: `description:`
  is single-line, `allowed-tools:` (not `allowed_tools:`), no `BASH_SOURCE`,
  uses `${CLAUDE_PLUGIN_ROOT}` for any plugin-local file references, no
  CRLF line endings.
- A `pnpm changeset` is required before the PR (minor bump for yellow-core —
  additive new command).
