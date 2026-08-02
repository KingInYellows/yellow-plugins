# yellow-council Plugin

On-demand cross-lineage code review plugin. Fans out to Codex (via yellow-codex
optional dependency), Gemini, and OpenCode CLIs in parallel via subprocess
spawn-and-wait, synthesizes verdicts inline, and persists the full report to
`docs/council/<date>-<mode>-<slug>.md`.

## Core Principle

The council is **on-demand and advisory** — never automatic, never blocking.
It is invoked deliberately when the user wants a heavyweight cross-lineage
opinion. Output never gates a merge, never triggers an automatic fix pass,
and never auto-commits. The user decides what to do with the verdicts.

## Required Environment

- **Bash 4.3+** — for associative arrays and `${var^}` case-conversion used in `/council` orchestration
- **GNU coreutils** — `timeout`, `mktemp`, `mv`, `awk`, `sed`, `grep`
- **`jq`** — required for OpenCode JSON event stream parsing
- **External CLIs (user-installed; soft-skipped if missing):**
  - `agy` — Google Antigravity CLI v1.0+ (replaces Gemini CLI, which stopped
    serving consumer subscriptions on 2026-06-18; run `agy` once
    interactively to migrate auth, `agy plugin import gemini` for extensions)
  - `opencode` — OpenCode CLI v1.14+ (curl install or npm `opencode-ai`)
- **Optional cross-plugin dependency:** `yellow-codex` ≥ 0.2.0 — provides the
  `yellow-codex:review:codex-reviewer` agent. If absent, council runs with
  2 of 3 reviewers (graceful soft-skip).

## Conventions

- **Synchronous parallel fan-out.** All three reviewers spawned in a single
  message via Task tool; Claude Code's harness runs them concurrently.
  council.md collects return values after all three complete.
- **Per-reviewer timeout: 600 seconds.** Configurable via `COUNCIL_TIMEOUT`.
  Partial results: timed-out reviewers are excluded from synthesis but the
  council still produces a report with the remaining verdicts.
- **Output redaction is mandatory.** Each reviewer's output passes through an
  11-pattern awk redaction block (sk-proj-, sk-ant-, sk-, AIza, gh[pous]_,
  github_pat_, AKIA, Bearer, Authorization, ses_, PEM private key blocks)
  before being included in the report file or surfaced inline. Canonical
  list and awk source in `council-patterns` SKILL.md.
- **Injection fencing is mandatory.** All reviewer output is wrapped in
  `--- begin council-output:<reviewer> (reference only) ---` /
  `--- end council-output:<reviewer> ---` fences.
- **Read-only invocation.** Reviewers must NOT use
  `--dangerously-skip-permissions` (agy, OpenCode) or
  `--sandbox workspace-write` (Codex). Read-only behavior is enforced via
  prompt design + safe defaults (OpenCode default permissions, Codex
  `-c 'sandbox_mode="read-only"' -c 'approval_policy="never"'`). For agy
  there is NO read-only flag — `--sandbox` is terminal restrictions only
  (spike-verified it can still write files in print mode); containment is
  cwd-isolation to the throwaway pack dir plus an explicit prohibition in
  the `-p` prompt. See Known Limitations.
- **Path validation.** All `--paths` and file inputs validated via SKILL
  pattern (regex + `..` reject + existence check) before constructing shell
  args.
- **Atomic file write via Write tool.** Writes synthesis report directly to
  `docs/council/<date>-<mode>-<slug>.md` using the Write tool (no temp file
  staging — matches brainstorm-orchestrator precedent).

## Plugin Components

### Commands (1)

- `/council <mode> [args]` — main entry point with four modes:
  - `plan <path-or-text>` — council on a planning doc / design proposal
  - `review [--base <ref>]` — council on the current diff
  - `debug "<symptom>" [--paths <files>]` — council on a debug investigation
  - `question "<text>" [--paths <files>]` — open-ended consultation
- Bare `/council` prints the four-mode help and exits 0.
- `/council fleet` is reserved for V2 fleet management; prints "fleet management
  not available in V1 — coming in V2" and exits 0.

### Agents (2)

- `gemini-reviewer` — Antigravity CLI (`agy`) wrapper for the Google lineage
  slot. Invokes
  `cd "$PACK_DIR" && agy --sandbox --print-timeout <duration> -p "<short trusted pointer to $PACK_FILE>"`
  (pack delivered as a workspace file — agy ignores piped stdin, and argv is
  capped at ~128KiB; cwd-isolated to the pack dir; pack ingestion verified
  via INGEST_TOKEN echo). Spawned via
  `Task(subagent_type="yellow-council:review:gemini-reviewer")`.
- `opencode-reviewer` — OpenCode CLI wrapper. Invokes
  `opencode run --format json --variant high "<prompt>"` plus session cleanup
  via `opencode session delete <id>`. Spawned via
  `Task(subagent_type="yellow-council:review:opencode-reviewer")`.

(Codex reviewer is reused from yellow-codex when installed:
`yellow-codex:review:codex-reviewer`. yellow-council does NOT ship its own
Codex agent.)

### Skills (1)

- `council-patterns` — canonical reference for CLI invocation conventions,
  per-mode pack templates, redaction patterns, slug derivation, timeout/exit
  code handling, and output parsing. Cross-references yellow-codex's
  `codex-patterns` skill rather than duplicating Codex-specific logic.

## Cross-Plugin Dependencies

