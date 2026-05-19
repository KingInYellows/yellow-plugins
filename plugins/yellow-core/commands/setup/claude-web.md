---
name: setup:claude-web
description: "Prepare a repository for Claude Code Web: audit and scaffold .claude/settings.json, scripts/install_pkgs.sh bootstrap, .gitattributes, .gitignore, and .github/workflows/claude.yml. Use when first enabling cloud sessions, after adding MCP servers, or when cloud sessions fail to find expected tools."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Set Up Repository for Claude Code Web

Audit and scaffold the files Claude Code Web (`claude.ai/code`) needs to run
agents against this repository. Claude Code Web runs in ephemeral Ubuntu VMs
that have no access to user-scope settings (`~/.claude/`), `claude mcp add`
entries, or locally-installed plugins — everything must live in the
repository itself.

This command operates in three tiers:

- **Tier 1 — Auto-write (no prompt):** safe, additive edits to
  `.gitattributes` and `.gitignore`; executable-bit fixes on bootstrap
  scripts referenced by hooks.
- **Tier 2 — AskUserQuestion gate:** creates or merges into
  `.claude/settings.json`, `scripts/install_pkgs.sh`, and
  `.github/workflows/claude.yml`.
- **Tier 3 — Warn only:** STDIO MCP compatibility, plugin env-var
  requirements, oversized `CLAUDE.md`, missing lockfiles.

Re-running on a fully configured repository produces zero writes.

The command runs against the current git worktree. It does not accept a
`--target` argument.

## Workflow

### Step 1: Detect Repo Root

```bash
if ! command -v git >/dev/null 2>&1; then
  printf '[setup:claude-web] Error: git is not installed.\n' >&2
  exit 1
fi

REPO_TOP=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$REPO_TOP" ]; then
  printf '[setup:claude-web] Error: this command must be run from inside a git repository.\n' >&2
  exit 1
fi

GIT_DIR=$(git rev-parse --git-dir 2>/dev/null)
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null)
if [ "$GIT_DIR" != "$GIT_COMMON" ]; then
  printf '[setup:claude-web] Note: running inside a git worktree. Files will be written here, not in the main working tree.\n' >&2
fi

printf 'repo_top: %s\n' "$REPO_TOP"
```

If the script exits non-zero, stop with the printed error message. Do not
proceed.

### Step 2: Comprehensive Audit

Run a single Bash block that reads every signal Steps 3–8 need. Output
follows a `key: value` vocabulary using only these values:
`ok | missing | present | corrupt | error | yes | no | n/a | too_large`.

