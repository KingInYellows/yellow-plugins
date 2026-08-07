---
title: "Bash Block Subshell Isolation in Command Files"
category: code-quality
track: knowledge
problem: "Shell functions and variables defined in one bash block are invisible to subsequent bash blocks in Claude Code command .md files — produces silent fail-open bugs"
tags:
  - bash
  - subshell
  - command-authoring
  - plugin-authoring
  - silent-failure
  - shell-functions
date: "2026-04-28"
pr: "#259"
components:
  - plugins/yellow-semgrep/commands/semgrep/setup.md
  - plugins/yellow-research/commands/research/setup.md
  - plugins/yellow-devin/commands/devin/setup.md
  - plugins/yellow-core/commands/setup/all.md
  - plugins/yellow-codex/commands/codex/rescue.md
---

# Bash Block Subshell Isolation in Command Files

## Problem

In Claude Code command `.md` files, each fenced bash block is executed as a
fresh subprocess. This is already documented for variables (PR #74, section 15
of `claude-code-command-authoring-anti-patterns.md`). PR #259 revealed a
second, distinct failure mode that the PR #74 entry missed: **shell functions
defined in one bash block are equally invisible to subsequent bash blocks.**

This produced three P1 bugs in the same PR:

1. `has_userconfig()` was defined and called within setup preamble blocks, then
   called again in later workflow steps — where it was undefined. Every call
   silently fell through to `command not found` (exit code 127); any non-zero
   exit causes the surrounding `if` to take the `else` branch, so the call site
   read it as "key not present."

2. `SKIP_CURL_PROBE` was set in one block and read in the next:

   ```bash
   # Block 1
   SKIP_CURL_PROBE=1
   ```

   ```bash
   # Block 2 — fresh subprocess; SKIP_CURL_PROBE is always unset here
   if [ "$SKIP_CURL_PROBE" = "1" ]; then
     ...
   fi
   ```

3. Asymmetric defaults compounded the invisible scope: `[ "$X" = 0 ]` is a
   fail-open guard (false when `$X` is unset, so the body runs on every
   subshell). Meanwhile `${X:-0}` as a boolean-flag default looks defensive but
   is also fail-open (defaults to 0 = disabled). Both patterns produce the same
   surface behavior — the step always executes — but they fail silently in
   opposite directions depending on the intended semantics.

## Root Cause

