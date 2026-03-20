---
name: gt-setup
description: "Validate Graphite CLI prerequisites and configure settings for AI agent workflows. Use when first installing the plugin, after Graphite auth changes, or when gt commands fail."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
---

# Set Up gt-workflow

Validate that Graphite CLI is installed, authenticated, and initialized for the
current repository. Then configure Graphite CLI settings for AI agent workflows
and generate a `.graphite.yml` convention file.

## Phase 1: Validate Prerequisites

### Step 1: Check Graphite Prerequisites

Run a single Bash call:

```bash
version_gte() {
  local IFS=.
  local i a=($1) b=($2)
  for ((i=0; i<${#b[@]}; i++)); do
    local av="${a[i]:-0}" bv="${b[i]:-0}"
    if ((av > bv)); then return 0; fi
    if ((av < bv)); then return 1; fi
  done
  return 0
}

printf '=== Prerequisites ===\n'
if command -v gt >/dev/null 2>&1; then
  gt_version_full=$(gt --version 2>/dev/null)
  gt_version_exit=$?
  gt_version_raw=$(printf '%s' "$gt_version_full" | head -n1)
  if [ "$gt_version_exit" -ne 0 ]; then
    printf 'gt:            BROKEN (exited with code %s)\n' "$gt_version_exit"
    printf 'mcp_server:    SKIPPED (gt is broken)\n'
  elif [ -n "$gt_version_raw" ]; then
    printf 'gt:            ok (%s)\n' "$gt_version_raw"
    gt_ver=$(printf '%s' "$gt_version_raw" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    if [ -z "$gt_ver" ]; then
      printf 'mcp_server:    UNKNOWN (could not parse version from: %s)\n' "$gt_version_raw"
    elif version_gte "$gt_ver" "1.6.7"; then
      printf 'mcp_server:    ok (gt >= 1.6.7)\n'
    else
      printf 'mcp_server:    UPGRADE NEEDED (current: %s, need 1.6.7+)\n' "$gt_ver"
    fi
  else
    printf 'gt:            ok (version unknown)\n'
    printf 'mcp_server:    UNKNOWN (gt --version returned no output)\n'
  fi
else
  printf 'gt:            NOT FOUND\n'
  printf 'mcp_server:    SKIPPED (gt not found)\n'
fi
command -v jq >/dev/null 2>&1 && printf 'jq:            ok\n' || printf 'jq:            NOT FOUND\n'
command -v yq >/dev/null 2>&1 && printf 'yq:            ok\n' || printf 'yq:            NOT FOUND (optional — needed by consumer commands to read .graphite.yml)\n'

printf '\n=== Repository ===\n'
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$repo_top" ] && printf 'git_repo:       ok\n' || printf 'git_repo:       NOT A GIT REPOSITORY\n'
graphite_repo_config=$(git rev-parse --git-path .graphite_repo_config 2>/dev/null || true)
[ -n "$graphite_repo_config" ] && [ -f "$graphite_repo_config" ] && printf 'repo_config:    present (%s)\n' "$graphite_repo_config" || printf 'repo_config:    missing\n'

if command -v gt >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  trunk=$(gt trunk 2>/dev/null || true)
  [ -n "$trunk" ] && printf 'gt_trunk:       %s\n' "$trunk" || printf 'gt_trunk:       UNAVAILABLE\n'
else
  printf 'gt_trunk:       SKIPPED\n'
fi

printf '\n=== Graphite Auth ===\n'
auth_ok=0
for path in \
  "$HOME/.graphite_user_config" \
  "${XDG_CONFIG_HOME:-$HOME/.config}/graphite/user_config" \
  "$HOME/.config/graphite/user_config"; do
  if [ -f "$path" ]; then
    auth_ok=1
    printf 'auth_config:    present (%s)\n' "$path"
    break
  fi
done
[ "$auth_ok" -eq 1 ] || printf 'auth_config:    missing\n'

printf '\n=== Convention Files ===\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.graphite.yml" ] && printf 'graphite_yml:   present\n' || printf 'graphite_yml:   not found\n'
[ -n "$repo_top" ] && [ -f "$repo_top/.github/pull_request_template.md" ] && printf 'pr_template:    present\n' || printf 'pr_template:    not found\n'
```

### Step 2: Interpret Results

**Failures (hard stop)** — stop after reporting all that apply:

- `gt` missing: "Graphite CLI is required. Install it from https://graphite.dev/docs/cli and re-run `/gt-setup`."
- `jq` missing: "jq is required for gt-workflow hooks. Install it from https://jqlang.github.io/jq/download/."
- `git_repo` not ok: "gt-workflow must be run inside a git repository."
- `auth_config` missing: "Graphite auth was not detected. Run `gt auth` or sign in through the Graphite CLI, then re-run `/gt-setup`."
- `repo_config` missing OR `gt_trunk` unavailable: "This repository is not initialized for Graphite. Run `gt init`, confirm `gt trunk` works, then re-run `/gt-setup`."