```bash
REPO_TOP=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$REPO_TOP" || exit 1

JQ_OK=yes
command -v jq >/dev/null 2>&1 || JQ_OK=no

printf '=== Settings ===\n'
if [ -e .claude ] && [ ! -d .claude ]; then
  printf 'claude_dir_is_file: yes\n'
else
  printf 'claude_dir_is_file: no\n'
fi

if [ -f .claude/settings.json ]; then
  printf 'settings_json: exists\n'
  if [ "$JQ_OK" = yes ] && jq empty .claude/settings.json >/dev/null 2>&1; then
    printf 'settings_json_valid: yes\n'
    printf 'settings_has_session_start: %s\n' "$(jq -r 'if (.hooks.SessionStart // [] | length) > 0 then "yes" else "no" end' .claude/settings.json 2>/dev/null || printf 'error')"
    printf 'settings_has_allow: %s\n' "$(jq -r 'if (.permissions.allow // [] | length) > 0 then "yes" else "no" end' .claude/settings.json 2>/dev/null || printf 'error')"
    printf 'settings_has_deny: %s\n' "$(jq -r 'if (.permissions.deny // [] | length) > 0 then "yes" else "no" end' .claude/settings.json 2>/dev/null || printf 'error')"
    printf 'settings_has_env: %s\n' "$(jq -r 'if (.env // {} | length) > 0 then "yes" else "no" end' .claude/settings.json 2>/dev/null || printf 'error')"
    printf 'settings_session_start_has_install_pkgs: %s\n' "$(jq -r '[.hooks.SessionStart // [] | .[].hooks // [] | .[].command] | map(select(. != null and contains("install_pkgs.sh"))) | if length > 0 then "yes" else "no" end' .claude/settings.json 2>/dev/null || printf 'error')"
  else
    printf 'settings_json_valid: no\n'
    printf 'settings_has_session_start: n/a\n'
    printf 'settings_has_allow: n/a\n'
    printf 'settings_has_deny: n/a\n'
    printf 'settings_has_env: n/a\n'
    printf 'settings_session_start_has_install_pkgs: n/a\n'
  fi
else
  printf 'settings_json: missing\n'
  printf 'settings_json_valid: n/a\n'
  printf 'settings_has_session_start: n/a\n'
  printf 'settings_has_allow: n/a\n'
  printf 'settings_has_deny: n/a\n'
  printf 'settings_has_env: n/a\n'
  printf 'settings_session_start_has_install_pkgs: n/a\n'
fi

printf '\n=== Bootstrap ===\n'
if [ -e scripts ] && [ ! -d scripts ]; then
  printf 'scripts_dir_is_file: yes\n'
else
  printf 'scripts_dir_is_file: no\n'
fi
if [ -f scripts/install_pkgs.sh ]; then
  printf 'install_pkgs_exists: yes\n'
  if grep -qE 'CLAUDE_CODE_REMOTE.*!=.*"true".*exit 0|exit 0.*CLAUDE_CODE_REMOTE.*!=.*"true"' scripts/install_pkgs.sh 2>/dev/null; then
    printf 'install_pkgs_has_remote_gate: yes\n'
  elif grep -q 'CLAUDE_CODE_REMOTE' scripts/install_pkgs.sh 2>/dev/null; then
    printf 'install_pkgs_has_remote_gate: present_unclear\n'
  else
    printf 'install_pkgs_has_remote_gate: no\n'
  fi
  if git ls-files --error-unmatch scripts/install_pkgs.sh >/dev/null 2>&1; then
    MODE=$(git ls-files --format='%(objectmode) %(path)' -- scripts/install_pkgs.sh 2>/dev/null | awk '{print $1}')
    [ "$MODE" = "100755" ] && printf 'install_pkgs_exec_bit: yes\n' || printf 'install_pkgs_exec_bit: no\n'
  else
    printf 'install_pkgs_exec_bit: n/a\n'
  fi
else
  printf 'install_pkgs_exists: no\n'
  printf 'install_pkgs_has_remote_gate: n/a\n'
  printf 'install_pkgs_exec_bit: n/a\n'
fi

printf '\n=== Lockfiles ===\n'
[ -f pnpm-lock.yaml ]    && printf 'pkg_pnpm: yes\n'    || printf 'pkg_pnpm: no\n'
[ -f yarn.lock ]         && printf 'pkg_yarn: yes\n'    || printf 'pkg_yarn: no\n'
[ -f package-lock.json ] && printf 'pkg_npm: yes\n'     || printf 'pkg_npm: no\n'
[ -f uv.lock ]           && printf 'pkg_uv: yes\n'      || printf 'pkg_uv: no\n'
[ -f requirements.txt ]  && printf 'pkg_pip: yes\n'     || printf 'pkg_pip: no\n'
[ -f Cargo.lock ]        && printf 'pkg_cargo: yes\n'   || printf 'pkg_cargo: no\n'
[ -f Gemfile.lock ]      && printf 'pkg_bundler: yes\n' || printf 'pkg_bundler: no\n'
[ -f composer.lock ]     && printf 'pkg_composer: yes\n' || printf 'pkg_composer: no\n'
[ -f go.sum ]            && printf 'pkg_go: yes\n'      || printf 'pkg_go: no\n'

printf '\n=== Git Attributes ===\n'
if [ -f .gitattributes ]; then
  SIZE=$(wc -c < .gitattributes 2>/dev/null || echo 0)
  if [ "$SIZE" -gt 1048576 ]; then
    printf 'gitattributes: exists\n'
    printf 'gitattributes_size: too_large\n'
    printf 'gitattributes_text_auto: n/a\n'
    printf 'gitattributes_sh_eol: n/a\n'
  else
    printf 'gitattributes: exists\n'
    grep -qF '* text=auto' .gitattributes 2>/dev/null && printf 'gitattributes_text_auto: present\n' || printf 'gitattributes_text_auto: missing\n'
    grep -qF '*.sh eol=lf' .gitattributes 2>/dev/null && printf 'gitattributes_sh_eol: present\n' || printf 'gitattributes_sh_eol: missing\n'
  fi
else
  printf 'gitattributes: missing\n'
  printf 'gitattributes_text_auto: n/a\n'
  printf 'gitattributes_sh_eol: n/a\n'
fi

printf '\n=== Git Ignore ===\n'
if [ -f .gitignore ]; then
  SIZE=$(wc -c < .gitignore 2>/dev/null || echo 0)
  if [ "$SIZE" -gt 1048576 ]; then
    printf 'gitignore: exists\n'
    printf 'gitignore_size: too_large\n'
  else
    printf 'gitignore: exists\n'
    for PAT in '.env' '.env.*' '.env.local' '*.pem' '*.key' '.aws/' '.ssh/' 'secrets/' 'credentials/'; do
      KEY=$(printf '%s' "$PAT" | tr -c 'a-zA-Z0-9' '_')
      grep -qF -- "$PAT" .gitignore 2>/dev/null && printf 'gitignore_%s: present\n' "$KEY" || printf 'gitignore_%s: missing\n' "$KEY"
    done
  fi
else
  printf 'gitignore: missing\n'
fi

printf '\n=== MCP ===\n'
if [ -f .mcp.json ]; then
  printf 'mcp_json: exists\n'
  if [ "$JQ_OK" = yes ] && jq empty .mcp.json >/dev/null 2>&1; then
    printf 'mcp_json_valid: yes\n'
    STDIO=$(jq -r '[.mcpServers // {} | to_entries[] | select(.value.type == "stdio") | .key] | join(" ")' .mcp.json 2>/dev/null)
    if [ -n "$STDIO" ]; then
      printf 'mcp_stdio_servers: %s\n' "$STDIO"
    else
      printf 'mcp_stdio_servers: none\n'
    fi
  else
    printf 'mcp_json_valid: no\n'
    printf 'mcp_stdio_servers: n/a\n'
  fi
else
  printf 'mcp_json: missing\n'
  printf 'mcp_json_valid: n/a\n'
  printf 'mcp_stdio_servers: n/a\n'
fi

printf '\n=== GitHub Actions ===\n'
if [ -d .github/workflows ]; then
  printf 'workflows_dir: yes\n'
  if grep -rlF 'anthropics/claude-code-action' .github/workflows/ >/dev/null 2>&1; then
    printf 'claude_action_present: yes\n'
  else
    printf 'claude_action_present: no\n'
  fi
else
  printf 'workflows_dir: no\n'
  printf 'claude_action_present: n/a\n'
fi

printf '\n=== CLAUDE.md ===\n'
if [ -f CLAUDE.md ]; then
  printf 'claude_md_lines: %s\n' "$(wc -l < CLAUDE.md)"
  printf 'claude_md_bytes: %s\n' "$(wc -c < CLAUDE.md)"
else
  printf 'claude_md_lines: 0\n'
  printf 'claude_md_bytes: 0\n'
fi
```