Claude Code command files are LLM-directed workflows. When the LLM executes a
bash code block via the Bash tool, it runs in a new subprocess. That subprocess
inherits the baseline environment (e.g., `CLAUDE_*` variables, `PATH`, and the
user's shell environment), but any shell state set inside a prior bash block —
variables, functions, aliases, exports defined by that block — does not survive
into the next invocation.

This is intuitive for variables (`$VAR`) but easy to miss for functions:
authors naturally write helper functions once at the top of a long command file,
expecting them to be available throughout the workflow. In an actual shell
script that assumption holds; in a command `.md` file it does not.

The failure is always silent: `command not found` in a subshell does not surface
as a visible error unless the surrounding code explicitly checks the exit code.
An `if has_userconfig ...; then` block where `has_userconfig` is undefined just
evaluates the `else` branch every time.

## Fix

### For functions: re-define inline

Re-define any helper function inside every bash block that calls it. This is
verbose but the only safe option:

```bash
# Every block that calls has_userconfig must define it first
# Pseudocode pattern — the jq path and config file below are illustrative.
# Adapt the path and key to match your runtime config storage layout;
# Claude Code's project settings.json uses extraKnownMarketplaces/enabledPlugins,
# not a .plugins[].userConfig path.
has_userconfig() {
  local plugin="$1" key="$2"
  jq -e --arg p "$plugin" --arg k "$key" \
    '.plugins[$p].userConfig[$k] // empty' \
    "${CLAUDE_PROJECT_DIR:-$PWD}/.claude/settings.json" >/dev/null 2>&1
}

if has_userconfig yellow-devin devin_api_key; then
  TOKEN_SRC=userconfig
fi
```

Alternatively, move the function to a sourced library file and source it at the
top of each block:

```bash
# shellcheck source=/dev/null
. "${CLAUDE_PLUGIN_ROOT}/lib/userconfig.sh"
```

### For variables: hoist or re-derive at the point of use

Variables that feed into a later block must be defined in that block. Never
rely on a value set in a previous Bash tool call. Two patterns apply depending
on the variable type:

**Constants and settings-derived values** — define (or re-derive) the variable
at the top of every block that uses it:

```bash
# Block 2 — define SEMGREP_API inline; do NOT rely on any value set in a
# previous Bash tool call.
SEMGREP_API="https://semgrep.dev/api/v1"
response=$(curl -s -H "Authorization: Bearer $SEMGREP_APP_TOKEN" \
  "${SEMGREP_API}/deployments")
```

This is the structural pattern PR #259 applied to yellow-semgrep/setup.md:
`SEMGREP_API` was hoisted out of the skip-detection block and re-stated in
each block where it is used.

**Runtime-detection flags** like `SKIP_CURL_PROBE` (a Block 1 decision, not a
constant) require a different structural fix: hoist the dependent step *into*
Block 1 with the flag, or re-run the detection logic at the top of Block 2.
Never assume a flag set by a prior block survives.

### For boolean flags: pick defaults that match the intended posture

`${FLAG:-0}` looks defensive but defaults to 0 (disabled = skip). Authors
sometimes label this "fail-closed" — but the standard security-engineering
meaning of *fail-closed* is "deny by default," which is only correct here if
the unset state should disable the flagged step. For a security probe whose
absence would silently reduce coverage, the safer default is the opposite —
the probe should run unless explicitly suppressed:

```bash
# Default-enabled: probe runs unless explicitly disabled (1=run, 0=skip).
# Skipping the probe is the privileged action; an unset flag means run.
RUN_CURL_PROBE="${RUN_CURL_PROBE:-1}"
if [ "$RUN_CURL_PROBE" = "1" ]; then
  ...
fi
```

The principle is independent of the "fail-closed / fail-open" labels: pick
the default such that an unset flag produces the safer outcome for the
specific step. Destructive actions default to skip (`:-0`); detection /
probe / coverage actions default to run (`:-1`). Document the semantics
inline (`# 1=run, 0=skip`) so reviewers can audit each default at a glance.

## Detection

When reviewing a command `.md` file, run:

```bash
# Find all function definitions
rg -g 'plugins/*/commands/**/*.md' '^\s*\w+\(\)\s*\{'

# Find all calls to those functions and check which bash blocks they appear in
# (manual: confirm each call site re-defines the function in that block)
```

Checklist question: "Is every function called in a bash block also defined in
that same bash block (or sourced from a file)?"

## Prevention

Add to command file review checklist:

- [ ] Every helper function called in a bash block is defined in that same block
      or sourced at the top of that block — never assumed from a prior block
- [ ] Boolean flag defaults match the intended posture: destructive actions
      default to skip (`:-0`), security probes / coverage steps default to run (`:-1`)
- [ ] `has_userconfig` calls use keys declared in `plugin.json.userConfig`
      (undeclared keys will never be present in settings — dead code)

## Related Documentation

- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` — Section 15
  covers the variable-survival angle of this same root cause (PR #74)
- MEMORY.md: "**$VAR in bash code blocks (from PR #74)**" entry in Command File Anti-Patterns

---

## Update — 2026-05-04

### Status / Summary Blocks Are the Most Common Site of Cross-Block Variable Loss (PRs #328–#330)

Yellow-council's `setup.md` (Step 5 summary block) referenced
`$READY_COUNT`, `$GEMINI_STATUS`, `$OPENCODE_STATUS`, and `$CODEX_STATUS` —
all of which were meant to be assigned in Steps 2–4. Because each step runs
as a separate Bash tool call (a fresh subprocess), all four variables are
unset in Step 5. The summary block silently printed "0 of 3 reviewers ready /
NOT READY" regardless of actual install state.

Five reviewers flagged this in the same wave. It is the single most common
concretization of the cross-block isolation bug: **setup/install command files
almost always have a final summary step that consolidates status across prior
steps, and that summary step always runs in a fresh subprocess.**

#### Concretization: the setup summary anti-pattern

```bash
# Step 2 — fresh subprocess
GEMINI_STATUS="ok"
echo "gemini: $GEMINI_STATUS"

# Step 3 — fresh subprocess
OPENCODE_STATUS="ok"
echo "opencode: $OPENCODE_STATUS"

# Step 5 — DIFFERENT fresh subprocess; $GEMINI_STATUS and $OPENCODE_STATUS are unset
READY_COUNT=0
[ "$GEMINI_STATUS"  = "ok" ] && READY_COUNT=$((READY_COUNT + 1))   # always false
[ "$OPENCODE_STATUS" = "ok" ] && READY_COUNT=$((READY_COUNT + 1))  # always false
printf '%d of 3 reviewers ready\n' "$READY_COUNT"                   # always "0 of 3"
```

#### Three fixes, in order of preference

##### Fix A: Re-derive inline in the summary block

Each prior step writes a sentinel file (e.g., `touch /tmp/gemini-ok`) and the
summary block checks for the files' existence:

```bash
# Step 2
if command -v gemini >/dev/null 2>&1; then
  touch /tmp/.council-gemini-ok
else
  rm -f /tmp/.council-gemini-ok
fi

# Step 5 — re-derive from sentinel files
READY_COUNT=0
GEMINI_STATUS="NOT READY";  [ -f /tmp/.council-gemini-ok  ] && { GEMINI_STATUS="ok";  READY_COUNT=$((READY_COUNT + 1)); }
OPENCODE_STATUS="NOT READY"; [ -f /tmp/.council-opencode-ok ] && { OPENCODE_STATUS="ok"; READY_COUNT=$((READY_COUNT + 1)); }
printf 'gemini:   %s\nopencode:  %s\n%d of 3 ready\n' \
  "$GEMINI_STATUS" "$OPENCODE_STATUS" "$READY_COUNT"
```

##### Fix B: Persist to a state file and source it

```bash
# Step 2
STATE_FILE="/tmp/.council-setup-state.env"
GEMINI_STATUS="ok"
printf 'GEMINI_STATUS=%s\n' "$GEMINI_STATUS" >> "$STATE_FILE"

# Step 5
STATE_FILE="/tmp/.council-setup-state.env"
[ -f "$STATE_FILE" ] && . "$STATE_FILE"
# $GEMINI_STATUS, $OPENCODE_STATUS now available
```

##### Fix C: Consolidate all steps into one Bash block

If the steps are fast and do not require separate user interaction between
them, merge Steps 2–5 into a single Bash block. This is the simplest fix when
the intermediate steps produce no output the user needs to act on.

#### Detection

When reviewing a multi-step setup or install command file, run:

```bash
# Find variables used in a later bash block that are set in an earlier one
# (heuristic: look for variables referenced in "summary" or "Step N" blocks
# where N > the step that sets them)
rg 'READY_COUNT|_STATUS|INSTALLED_COUNT' plugins/ --include='*.md'
```

Checklist question: "Does any bash block in this file reference a variable
that was only assigned in a prior code block (not the current one)?"

If yes: apply Fix A (sentinel files), Fix B (state file), or Fix C (merge
blocks) as appropriate.

---

## Update — 2026-07-28

### Cross-Block Variable Loss Upstream of a Security Sanitizer Is a Silent No-Op, Not a Visible Bug (PR #670)

`plugins/yellow-codex/commands/codex/rescue.md` Step 4 set `RESCUE_OUTPUT`
from `codex exec` output; Step 5 fed `$RESCUE_OUTPUT` through two
security-critical transforms — fence-escaping the codex output before
embedding it, and credential redaction. Steps 4 and 5 are separate Bash
tool invocations, so Step 5's `$RESCUE_OUTPUT` was unset per the root cause
already documented above.

Every prior concretization in this doc (setup summary blocks, `SKIP_CURL_PROBE`,
`has_userconfig`) is a **correctness** bug: a wrong count, a wrong branch,
something visibly off. This one is different in kind. An empty string run
through `sed`-based fence-escaping and through a redaction filter still
exits 0 and produces output — just empty output. Nothing errors. Nothing
looks wrong at a glance; the step "ran." The two security controls silently
became no-ops on every invocation, and a manual-verification claim in the
PR body was credible despite the bug because a merged interactive shell
session does carry the variable across what would otherwise be two
separate Bash tool calls — this is a category of verification gap
distinct from, but adjacent to, the mechanical-verification pattern in
`docs/solutions/code-quality/doc-fix-mechanical-verification-gap.md`
(assertion vs. actually re-running the check).

**Verification rule:** any fix to a cross-block variable-survival bug must
be verified by executing the affected blocks as two genuinely separate Bash
tool invocations (not pasted into one shell), because a merged session
passes on the broken version and gives false confidence.

#### Fix D: literal-path handoff + re-derive + delete

Distinct from Fix A (sentinel files), Fix B (state file), and Fix C (merge
blocks): Step N writes the payload to a file and prints the file's literal
path (not a variable name — the *path itself*, so the next Bash tool call's
prompt text contains a concrete filesystem path). Step N+1 has that literal
path substituted into its own text, re-reads the file at that path, and
deletes it once done:

```bash
# Step 4 — write payload, print the literal path (not $OUTPUT_FILE)
OUTPUT_FILE="$(mktemp)"
codex exec ... > "$OUTPUT_FILE"
printf 'Rescue output written to: %s\n' "$OUTPUT_FILE"
```

```bash
# Step 5 — the literal path below is the one printed by Step 4, pasted
# into this block's text by the agent (not read from environment)
OUTPUT_FILE="/tmp/tmp.XXXXXXXXXX"   # <- literal path from Step 4's output
[ -s "$OUTPUT_FILE" ] || { printf 'Error: rescue output missing or empty\n' >&2; exit 1; }
RESCUE_OUTPUT="$(cat "$OUTPUT_FILE")"
rm -f "$OUTPUT_FILE"
# ... escape_fences "$RESCUE_OUTPUT" ...  (see security-issues/prompt-injection-fence-breakout-literal-delimiter.md)
```

Fix D differs from Fix B in what crosses the block boundary: B sources a
fixed-path env file of key=value pairs; D carries a run-specific path
forward as a literal string in the agent's own generated text, and the
payload that survives is file *content*, not shell variables.

**The `[ -s "$OUTPUT_FILE" ]` guard is load-bearing, not decorative.** If
the literal path substitution is missed, or the block is re-run against a
stale/deleted path, `cat` on a missing or empty file yields an empty
string and reproduces the exact original bug — a security transform
running on empty input that exits 0. Fix D is only safe when paired with a
fail-closed guard immediately before the security transform; without the
guard, D silently degrades to the same failure mode it was meant to fix.

#### Checklist addition

- [ ] If a variable crossing a bash-block boundary feeds a security
      transform (redaction, escaping, permission check), verify the fix by
      running the affected blocks as two separate Bash invocations — a
      merged shell session will pass on the broken version
- [ ] Any Fix D (literal-path handoff) is paired with a fail-closed
      `[ -s "$FILE" ]` (or equivalent) guard immediately before the
      security transform that consumes the file's content

## Update — 2026-08-06: third recurrence, this time the loss was total silence not a security no-op (PR #700)

Third documented instance of cross-block variable loss in a yellow-codex
command file (after the original setup-block bugs above, PR #259, and the
`rescue.md` Step 4/5 security-transform no-op, PR #670, Update above).

`plugins/yellow-codex/commands/codex/review.md` Step 4 ran `codex exec`,
captured its output into `$REVIEW_OUTPUT`, and then deleted the temp file
the output had been read from. Step 4b — written as its own standalone
bash fence, per this doc's already-documented rule that each fence is a
fresh subprocess — redacted `$REVIEW_OUTPUT` for credentials before it
would be printed downstream. Because Step 4b is a separate Bash tool
invocation from Step 4, `$REVIEW_OUTPUT` was unset when Step 4b ran; the
redaction step redacted an empty string, and — the detail that made this
worse than the `rescue.md` case — **nothing in Step 4b (or after it) ever
printed the redacted result.** `/codex:review` silently discarded every
real Codex finding on every invocation. Unlike the `rescue.md` case, this
wasn't a security control silently degrading to a no-op on real data; the
real data itself never reached the user at all.

**Verification-gap parallel:** the `rescue.md` Update above notes a merged
interactive shell session passes on the broken version, giving false
confidence when a fix is verified by pasting both blocks into one session
instead of two genuinely separate Bash tool calls. The same trap applies
here in a different direction — this bug wasn't a security no-op that
still "ran" and exited 0 looking normal; it was a complete absence of
output, which is a more visible failure once someone actually looks at
`/codex:review`'s output. It shipped anyway because the two-block split
was itself new in this PR (there was no prior working version to diff
against), and the mechanical-verification gap
(`docs/solutions/code-quality/doc-fix-mechanical-verification-gap.md`)
applies just as much to "did I actually run this end-to-end across two
real Bash tool calls" as to doc-fix claims.

**Fix (a new variant, distinct from Fixes A-D above):** merge Step 4b's
redaction logic into Step 4's own fence — so capture and redaction happen
in the same subprocess, no cross-block variable ever needs to survive —
and end that fence with an explicit `printf` of the redacted result. The
Step 4b heading in the command file was kept but repointed to explanatory
prose only ("the redaction code itself lives inside Step 4's bash block
above"), rather than removed, so a reader following the numbered steps
still finds the redaction logic under the heading they expect.

**Fix E: merge-and-print, with the heading kept as a pointer**

```bash
# Step 4 (single fence — capture AND redact together, no cross-block var)
REVIEW_OUTPUT="$(codex exec ... < /dev/null)"
rm -f "$OUTPUT_FILE"
# ... redact_credentials() runs on $REVIEW_OUTPUT right here, same fence ...
printf '%s\n' "$REVIEW_OUTPUT"
```

```markdown
### Step 4b: Redact Credentials from Output

The redaction code itself lives INSIDE Step 4's bash block above (the
result of a variable-survival bug documented in
docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md
— Step 4b as its own fence would scrub an empty string whose temp file
Step 4 already deleted, and nothing would ever print the real result).
```

This differs from Fix C (merge blocks) mainly in explicitly calling out
*why* the heading survives with no code under it — a maintainer scanning
step headings for "where does X happen" needs the pointer, not just a
deleted section.

**General rule (an addition to the "when to merge vs. hand off" guidance
already implicit in Fixes A-D):** when a later step's *entire purpose* is
to transform a variable set by an earlier step, and there is no reason
for a human or agent to pause between the two steps, default to merging
them into one fence rather than splitting for readability — the split
only pays for itself when something needs to happen between the steps
(a review checkpoint, a literal-path handoff per Fix D). A step split
that exists purely for document structure is exactly the shape that
reintroduces this bug a fourth time.

**Components (this Update):** `plugins/yellow-codex/commands/codex/review.md`.