If any hard-stop failures exist, stop here. Do not proceed to Phase 2.

**Warnings (do not block setup — CLI commands still work):**

- `mcp_server` UPGRADE NEEDED: "Graphite MCP server requires gt v1.6.7+. The `gt mcp` stdio server registered in plugin.json will fail to start and Graphite MCP tools will be unavailable until you upgrade. Run `npm i -g @withgraphite/graphite-cli@latest` to upgrade, then re-run `/gt-setup`. All CLI-based commands (`/smart-submit`, `/gt-sync`, etc.) continue to work without MCP."
- `mcp_server` SKIPPED or UNKNOWN: note accordingly.
- `yq` NOT FOUND: "yq (kislyuk variant) is optional but recommended. Without it, consumer commands (`/smart-submit`, `/gt-stack-plan`, `/gt-amend`) will use hardcoded defaults instead of `.graphite.yml` settings. Install with: `pip install yq`"

### Step 3: Validation Report

If all checks pass, show:

```text
gt-workflow Validation
──────────────────────
Graphite CLI:  ready
jq:            ready
yq:            ready (or: not found — optional)
Auth:          detected
Repository:    initialized (trunk: <branch>)
MCP Server:    available (or: unavailable — gt < 1.6.7)

Proceeding to AI agent configuration...
```

## Phase 2: Configure Graphite Settings for AI Agents

### Step 4: Show Planned Changes

Before applying any settings, read current values and show what will change.
Run a single Bash call:

```bash
printf '=== Current Graphite User Settings ===\n'
gt user branch-prefix 2>/dev/null || printf 'branch-prefix: (not set / command unavailable)\n'
gt user branch-date 2>/dev/null || printf 'branch-date: (command unavailable)\n'
gt user restack-date 2>/dev/null || printf 'restack-date: (command unavailable)\n'
gt user submit-body 2>/dev/null || printf 'submit-body: (command unavailable)\n'
gt user pager 2>/dev/null || printf 'pager: (command unavailable)\n'
```

Present a summary table showing current vs recommended AI-agent values for each
setting. Then proceed to the interactive prompts below.

### Step 5: Branch Prefix Prompt

Use `AskUserQuestion` to ask: "What branch prefix should AI agents use?"

Options:
- `"agent/" (Recommended)` — flat namespace for agent-created branches
- `"Skip"` — keep the current branch-prefix setting unchanged

The "Other" button allows free-text input for a custom prefix.

**If the user provides a custom prefix via "Other", validate it:**
- Must start with a lowercase letter or digit (`[a-z0-9]`)
- Allowed subsequent characters: lowercase letters, digits, `/`, `_`, `-` only
- Reject if it contains `..`, `~`, spaces, or any character outside `[a-z0-9/_-]`
- Normalize: append trailing `/` if missing
- Max length: 20 characters (checked **after** normalization, so the effective
  input limit is 19 characters when a trailing `/` is appended)
- If validation fails, explain the constraint and re-prompt with AskUserQuestion

Store the chosen prefix (or empty string if skipped) for use in Step 7 and
Phase 3.

### Step 6: Pager Prompt

Use `AskUserQuestion` to ask: "Disable the Graphite CLI pager? AI agents hang when pager is enabled."

Options:
- `"Disable pager (Recommended for AI agents)"` — will run `gt user pager --disable`
- `"Keep current pager setting"` — no change

If user chooses "Keep", note this in the summary. If user chooses "Disable",
include reversal instructions in the final report: "To re-enable: `gt user pager --enable`"

### Step 7: Apply Settings

Apply settings via `gt user` commands. Run each in a separate Bash call to
isolate failures. Track the result of each command.

**Settings to apply (in this order):**

1. `gt user branch-date --disable` (if not already disabled)
2. `gt user restack-date --use-author-date` (if not already set)
3. `gt user submit-body --include-commit-messages` (if not already set)
4. Branch prefix (if user provided one in Step 5): run
   Substitute the validated prefix as a literal value in single quotes, e.g.,
   `gt user branch-prefix --set 'agent/'` — never use shell variable
   interpolation for user-supplied text
5. `gt user pager --disable` (only if user chose to disable in Step 6)

**Failure handling:** If any command fails:
- Record the error output
- Continue applying remaining settings (do not stop on first failure)
- After all commands, show a summary with status for each:
  - "Applied" — command succeeded
  - "Already set" — current value matches target, no change needed
  - "Failed" — command failed (show error)
  - "Skipped" — user chose not to change this setting