The audit MUST run as a single Bash call. Do NOT split into multiple Bash
blocks — each block is a fresh subprocess and variables (`REPO_TOP`,
`JQ_OK`) would not survive.

If `jq` is not installed: every settings.json / .mcp.json check returns
`n/a` and the user is warned in Step 9.

### Step 3: Display Audit Results

Parse the audit output and emit a markdown table to the user. Mark Tier 1
items with `→ will auto-fix` and Tier 2 items with `→ will prompt`. Status
vocabulary: `OK | MISSING | PARTIAL | WARN | CORRUPT | NEEDS ATTENTION`.

Example:

```text
Claude Code Web Readiness Audit
================================
  .claude/settings.json      MISSING       → will prompt (scaffold)
  scripts/install_pkgs.sh    MISSING       → will prompt (pnpm detected)
  .gitattributes             PARTIAL       → will auto-fix (append *.sh eol=lf)
  .gitignore                 PARTIAL       → will auto-fix (append 4 patterns)
  .mcp.json                  OK            no STDIO servers detected
  CLAUDE.md                  OK            150 lines
  .github/workflows/         not in use    skip claude.yml
  Lockfile                   OK            pnpm-lock.yaml present
```

### Step 4: `.gitattributes` and `.gitignore` (Tier 1 — auto-write)

