# Spike: Antigravity CLI (`agy`) headless invocation + subscription auth

**Date:** 2026-08-01
**Binary:** `agy` 1.0.2 (`~/.local/bin/agy`)
**Context:** Google shut off Gemini CLI for consumer subscription tiers
(Google AI Pro/Ultra + free individual tier) on 2026-06-18; the Antigravity
CLI is the official replacement. This spike verifies whether yellow-council's
gemini-reviewer can migrate its shell-out from `gemini` to `agy` without
breaking the plugin's "subscription auth, no API keys" constraint. Executes
Task G.1 of the yellow-council V2 revalidation record
(`docs/research/yellow-council-v2-revalidation-2026-08-01.md`).

## Verdict

Migration is viable. Subscription auth carries over (R0 resolves favorably),
headless print mode works — but **three invocation-breaking differences from
Gemini CLI** were found: `agy` does not read piped stdin; none of Gemini
CLI's `--approval-mode` / `--skip-trust` / `-o` flags exist; and `--sandbox`
does NOT block file writes (no read-only mode exists at all). Pack delivery
switches from stdin to a workspace file the CLI reads itself, verified via
an ingest-token echo, with agy cwd-isolated to the throwaway pack dir.

## Verified findings

### 1. Subscription auth continuity (R0) — CONFIRMED FAVORABLE

