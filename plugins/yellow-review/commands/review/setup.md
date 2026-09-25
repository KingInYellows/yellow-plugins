---
name: review:setup
description: "Validate review command prerequisites and optional yellow-core integration. Use when first installing the plugin or when review commands fail before analysis begins."
argument-hint: ''
allowed-tools:
  - Bash
---

# Set Up yellow-review

Validate the GitHub, Graphite, yellow-core and review-ledger prerequisites
used by the review commands. This command does not write any files.

## Workflow

### Step 1: Check Review Prerequisites

Run a single Bash call:

```bash
printf '=== Prerequisites ===\n'
command -v gh >/dev/null 2>&1 && printf 'gh:            ok\n' || printf 'gh:            NOT FOUND\n'
command -v jq >/dev/null 2>&1 && printf 'jq:            ok\n' || printf 'jq:            NOT FOUND\n'
command -v gt >/dev/null 2>&1 && printf 'gt:            ok\n' || printf 'gt:            NOT FOUND\n'

printf '\n=== GitHub Auth ===\n'
if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 && printf 'gh_auth:       ok\n' || printf 'gh_auth:       NOT AUTHENTICATED\n'
else
  printf 'gh_auth:       SKIPPED\n'
fi

printf '\n=== Optional Integration ===\n'
plugin_cache="$HOME/.claude/plugins/cache"
core_installed=0
plugin_names=''
if [ -d "$plugin_cache" ]; then
  if command -v python3 >/dev/null 2>&1; then
    plugin_names=$(find "$plugin_cache" -type f -path '*/.claude-plugin/plugin.json' -print0 2>/dev/null \
      | while IFS= read -r -d '' pj; do
          python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('name',''))" "$pj" 2>/dev/null || true
        done | sed '/^$/d' | LC_ALL=C sort -u)
  elif command -v jq >/dev/null 2>&1; then
    plugin_names=$(find "$plugin_cache" -type f -path '*/.claude-plugin/plugin.json' -print0 2>/dev/null \
      | while IFS= read -r -d '' pj; do
          jq -r '.name // empty' "$pj" 2>/dev/null || true
        done | sed '/^$/d' | LC_ALL=C sort -u)
  fi
  printf '%s\n' "$plugin_names" | grep -Fxq 'yellow-core' && core_installed=1
fi
[ "$core_installed" = "1" ] && printf 'yellow_core:   installed\n' || printf 'yellow_core:   NOT INSTALLED\n'

printf '\n=== Review Ledger ===\n'
command -v flock >/dev/null 2>&1 && printf 'flock:         ok\n' || printf 'flock:         NOT FOUND\n'
command -v realpath >/dev/null 2>&1 && printf 'realpath:      ok\n' || printf 'realpath:      NOT FOUND\n'
git_ver=$(git --version 2>/dev/null | awk '{print $3}')
if printf '%s\n' "$git_ver" | awk -F. '{ exit !($1 > 2 || ($1 == 2 && $2 >= 31)) }'; then
  printf 'git>=2.31:     ok (%s)\n' "$git_ver"
else
  printf 'git>=2.31:     TOO OLD (%s)\n' "${git_ver:-none}"
fi
ledger="${CLAUDE_PLUGIN_ROOT}/lib/review-ledger.sh"
if [ -x "$ledger" ]; then
  printf 'ledger_lib:    ok\n'
  if (. "$ledger" && [ -n "$(rl_core_lib_path)" ]); then
    printf 'redaction:     ok (yellow-core compound-staging.sh)\n'
  else
    printf 'redaction:     MISSING (yellow-core lib/compound-staging.sh)\n'
  fi
else
  printf 'ledger_lib:    NOT FOUND\n'
fi
if [ -x "$ledger" ] && bash -c '. "$1" && rl_ctags_usable' _ "$ledger"; then
  printf 'ctags:         universal-ctags\n'
elif command -v ctags >/dev/null 2>&1 && ctags --version 2>/dev/null | grep -q 'Universal Ctags'; then
  if ! command -v timeout >/dev/null 2>&1; then
    printf 'ctags:         universal-ctags (unusable: timeout not found)\n'
  else
    printf 'ctags:         universal-ctags (unusable: missing end field)\n'
  fi
else
  printf 'ctags:         optional-missing\n'
fi
```

### Step 2: Interpret Results

Stop after reporting all required failures:

- `gh` missing: "GitHub CLI is required. Install it from https://cli.github.com/ and run `gh auth login`."
- `jq` missing: "jq is required for review GraphQL helpers. Install it from https://jqlang.github.io/jq/download/."
- `gt` missing: "Graphite CLI is required for review submission flows. Install it from https://graphite.dev/docs/cli."
- `gh_auth` not authenticated: "GitHub CLI is not authenticated. Run `gh auth login` and re-run `/review:setup`."
- `flock`, `realpath` missing or `git>=2.31` too old: "The review-findings
  ledger needs flock, realpath and git 2.31+. On macOS:
  `brew install flock coreutils git`." Reviews still run, but every ledger
  write fails and is reported in Coverage.
- `ledger_lib` not found: "The yellow-review install is incomplete —
  reinstall the plugin."

If `yellow_core` is not installed, warn but continue:

- "yellow-core is not installed. Base review works, but cross-plugin review
  agents degrade gracefully."

If `redaction` is missing, warn but continue:

- "yellow-core's compound-staging.sh was not found. The review ledger keeps
  working but withholds every model-authored string (titles, fixes,
  reasons) until yellow-core is installed."

If `ctags` is `optional-missing`, note it: "universal-ctags is not installed;
the ledger records code-scope findings as `unscoped` (line-keyed). Optional:
`brew install universal-ctags` or `apt install universal-ctags`."

If `ctags` is `universal-ctags (unusable: ...)`, note it: "universal-ctags
is installed but the ledger cannot use it (missing `timeout` or an `end`
field in `ctags --list-fields`); code-scope findings fall back to
`unscoped`. On macOS: `brew install coreutils` for `timeout`, or upgrade
to a Universal Ctags build that reports the `end` field."

### Step 3: Report

Show:

```text
yellow-review Setup Results
───────────────────────────
GitHub CLI:    ready
GitHub auth:   active
Graphite CLI:  ready
yellow-core:   installed / optional-missing
Ledger:        ready / degraded (<what is missing>)

Setup complete. Run `/review:pr` on a small PR to smoke-test the review path.
```