Single Bash block. Append-if-missing using `grep -qF` + `printf >>`. No
AskUserQuestion. No use of the Write tool (Write may emit CRLF on WSL2;
Bash `printf` writes LF only).

```bash
REPO_TOP=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$REPO_TOP" || exit 1

_ensure_trailing_newline() {
  local f="$1"
  if [ -f "$f" ] && [ -s "$f" ]; then
    LAST=$(tail -c1 "$f" | od -An -c | tr -d ' ')
    case "$LAST" in
      '\n') : ;;
      *)    printf '\n' >> "$f" ;;
    esac
  fi
}

_append_if_missing() {
  local f="$1" line="$2"
  grep -qF -- "$line" "$f" 2>/dev/null && return 0
  _ensure_trailing_newline "$f"
  printf '%s\n' "$line" >> "$f"
  printf '[setup:claude-web] %s: appended %s\n' "$f" "$line"
}

# .gitattributes
for LINE in '* text=auto' '*.sh eol=lf'; do
  _append_if_missing .gitattributes "$LINE"
done

# .gitignore (under a single header comment if any are missing)
NEEDS_HEADER=no
for PAT in '.env' '.env.*' '.env.local' '*.pem' '*.key' '.aws/' '.ssh/' 'secrets/' 'credentials/'; do
  if ! grep -qF -- "$PAT" .gitignore 2>/dev/null; then
    NEEDS_HEADER=yes
    break
  fi
done
if [ "$NEEDS_HEADER" = yes ]; then
  _ensure_trailing_newline .gitignore
  grep -qF '# Claude Code Web — sensitive file protection' .gitignore 2>/dev/null || \
    printf '\n# Claude Code Web — sensitive file protection\n' >> .gitignore
fi
for PAT in '.env' '.env.*' '.env.local' '*.pem' '*.key' '.aws/' '.ssh/' 'secrets/' 'credentials/'; do
  _append_if_missing .gitignore "$PAT"
done
```

If `gitattributes_size: too_large` or `gitignore_size: too_large` was
reported in Step 2: skip the corresponding file entirely and warn the user
that the file exceeds 1 MiB.

### Step 5: `.claude/settings.json` (Tier 2 — AskUserQuestion gate)

Behavior depends on audit results:

**5a — `claude_dir_is_file: yes`:**
Print `[setup:claude-web] Error: .claude exists as a regular file, not a
directory. Manual repair required.` and proceed to Step 6.

**5b — `settings_json: exists` AND `settings_json_valid: no`:**
Print `[setup:claude-web] Warning: .claude/settings.json is not valid
JSON (may contain comments or syntax errors). Skipping settings merge.
Manual repair required before re-running.` Proceed to Step 6.

**5c — `settings_json: exists` AND all required keys present (allow, deny,
env, session_start_has_install_pkgs all `yes`):**
Print `[setup:claude-web] .claude/settings.json: all required keys
already present.` Proceed to Step 6.

**5d — `settings_json: missing`:**
Show the scaffold template to the user as a code block. Then ask:

```
AskUserQuestion:
  question: "Write `.claude/settings.json` with a SessionStart hook for scripts/install_pkgs.sh, default permissions.allow / .deny entries, and env.NODE_ENV?"
  options: ["Write it", "Skip"]
```

If the user picks `[Skip]`: print `[setup:claude-web] Skipping
.claude/settings.json scaffold.` and proceed to Step 6. Do NOT execute
any write commands for this step.

If the user picks `[Write it]`: run the Python atomic-write block below.

**5e — `settings_json: exists` AND some keys missing:**
Show a diff-style summary of what would be added. Then ask:

```
AskUserQuestion:
  question: "Merge missing keys into existing `.claude/settings.json` (preserve all existing entries; only append)?"
  options: ["Merge", "Skip"]
```

If `[Skip]`: print skip message and proceed to Step 6. Do NOT execute
any merge commands.

If `[Merge]`: run the Python atomic-merge block below.