`agy -p "..."` ran successfully with no API key configured and no key
requested — the first-run onboarding had migrated the existing Gemini OAuth
session tokens (per Google's docs, into OS keyring storage). The
per-token-billing rumor from community forums did NOT materialize on this
install.

### 2. Flag surface (from `agy --help`, v1.0.2)

```text
--add-dir                       Add a directory to the workspace (repeatable)
-c / --continue                 Continue the most recent conversation
--conversation                  Resume a previous conversation by ID
--dangerously-skip-permissions  Auto-approve all tool permission requests
-i / --prompt-interactive       Run an initial prompt interactively
--log-file                      Override CLI log file path
-p / --print / --prompt         Run a single prompt non-interactively, print response
--print-timeout                 Timeout for print mode wait (default 5m0s)
--sandbox                       Run in a sandbox with terminal restrictions
```

Notable ABSENCES vs. Gemini CLI: no `--output-format`/`-o` (print mode emits
plain text), no `--approval-mode`, no `--skip-trust`, no `--yolo`. The
read-only-ish analog is `--sandbox` (terminal restrictions).
`--dangerously-skip-permissions` is the auto-approve-everything flag —
**never use it** (same class as Gemini's banned `--yolo`).

### 3. Headless print mode — works

```bash
$ agy --sandbox --print-timeout 60s -p "Reply with exactly the single word: HELLO"
HELLO        # exit 0
```

Plain text on stdout, exit 0 on success. `--print-timeout` accepts Go
duration syntax (`60s`, `610s` verified). Default is `5m0s` — SHORTER than
council's `COUNCIL_TIMEOUT` default of 600s, so the flag must be passed
explicitly with a value above the external `timeout(1)` guard, or agy's
internal timeout fires first and the TIMEOUT exit-code classification
(124/137) never triggers.

### 4. Piped stdin is NOT read — BREAKING difference

```bash
$ printf 'MARKER-ALPHA-7741\n' | agy --sandbox -p "If you received any piped/stdin input, quote it verbatim. If none, reply exactly: NO-STDIN"
NO-STDIN     # exit 0
```

Gemini CLI documented `-p` as "appended to input on stdin"; yellow-council
fed the council pack via `< "$PACK_FILE"` to dodge the ~128KiB MAX_ARG_STRLEN
argv cap. With `agy` that pattern silently reviews nothing.

### 5. Workspace file read in sandboxed print mode — works, no permission prompt

```bash
$ D=$(mktemp -d /tmp/agy-spike-XXXXXX); printf 'MARKER-BRAVO-9913\n...' > "$D/pack.txt"
$ agy --sandbox --add-dir "$D" -p "Read the file $D/pack.txt and reply with the marker"
MARKER-BRAVO-9913     # exit 0
```

This is the replacement pack-delivery mechanism: stage the pack to the
mktemp dir (unchanged), pass `--add-dir "$PACK_DIR"`, and make `-p` a short
trusted pointer instructing the CLI to read the pack file. No interactive
permission prompt fired in `--sandbox` print mode for the file read.

### 6. `--sandbox` does NOT block file writes — write test

```bash
$ cd $(mktemp -d) && agy --sandbox --add-dir "$PWD" -p "Create a file named test.txt containing hello, then state whether you succeeded."
I have created the file test.txt ... Status: Succeeded.     # exit 0, file exists on disk
```

No permission prompt fired. `--sandbox` is terminal restrictions only —
there is NO read-only flag replacing Gemini CLI's `--approval-mode plan`.
Adopted mitigations (both spike-verified in one combined run): (a) invoke
agy with cwd set to the throwaway pack dir so the repo checkout is outside
its workspace; (b) an explicit "Do not create, modify, or delete any files"
instruction in the `-p` prompt. This is containment-plus-prompt
enforcement, honestly documented as weaker than the retired flag.

### 7. Ingest-token echo — deterministic pack-read verification

Because pack delivery is now an agentic file read (not deterministic
stdin), a failed or partial read would still exit 0 and produce a
plausible verdict from unread input. Fix: write a random
`INGEST_TOKEN: <hex>` line as the pack file's first line (token appears
ONLY in the file, never in `-p`), instruct the CLI to begin its response by
echoing that line, and reject output lacking the echo. Verified: token
echoed correctly from a cwd-isolated pack dir, no trust-prompt hang, no
stray files created.

```bash
$ cd "$D" && agy --sandbox --print-timeout 90s -p "Read the file $D/pack.txt in the current directory. Its first line is an INGEST_TOKEN line — begin your response by repeating that line exactly, ..."
INGEST_TOKEN: cafe1234beef
DONE          # exit 0
```

### 8. Config relocation (affects lineage detection)

`~/.gemini/antigravity-cli/settings.json` exists but holds only
`colorScheme` / `enableTelemetry` / `trustedWorkspaces` — **no `model`
field**. Lineage detection (V2 shell 04) cannot read a model name from agy
config; assume lineage `google` for the slot. MCP config lives at
`~/.gemini/config/mcp_config.json` (not used by yellow-council).

## Unverified / residual

- Exit-code catalog beyond 0 (Gemini CLI's 1/42/53 codes do not necessarily
  carry over). The reviewer's exit-code handling treats 124/137 as timeout,
  126/127 as unavailable, and everything else as ERROR with stderr
  classification — safe against unknown codes.
- Behavior in an untrusted workspace (`trustedWorkspaces` setting) in print
  mode — this spike ran in an already-trusted repo. If a first `/council`
  run in a new directory hangs, run `agy -p "test"` interactively once.
- Quota-exhaustion error strings — no official Antigravity catalog
  published; `RESOURCE_EXHAUSTED` remains the assumed floor (V2 shell 04
  concern, not Phase G).

## Resulting invocation (adopted by gemini-reviewer.md)

```bash
cd "$PACK_DIR" && \
timeout --signal=TERM --kill-after=10 "${COUNCIL_TIMEOUT:-600}" \
  agy --sandbox \
    --print-timeout "$(( ${COUNCIL_TIMEOUT:-600} + 30 ))s" \
    -p "Read the file $PACK_FILE in the current directory. Its first line is an INGEST_TOKEN line — begin your response by repeating that line exactly, then follow the pack instructions that come after it. Do not create, modify, or delete any files." \
  > "$OUTPUT_FILE" 2> "$STDERR_FILE"
# Step 5 gate: grep the output for "INGEST_TOKEN: <token>" — missing echo
# → verdict=ERROR (pack not read), never a synthesized verdict.
```
