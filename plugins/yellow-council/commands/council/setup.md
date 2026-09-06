---
name: council:setup
description: "Detect Antigravity (agy) and OpenCode CLIs, verify their versions, and report yellow-codex availability for the Codex leg of the council. Run after first install or when /council fails."
argument-hint: ''
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Set Up yellow-council

Validate prerequisites, detect external CLIs (Antigravity `agy` for the
Gemini slot, OpenCode), verify versions, and report on yellow-codex
availability for the Codex leg of the council. yellow-council does not
bundle any CLIs; this command verifies the user-installed binaries are
present and at compatible versions.

## Workflow

### Step 1: Verify required system tools

```bash
for tool in bash timeout jq mktemp awk sed grep find; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '[yellow-council] Error: required system tool "%s" not found\n' "$tool" >&2
    exit 1
  fi
done
printf '[yellow-council] system tools: ok (bash, timeout, jq, mktemp, awk, sed, grep, find)\n'

# Bash version check (need 4.3+ for ${BASH_VERSINFO[N]} array indexing, associative arrays, and ${var^} capitalization used in council.md)
BASH_VER="${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"
case "$BASH_VER" in
  4.[3-9]*|4.[1-9][0-9]*|[5-9].*|[1-9][0-9].*)
    printf '[yellow-council] bash: ok (%s)\n' "$BASH_VER" ;;
  *)
    printf '[yellow-council] Error: bash 4.3+ required, found %s\n' "$BASH_VER" >&2
    exit 1 ;;
esac
```

### Step 2: Detect Antigravity CLI (`agy`, Gemini slot)

The legacy `gemini` CLI stopped serving consumer-subscription requests on
2026-06-18 — a present `gemini` binary is not a working reviewer. The
council's Google-lineage slot uses the Antigravity CLI (`agy`).

```bash
if command -v agy >/dev/null 2>&1; then
  # Extract bare semver to keep the case match version-format-agnostic
  # (agy 1.0.2 prints a bare version; tolerate prefixed formats anyway).
  AGY_RAW=$(agy --version 2>&1 | head -1)
  AGY_VERSION=$(printf '%s' "$AGY_RAW" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  printf '[yellow-council] agy: ok (%s)\n' "${AGY_VERSION:-$AGY_RAW}"
  case "$AGY_VERSION" in
    [1-9].*|[1-9][0-9].*)
      printf '[yellow-council] agy version: compatible (>=1.0)\n' ;;
    *)
      printf '[yellow-council] agy version: WARNING — %s may be too old. Recommend v1.0+ for council use.\n' "${AGY_VERSION:-$AGY_RAW}" ;;
  esac
  if command -v gemini >/dev/null 2>&1; then
    printf '[yellow-council] note: legacy gemini binary also present — it is NOT used (consumer service ended 2026-06-18)\n'
  fi
else
  printf '[yellow-council] agy: NOT INSTALLED\n'
fi
```

If agy is not installed, ask via AskUserQuestion:

> "Antigravity CLI (agy) not found. Council reviews require agy for the Gemini slot. Show install guidance?"
>
> Options: "Show install instructions" / "Skip — council will run without the Gemini slot"

If user chooses **Show install instructions**, print and exit:

```text
[yellow-council] To install the Antigravity CLI:
  See: https://antigravity.google/docs/cli (official install + migration guide)
  After installing, run `agy` once interactively — first-run onboarding
  migrates existing Gemini OAuth session tokens into the OS keyring.
  Existing Gemini CLI extensions: agy plugin import gemini
```

### Step 3: Detect OpenCode CLI