#### Python atomic-write/merge block

Mirrors the canonical pattern from `plugins/yellow-core/commands/statusline/setup.md`
(read JSON → mutate in memory → write `.tmp` → validate → `os.replace`).

```bash
python3 - <<'__EOF_SETTINGS_MERGE__'
import json, os, sys

target = '.claude/settings.json'
tmp = target + '.tmp'
os.makedirs('.claude', exist_ok=True)

if os.path.isfile(target):
    try:
        with open(target) as f:
            cfg = json.load(f)
    except Exception as e:
        print(f"[setup:claude-web] Error: cannot parse {target}: {e}", file=sys.stderr)
        sys.exit(1)
else:
    cfg = {}

# permissions.allow (append-only)
default_allow = [
    "Bash(git status)",
    "Bash(git diff:*)",
    "Bash(git log:*)",
]
cfg.setdefault("permissions", {})
existing_allow = cfg["permissions"].get("allow", [])
for entry in default_allow:
    if entry not in existing_allow:
        existing_allow.append(entry)
cfg["permissions"]["allow"] = existing_allow

# permissions.deny (append-only)
default_deny = [
    "Read(**/.ssh/**)",
    "Read(**/.aws/**)",
    "Read(**/.env)",
    "Read(**/.env.*)",
]
existing_deny = cfg["permissions"].get("deny", [])
for entry in default_deny:
    if entry not in existing_deny:
        existing_deny.append(entry)
cfg["permissions"]["deny"] = existing_deny

# env (only add NODE_ENV if NO env block exists at all)
if "env" not in cfg:
    cfg["env"] = {"NODE_ENV": "test"}

# hooks.SessionStart (append-only; do not duplicate install_pkgs.sh wire-up)
cfg.setdefault("hooks", {})
session_start = cfg["hooks"].get("SessionStart", [])
already_wired = False
for entry in session_start:
    for hook in entry.get("hooks", []):
        cmd = hook.get("command", "") or ""
        if "install_pkgs.sh" in cmd:
            already_wired = True
            break
    if already_wired:
        break
if not already_wired:
    session_start.append({
        "matcher": "*",
        "hooks": [{
            "type": "command",
            "command": "\"${CLAUDE_PROJECT_DIR:-$PWD}\"/scripts/install_pkgs.sh"
        }]
    })
cfg["hooks"]["SessionStart"] = session_start

# Atomic write: tmp → validate → rename
with open(tmp, 'w') as f:
    json.dump(cfg, f, indent=2)
    f.write('\n')
with open(tmp) as f:
    json.load(f)  # raises on invalid JSON
os.replace(tmp, target)
print(f"[setup:claude-web] Wrote {target}")
__EOF_SETTINGS_MERGE__
```

#### Post-write verification (Step 5f)

If `jq` is available, run the structured check first:

```bash
if command -v jq >/dev/null 2>&1; then
  jq -e '.hooks.SessionStart | length > 0' .claude/settings.json >/dev/null && \
    jq -e '.permissions.allow | type == "array"' .claude/settings.json >/dev/null && \
    jq -e '.permissions.deny | type == "array"' .claude/settings.json >/dev/null
else
  # Fallback when jq isn't installed: verify the file is non-empty and
  # contains the expected key markers. The Python write already validated
  # JSON shape via json.load() before os.replace().
  [ -s .claude/settings.json ] && \
    grep -q '"SessionStart"' .claude/settings.json && \
    grep -q '"allow"' .claude/settings.json
fi
```

If this exits non-zero: print `[setup:claude-web] Error: settings.json
write verification failed.` and stop the command.

Then use the Read tool to read `.claude/settings.json` and confirm the
SessionStart entry's `command` field contains `install_pkgs.sh`. If it
does not: print the same error and stop.

### Step 6: `scripts/install_pkgs.sh` (Tier 2)

**6a — `scripts_dir_is_file: yes`:**
Print `[setup:claude-web] Error: scripts exists as a regular file, not a
directory. Manual repair required.` Proceed to Step 7.

**6b — `install_pkgs_exists: yes` AND `install_pkgs_has_remote_gate: yes`:**
Print `[setup:claude-web] scripts/install_pkgs.sh exists and has the
CLAUDE_CODE_REMOTE gate.` Proceed to Step 7.