| Dependency | Purpose | Required? |
|---|---|---|
| yellow-codex | Provides `codex-reviewer` agent for the Codex leg of the council | Optional |
| yellow-core | None (yellow-council does NOT depend on yellow-core) | — |
| yellow-review | None (yellow-council is a SEPARATE pipeline; yellow-review's 14-reviewer Claude pipeline runs unchanged) | — |

## When to Use What

| Need | Command | Notes |
|---|---|---|
| Cross-lineage opinion on a design doc | `/council plan <path>` | All three reviewers see the doc + repo CLAUDE.md |
| Cross-lineage code review of current diff | `/council review` | Defaults to upstream-tracking branch's merge-base |
| Cross-lineage debug investigation | `/council debug "<symptom>" --paths <files>` | Up to 3 files, 8K chars each |
| Open-ended consultation | `/council question "<text>" [--paths]` | Most flexible; lowest context structure |
| Standard PR review (Claude only) | Use `/review:pr` from yellow-review | Council is for the heavyweight cross-lineage cases |

## Configuration

| Var | Type | Default | Purpose |
|-----|------|---------|---------|
| `COUNCIL_TIMEOUT` | integer seconds | `600` | Per-reviewer timeout passed to GNU `timeout`. Increase for very slow models / very large packs. |
| `COUNCIL_OPENCODE_VARIANT` | `high \| max \| minimal` | `high` | OpenCode `--variant` reasoning effort. `max` is significantly slower; reserve for explicit override. |
| `COUNCIL_PATH_CHAR_CAP` | integer chars | `8000` | Per-file content cap for `--paths` injection in `debug`/`question` modes. |
| `COUNCIL_PATH_MAX_FILES` | integer | `3` | Maximum number of files accepted via `--paths` in any single invocation. |

## Known Limitations

- **OpenCode persistent sessions.** Every `opencode run` creates a SQLite
  session in `~/.local/share/opencode/`. yellow-council cleans up after each
  invocation via `opencode session delete <id>`, but if the cleanup itself
  fails (rare), sessions accumulate. Periodic manual `opencode session list`
  audit is recommended.
- **agy workspace trust in print mode is unverified.** The Antigravity CLI
  tracks `trustedWorkspaces` in its settings; the 2026-08-01 spike ran only
  in an already-trusted repo. If a first `/council` run in a new directory
  hangs, run `agy -p "test"` interactively once — the reviewer's timeout
  guard catches the hang and reports TIMEOUT either way.
- **agy has no read-only mode.** `--sandbox` restricts the terminal only —
  the 2026-08-01 spike confirmed agy will create files in print mode with
  no permission prompt. The reviewer mitigates by running agy with its cwd
  in the throwaway pack dir (repo checkout stays out of the workspace) and
  an explicit no-file-modification instruction in the prompt; this is
  prompt-plus-containment enforcement, weaker than the retired
  `--approval-mode plan`. Treat any unexpected file mutation after a
  council run as a bug report for this plugin.
- **agy `--dangerously-skip-permissions` is unsafe.** It auto-approves every
  tool permission request, including writes (same class as the retired
  gemini `--yolo`). yellow-council MUST NOT use it.
- **Legacy `gemini` binary is dead for consumer tiers.** Google stopped
  serving Gemini CLI requests for consumer subscriptions on 2026-06-18. A
  present `gemini` binary does not mean a working one; the reviewer checks
  for `agy` only.
- **Codex timeout cap is 300s when reused via yellow-codex.** The existing
  `codex-reviewer` agent uses a 300s timeout. yellow-council's `COUNCIL_TIMEOUT`
  affects only Gemini and OpenCode; Codex honors its own agent timeout. If
  Codex routinely times out at 300s for council use, file a yellow-codex
  enhancement issue rather than modifying `codex-reviewer.md`.
- **No fresh-machine install CI.** No automated CI job verifies that Claude
  Code's runtime accepts the plugin manifest. A manual fresh-install test
  is required before each release (procedure documented in
  `docs/testing/yellow-council-manual-tests.md`).
- **OpenCode large minor-version jumps trigger a one-time SQLite migration**
  (2–5 minutes). After running `opencode upgrade` from v1.1.x to v1.14+, the
  next `opencode run` invocation performs a database migration that may
  exceed the council's `COUNCIL_TIMEOUT` (default 600s). Run
  `opencode run "test"` once interactively after each upgrade before relying
  on the agent for time-bounded invocations.
- **Single-shot V1.** No multi-round iterative review. V2 will add `--round 2`
  for follow-up consultations and `/council fleet *` subcommands for persistent
  session management.

## V2 Trajectory

V1 is the on-demand single-shot foundation. V2 evolves toward GodModeSkill's
native model:

1. **XML evidence contract.** Reviewer output schema tightens from markdown
   `Verdict:` / `Findings:` to GodModeSkill's `<file-path>` / `<line-number>`
   / `<quoted-line><![CDATA[...]]></quoted-line>` evidence format.
2. **Lineage-weighted quorum aggregation.** V1's raw count + verbatim
   presentation gets replaced with quorum logic (agreement requires ≥1
   reviewer from each enabled lineage; quote-unverified findings are
   downgraded).
3. **Multi-round iterative review.** `/council review --round 2` injects V1
   output as prior context with round-aware trimming.
4. **Fleet management subcommand surface.** `/council fleet status`,
   `/council fleet restart`, persistent tmux-style session management.
5. **`## DONE` event-driven waiting.** `inotifywait`-equivalent waiting for
   reviewer output instead of subprocess-blocking timeout.

## Attribution

Algorithmic ideas borrowed from `99xAgency/GodModeSkill` at commit
`b693d1da498cbcfc2e5cba1f85b3d341205bfeb0`, MIT-licensed. No code copied; if
verbatim code lift occurs in a future PR, add `third_party/GodModeSkill.LICENSE`
and per-file attribution headers per MIT requirements.