If any commands failed, note the failures in the summary and proceed to
Phase 3. The user can re-run `/gt-setup` to retry.

### Step 8: Settings Summary

Show the final state of all 5 settings:

```text
Graphite Settings Configuration
────────────────────────────────
branch-date:     disabled (Applied)
restack-date:    use-author-date (Applied)
submit-body:     include-commit-messages (Applied)
branch-prefix:   agent/ (Applied)
pager:           disabled (Applied) — to re-enable: gt user pager --enable
```

## Phase 3: Generate Convention File

### Step 9: Check for Existing .graphite.yml

Determine the repo root and check for an existing convention file:

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
[ -f "$repo_top/.graphite.yml" ] && printf 'EXISTS\n' || printf 'NOT_FOUND\n'
```

**If the file exists**, read it and show the current contents. Then use
`AskUserQuestion`:
- `"Update with new values"` — overwrite with wizard-generated values
- `"Skip"` — keep the existing file unchanged

**If the file exists but is malformed YAML** (read fails or structure is
unexpected), warn the user and use `AskUserQuestion`:
- `"Overwrite with valid configuration"` — replace entirely
- `"Skip"` — keep the broken file as-is

**If the file does not exist**, proceed to Step 10.

If the user chose "Skip", jump to Step 11.

### Step 10: Generate .graphite.yml

Build the convention file content using values from Phase 2 (branch prefix from
Step 5) and sensible defaults. Use the Write tool to create the file at
`<repo_root>/.graphite.yml`.

The file content:

```yaml
# gt-workflow convention file — read by smart-submit, gt-stack-plan, gt-amend, gt-setup
# This is NOT a Graphite CLI feature. It is a gt-workflow plugin convention.
# Docs: https://github.com/KingInYellows/yellow-plugins/tree/main/plugins/gt-workflow

submit:
  draft: false
  merge_when_ready: false
  restack_before: true

audit:
  agents: 3
  skip_on_draft: false

branch:
  prefix: "<prefix-from-step-5-or-empty>"

pr_template:
  create: true
```

Substitute the actual branch prefix chosen in Step 5. If the user skipped the
prefix, use an empty string: `prefix: ""`.

After writing, fix CRLF line endings (WSL2 safety):

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
sed -i 's/\r$//' "$repo_top/.graphite.yml" 2>/dev/null || \
  sed -i '' 's/\r$//' "$repo_top/.graphite.yml" 2>/dev/null || \
  printf '[gt-workflow] Warning: could not strip CRLF from .graphite.yml\n' >&2
```

### Step 11: PR Template

First, if `.graphite.yml` was loaded in Step 9 and `pr_template.create` is
`false`, skip this step entirely and note "PR template: skipped
(pr_template.create is false in .graphite.yml)" in the final report.

Otherwise, check for an existing PR template:

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
[ -f "$repo_top/.github/pull_request_template.md" ] && printf 'EXISTS\n' || printf 'NOT_FOUND\n'
```

**If the template exists**, use `AskUserQuestion`:
- `"View current template"` — show contents, then re-prompt with Regenerate/Skip
- `"Regenerate"` — overwrite with the agent-optimized template
- `"Skip"` — keep existing

**If the template does not exist**, create `.github/` directory if needed and
write the template using the Write tool:

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
mkdir -p "$repo_top/.github"
```

Template content:

```markdown
## Summary

<!-- 2-3 bullet points of what this PR does -->

## Stack context

<!-- What branch is below this one and why (critical for stack reviewers) -->

## Test plan

<!-- What was verified before submit -->

## Notes for reviewers

<!-- Anything the author wants to call attention to -->
```

After writing, fix CRLF:

```bash
repo_top=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
sed -i 's/\r$//' "$repo_top/.github/pull_request_template.md" 2>/dev/null || \
  sed -i '' 's/\r$//' "$repo_top/.github/pull_request_template.md" 2>/dev/null || \
  printf '[gt-workflow] Warning: could not strip CRLF from PR template\n' >&2
```

### Step 12: Final Report

Show the complete setup summary:

```text
gt-workflow Setup Complete
──────────────────────────
Phase 1: Validation         PASSED
Phase 2: Graphite Settings  5/5 configured
Phase 3: Convention File    .graphite.yml created
         PR Template        .github/pull_request_template.md created

Consumer commands (/smart-submit, /gt-stack-plan, /gt-amend) will read
.graphite.yml for repo-level behavior overrides.

Next steps:
  - Review and commit .graphite.yml and .github/pull_request_template.md
  - Run /smart-submit or /gt-sync to verify your workflow
```

Adjust the summary to reflect actual outcomes (skipped items, partial
configuration, existing files kept, etc.).