**6c — `install_pkgs_exists: yes` AND `install_pkgs_has_remote_gate: no` (or `present_unclear`):**
Print:
```text
[setup:claude-web] Warning: scripts/install_pkgs.sh exists but is missing
the CLAUDE_CODE_REMOTE gate. Without it, the script runs on every local
session too.

Add this at line 2 of your script:
    if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then exit 0; fi
```
Do NOT overwrite the existing script. Proceed to Step 7.

**6d — `install_pkgs_exists: no`:**

Determine the package manager from Step 2's lockfile detection. Priority
order: `pnpm > yarn > npm > uv > pip > cargo > bundler > composer > go`.

If exactly one is detected, use it. If two or more are detected, ask:

```
AskUserQuestion:
  question: "Multiple package manager lockfiles detected: <list>. Which install command should the bootstrap script run?"
  options: [each detected manager, "Skip"]
```

If `[Skip]`: print skip message and proceed to Step 7. Do NOT write the
script.

If none detected: print `[setup:claude-web] No package manager lockfile
detected. Skipping bootstrap script.` and proceed to Step 7.

Map the selected manager to its install command:

| Lockfile           | Manager  | Install command                       |
|--------------------|----------|---------------------------------------|
| `pnpm-lock.yaml`   | pnpm     | `pnpm install --frozen-lockfile`      |
| `yarn.lock`        | yarn     | `yarn install --frozen-lockfile`      |
| `package-lock.json`| npm      | `npm ci`                              |
| `uv.lock`          | uv       | `uv sync --frozen`                    |
| `requirements.txt` | pip      | `pip install -r requirements.txt`     |
| `Cargo.lock`       | cargo    | `cargo build --frozen`                |
| `Gemfile.lock`     | bundler  | `bundle install --deployment`         |
| `composer.lock`    | composer | `composer install --no-interaction`   |
| `go.sum`           | go       | `go mod download`                     |

Show the script template that would be written. Then ask:

```
AskUserQuestion:
  question: "Write `scripts/install_pkgs.sh` (package manager: <name>)?"
  options: ["Write it", "Skip"]
```

If `[Skip]`: print skip message and proceed to Step 7. Do NOT write
the script.

If `[Write it]`: run the write block below, substituting the actual
install command for `<INSTALL_CMD>`.

```bash
mkdir -p scripts
INSTALL_CMD="<INSTALL_CMD>"   # e.g. pnpm install --frozen-lockfile
PKG_NAME="<PKG_NAME>"         # e.g. pnpm
cat > "scripts/install_pkgs.sh" <<__EOF_INSTALL_PKGS__
#!/bin/bash
# Note: -e omitted intentionally — hook must exit 0 on the gate path.
set -uo pipefail

# Gate: only run full installs in cloud sessions
if [ "\$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

# Project root with safe fallback
PROJECT_DIR="\${CLAUDE_PROJECT_DIR:-\$PWD}"
cd "\$PROJECT_DIR" || exit 1

# Detected package manager: ${PKG_NAME}
${INSTALL_CMD}

exit 0
__EOF_INSTALL_PKGS__
chmod +x scripts/install_pkgs.sh
git update-index --chmod=+x scripts/install_pkgs.sh 2>/dev/null || \
  printf '[setup:claude-web] Warning: could not stage executable bit for scripts/install_pkgs.sh (filesystem chmod succeeded; subsequent commit may not preserve +x)\n' >&2
printf '[setup:claude-web] Wrote scripts/install_pkgs.sh\n'
```

The heredoc is **unquoted** so `${INSTALL_CMD}` and `${PKG_NAME}` expand at
write time. Variables that must remain literal in the output script
(`$CLAUDE_CODE_REMOTE`, `$CLAUDE_PROJECT_DIR`, `$PWD`) are escaped with
`\$`. The closing delimiter `__EOF_INSTALL_PKGS__` follows the
`__EOF_<CONTEXT>__` convention from `plugins/yellow-composio/commands/composio/setup.md`.

**Post-write verification (6e):**