```bash
if command -v opencode >/dev/null 2>&1; then
  # Same prefix/stderr robustness as gemini — extract bare semver before case match.
  OPENCODE_RAW=$(opencode --version 2>&1 | head -1)
  OPENCODE_VERSION=$(printf '%s' "$OPENCODE_RAW" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  printf '[yellow-council] opencode: ok (%s)\n' "${OPENCODE_VERSION:-$OPENCODE_RAW}"
  case "$OPENCODE_VERSION" in
    1.1[4-9].*|1.[2-9][0-9].*|[2-9].*|[1-9][0-9].*)
      printf '[yellow-council] opencode version: compatible (>=1.14)\n' ;;
    *)
      printf '[yellow-council] opencode version: WARNING — %s may be too old. Recommend v1.14+ for council use.\n' "${OPENCODE_VERSION:-$OPENCODE_RAW}" ;;
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
# Download to a temp file so the user can inspect before execution
TMP_INSTALLER="$(mktemp)"
trap 'rm -f "$TMP_INSTALLER"' EXIT
curl -fsSL https://opencode.ai/install -o "$TMP_INSTALLER"
printf '[yellow-council] Installer downloaded to %s — inspect with: bat %s\n' "$TMP_INSTALLER" "$TMP_INSTALLER"
bash "$TMP_INSTALLER"
```

Then prompt the user to source their shell profile or open a new terminal so the binary is on PATH.

### Step 4: Report yellow-codex availability

yellow-codex is an optional cross-plugin dependency. yellow-council reuses its
`codex-reviewer` agent when present; otherwise the Codex leg is soft-skipped.

```bash
if [ -d "${HOME}/.claude/plugins/cache/yellow-codex" ]; then
  printf '[yellow-council] yellow-codex: ok (Codex leg available via the Agent tool spawn)\n'
else
  printf '[yellow-council] yellow-codex: NOT INSTALLED — Codex leg will be skipped.\n'
  printf '[yellow-council]   Install: /plugin install yellow-codex@yellow-plugins\n'
fi
```

### Step 5: Final readiness summary

Print a one-line summary:

```bash
# Re-detect each CLI inline — each Bash block is a fresh subprocess so
# variables from Steps 2-4 do not survive here.
#
# The council has four slots. claude-reviewer is in-process — no binary, no
# subprocess, nothing to detect — so it is always available and seeds the
# count at 1. Only the three CLI slots can be missing.
READY_COUNT=1

if command -v agy >/dev/null 2>&1; then
  GEMINI_STATUS="installed"
  READY_COUNT=$((READY_COUNT + 1))
else
  GEMINI_STATUS="missing"
fi

if command -v opencode >/dev/null 2>&1; then
  OPENCODE_STATUS="installed"
  READY_COUNT=$((READY_COUNT + 1))
else
  OPENCODE_STATUS="missing"
fi

if [ -d "${HOME}/.claude/plugins/cache/yellow-codex" ]; then
  CODEX_STATUS="installed"
  READY_COUNT=$((READY_COUNT + 1))
else
  CODEX_STATUS="missing"
fi

printf '\n[yellow-council] Setup summary:\n'
printf '  Required: bash 4.3+, timeout, jq — verified\n'
printf '  Reviewers: %d of 4 available (Claude=in-process (always available), Gemini[agy]=%s, OpenCode=%s, Codex=%s)\n' \
  "$READY_COUNT" "$GEMINI_STATUS" "$OPENCODE_STATUS" "$CODEX_STATUS"
if [ "$READY_COUNT" -eq 1 ]; then
  printf '  Status: MINIMAL — only the in-process Claude reviewer is available, so /council has no cross-lineage independence; install at least one reviewer CLI\n'
elif [ "$READY_COUNT" -lt 4 ]; then
  printf '  Status: PARTIAL — /council will run with %d reviewer(s); install missing CLIs for full council\n' "$READY_COUNT"
else
  printf '  Status: READY — /council can run with all four reviewers\n'
fi
```

## Notes

- `council:setup` does NOT verify CLI authentication (agy keyring session tokens, OpenAI API key, OpenCode provider). Auth verification is the user's responsibility — first invocation of each CLI will prompt for auth if needed; for agy, run it once interactively so first-run onboarding migrates existing Gemini OAuth tokens.
- The `--variant` (OpenCode) and `--sandbox`/`--print-timeout` (agy) flags used by reviewers are validated at invocation time, not at setup. If a flag is removed in a future CLI version, the corresponding reviewer will fail at runtime with a clear error.
- This setup is idempotent — running it repeatedly is safe.
