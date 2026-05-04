---
name: council:setup
description: "Detect Gemini and OpenCode CLIs, verify their versions, and report yellow-codex availability for the Codex leg of the council. Run after first install or when /council fails."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Set Up yellow-council

Validate prerequisites, detect external CLIs (Gemini, OpenCode), verify
versions, and report on yellow-codex availability for the Codex leg of the
council. yellow-council does not bundle any CLIs; this command verifies the
user-installed binaries are present and at compatible versions.

## Workflow

### Step 1: Verify required system tools

```bash
for tool in bash timeout jq mktemp awk sed grep; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '[yellow-council] Error: required system tool "%s" not found\n' "$tool" >&2
    exit 1
  fi
done
printf '[yellow-council] system tools: ok (bash, timeout, jq, mktemp, awk, sed, grep)\n'

# Bash version check (need 4.3+ for wait "$pid" per-process exit codes)
BASH_VERSION_OK="${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"
case "$BASH_VERSION_OK" in
  4.[3-9]*|4.[1-9][0-9]*|[5-9].*|[1-9][0-9].*)
    printf '[yellow-council] bash: ok (%s)\n' "$BASH_VERSION_OK" ;;
  *)
    printf '[yellow-council] Error: bash 4.3+ required, found %s\n' "$BASH_VERSION_OK" >&2
    exit 1 ;;
esac
```

### Step 2: Detect Gemini CLI

```bash
if command -v gemini >/dev/null 2>&1; then
  GEMINI_VERSION=$(gemini --version 2>/dev/null | head -1)
  printf '[yellow-council] gemini: ok (%s)\n' "$GEMINI_VERSION"
  case "$GEMINI_VERSION" in
    0.40.*|0.4[1-9].*|0.[5-9][0-9].*|[1-9].*)
      printf '[yellow-council] gemini version: compatible (>=0.40)\n' ;;
    *)
      printf '[yellow-council] gemini version: WARNING — %s may be too old. Recommend v0.40+ for council use.\n' "$GEMINI_VERSION" ;;
  esac
else
  printf '[yellow-council] gemini: NOT INSTALLED\n'
fi
```

If gemini is not installed, ask via AskUserQuestion:

> "Gemini CLI not found. Council reviews require gemini for the Gemini leg. Install now?"
>
> Options: "Yes, install via npm" / "No, I'll install manually" / "Skip — council will run without Gemini"

If user chooses **Yes, install via npm**:

```bash
npm install -g @google/gemini-cli@latest
```

Verify:

```bash
gemini --version 2>&1 | head -1
```

If user chooses **No, I'll install manually**: print install instructions and exit:

```text
[yellow-council] To install Gemini CLI manually:
  npm install -g @google/gemini-cli            # via npm
  brew install gemini-cli                      # macOS/Linux Homebrew
  See: https://google-gemini.github.io/gemini-cli/
```

### Step 3: Detect OpenCode CLI

```bash
if command -v opencode >/dev/null 2>&1; then
  OPENCODE_VERSION=$(opencode --version 2>/dev/null | head -1)
  printf '[yellow-council] opencode: ok (%s)\n' "$OPENCODE_VERSION"
  case "$OPENCODE_VERSION" in
    1.1[4-9].*|1.[2-9][0-9].*|[2-9].*|[1-9][0-9].*)
      printf '[yellow-council] opencode version: compatible (>=1.14)\n' ;;
    *)
      printf '[yellow-council] opencode version: WARNING — %s may be too old. Recommend v1.14+ for council use.\n' "$OPENCODE_VERSION" ;;
  esac
else
  printf '[yellow-council] opencode: NOT INSTALLED\n'
fi
```

If opencode is not installed, ask via AskUserQuestion:

> "OpenCode CLI not found. Council reviews require opencode for the OpenCode leg. Install now?"
>
> Options: "Yes, install via curl" / "No, I'll install manually" / "Skip — council will run without OpenCode"

If user chooses **Yes, install via curl**:

```bash
curl -fsSL https://opencode.ai/install | bash
```

Then prompt the user to source their shell profile or open a new terminal so the binary is on PATH.

### Step 4: Report yellow-codex availability

yellow-codex is an optional cross-plugin dependency. yellow-council reuses its
`codex-reviewer` agent when present; otherwise the Codex leg is soft-skipped.

```bash
if [ -d "${HOME}/.claude/plugins/cache/yellow-codex" ] || [ -d "$(git rev-parse --show-toplevel 2>/dev/null)/plugins/yellow-codex" ]; then
  printf '[yellow-council] yellow-codex: ok (Codex leg available via Task spawn)\n'
else
  printf '[yellow-council] yellow-codex: NOT INSTALLED — Codex leg will be skipped.\n'
  printf '[yellow-council]   Install: /plugin install yellow-codex@yellow-plugins\n'
fi
```

### Step 5: Final readiness summary

Print a one-line summary:

```bash
printf '\n[yellow-council] Setup summary:\n'
printf '  Required: bash 4.3+, timeout, jq — verified\n'
printf '  Reviewers: %d of 3 available (Gemini=%s, OpenCode=%s, Codex=%s)\n' \
  "$READY_COUNT" "$GEMINI_STATUS" "$OPENCODE_STATUS" "$CODEX_STATUS"
if [ "$READY_COUNT" -eq 0 ]; then
  printf '  Status: NOT READY — install at least one reviewer CLI before invoking /council\n'
elif [ "$READY_COUNT" -lt 3 ]; then
  printf '  Status: PARTIAL — /council will run with %d reviewer(s); install missing CLIs for full council\n' "$READY_COUNT"
else
  printf '  Status: READY — /council can run with all three reviewers\n'
fi
```

## Notes

- `council:setup` does NOT verify CLI authentication (Gemini OAuth, OpenAI API key, OpenCode provider). Auth verification is the user's responsibility — first invocation of each CLI will prompt for auth if needed.
- The `--variant` and `--approval-mode` flags used by reviewers are validated at invocation time, not at setup. If a flag is removed in a future CLI version, the corresponding reviewer will fail at runtime with a clear error.
- This setup is idempotent — running it repeatedly is safe.