```bash
[ -f scripts/install_pkgs.sh ] && \
  grep -q 'CLAUDE_CODE_REMOTE' scripts/install_pkgs.sh && \
  grep -q 'exit 0' scripts/install_pkgs.sh
```

If this exits non-zero: print `[setup:claude-web] Error: install_pkgs.sh
write verification failed.` and stop the command. Otherwise use the Read
tool to confirm the gate line and install command are present.

### Step 7: `.github/workflows/claude.yml` (Tier 2, conditional)

**7a — `workflows_dir: no`:**
Print `[setup:claude-web] No .github/workflows/ directory found —
GitHub Actions not in use in this repo. Skipping claude.yml.` Proceed to
Step 8.

**7b — `claude_action_present: yes`:**
Print `[setup:claude-web] A workflow already uses
anthropics/claude-code-action. Skipping claude.yml.` Proceed to Step 8.

**7c — Otherwise:**
Show the workflow template to the user. Then ask:

```
AskUserQuestion:
  question: "Write `.github/workflows/claude.yml`? (Requires ANTHROPIC_API_KEY in GitHub repository secrets.)"
  options: ["Write it", "Skip"]
```

If `[Skip]`: print skip message and proceed to Step 8. Do NOT write the
workflow.

If `[Write it]`: use the Write tool to create `.github/workflows/claude.yml`
with the canonical template below, then strip any CRLF the Write tool may
have introduced:

```bash
sed -i 's/\r$//' .github/workflows/claude.yml
```

#### Workflow template

This template follows Anthropic's canonical shape for
`anthropics/claude-code-action@v1` (currently latest tag v1.0.124, August
2025). Every trigger event is gated on `@claude` substring match — there
is no unconditional PR trigger.

```yaml
# Claude Code GitHub Action — set ANTHROPIC_API_KEY in repo secrets
# before this workflow runs:
#   https://github.com/<owner>/<repo>/settings/secrets/actions
#
# Adjust `permissions` to match your security policy. The block below is
# Anthropic's recommended set for the @claude-mention workflow. Drop any
# permission you do not need.
name: Claude Code
on:
  issue_comment:
    types: [created]
  pull_request_review_comment:
    types: [created]
  issues:
    types: [opened, assigned]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  claude:
    runs-on: ubuntu-latest
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'pull_request_review_comment' && contains(github.event.comment.body, '@claude')) ||
      (github.event_name == 'issues' && contains(github.event.issue.body, '@claude'))
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Step 8: Executable Bits (Tier 1, scoped to hook-referenced scripts)

After Step 5 has finalized `.claude/settings.json`, scope the chmod fix
to ONLY scripts referenced in `hooks` commands — not all tracked `*.sh`
files in the repo.

```bash
REPO_TOP=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$REPO_TOP" || exit 1

if [ ! -f .claude/settings.json ]; then
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  printf '[setup:claude-web] Warning: jq not installed — skipping hook-script executable-bit check.\n' >&2
  exit 0
fi

# Extract all hook command paths from settings.json
HOOK_SCRIPTS=$(jq -r '
  [.hooks // {} | to_entries[].value[]? | .hooks[]? | .command]
  | map(select(. != null))
  | .[]
' .claude/settings.json 2>/dev/null)

printf '%s\n' "$HOOK_SCRIPTS" | while IFS= read -r raw_path; do
  [ -z "$raw_path" ] && continue
  # Extract a .sh path from the command string. Hook commands typically look
  # like "${CLAUDE_PROJECT_DIR:-$PWD}"/scripts/foo.sh — grep captures the
  # path tail after the variable expansion, then sed strips leading `/` or
  # `./` to produce a repo-relative path.
  rel=$(printf '%s' "$raw_path" \
    | grep -oE '[^"$ ]+\.sh' \
    | head -1 \
    | sed -E 's|^/||; s|^\./||')
  [ -z "$rel" ] && continue
  [ -f "$rel" ] || continue
  if git ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
    MODE=$(git ls-files --format='%(objectmode) %(path)' -- "$rel" 2>/dev/null | awk 'NR==1 {print $1}')
    if [ "$MODE" = "100644" ]; then
      chmod +x "$rel" 2>/dev/null || \
        printf '[setup:claude-web] Warning: chmod +x failed for %s (filesystem may not support exec bit)\n' "$rel" >&2
      git update-index --chmod=+x "$rel" 2>/dev/null || \
        printf '[setup:claude-web] Warning: could not stage executable bit for %s (commit will not preserve +x)\n' "$rel" >&2
      printf '[setup:claude-web] Fixed executable bit: %s\n' "$rel"
    fi
  fi
done
```

If no hook-referenced scripts are found, this step is a no-op.

### Step 9: Summary Output

Always emitted, regardless of what was written or skipped. Aggregate
information from Steps 2–8.

```text
═══════════════════════════════════════════════════════════
  Claude Code Web Setup — Summary
═══════════════════════════════════════════════════════════

Files written/modified:
  <list of writes from Steps 4-8, or "none — no changes needed">

🔑 REQUIRED MANUAL ACTION
   Set ANTHROPIC_API_KEY as a GitHub repository secret:
   https://github.com/<owner>/<repo>/settings/secrets/actions
   (Only required if claude.yml was written or already present.)

Env vars to set in the cloud environment UI at claude.ai/code:
  <list of plugin userConfig keys and MCP env-var placeholders, or "none">

Warnings requiring human review:
  <list, or "none">

Next steps:
  1. Set ANTHROPIC_API_KEY as a GitHub repository secret (if claude.yml is in use)
  2. Configure any env vars listed above in the cloud environment UI
  3. Install the Claude GitHub App (required for Auto-fix)
  4. Test a cloud session: open claude.ai/code and select this repo

Reference: see your repository's docs/research/ folder or
https://code.claude.com/docs/en/claude-code-on-the-web
```

Warnings to surface in the summary:

- `CLAUDE.md is N lines (>200 recommended for cloud sessions — large
  CLAUDE.md consumes context budget on every session start).`
- `.mcp.json contains STDIO server '<name>' — may not work in the web
  sandbox; consider migrating to HTTP transport.` (Distinguish `npx`-based
  STDIO servers, which often work, from custom-binary STDIO servers,
  which never will.)
- `scripts/install_pkgs.sh exists but lacks the CLAUDE_CODE_REMOTE gate.`
- `Package manager detected but no lockfile committed — cloud sessions
  cannot reproduce dependencies.`
- `.gitattributes or .gitignore exceeds 1 MiB — skipped pattern checks.`

## Error Handling

| Scenario                                       | Behavior                                         |
| ---------------------------------------------- | ------------------------------------------------ |
| `git` not installed                            | Step 1 exits with clear error                    |
| Not in a git repo                              | Step 1 exits with clear error                    |
| `.claude` exists as a regular file             | Step 5 prints error and skips to Step 6          |
| `scripts` exists as a regular file             | Step 6 prints error and skips to Step 7          |
| `.claude/settings.json` is invalid JSON        | Step 5 warns and skips merge; remaining steps continue |
| `.mcp.json` is invalid JSON                    | Audit reports `mcp_json_valid: no`; warn in Step 9 |
| `jq` not installed                             | All JSON-dependent audit checks return `n/a`; warn in Step 9 |
| User picks `[Skip]` at any Tier 2 prompt       | That step is skipped; command continues to the next step |
| Hook-referenced script is outside the worktree | Step 8 skips it silently (no `git ls-files` match) |

## Security Notes

- The audit MUST NOT echo values from `.mcp.json` or `~/.claude.json` —
  only keys, server names, and `type` fields. The `jq` filters in Step 2
  extract `mcpServers | keys[]` and `.type` only; no value fields are
  read or printed.
- All user input is enum picks from AskUserQuestion. No free-text input
  is interpolated into file writes or shell commands.
- The generated `claude.yml` header comment notes that `contents: write`
  is needed for Auto-fix and should be reviewed against the repo's
  security policy.
- The generated `install_pkgs.sh` uses install commands from a fixed
  table (Step 6d) based on detected lockfiles — no user-typed string
  becomes part of the script body.

## Idempotency Invariant

Re-running on a fully configured repo produces:

- zero file writes
- zero Tier 2 AskUserQuestion prompts
- a Step 9 summary showing `Files written/modified: none — no changes needed`
- only Tier 3 informational warnings (CLAUDE.md size, etc.) if applicable
