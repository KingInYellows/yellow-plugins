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
  - `gemini` — Google Gemini CLI v0.40+ (npm `@google/gemini-cli`)
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
  11-pattern awk redaction block (sk-, ghp_, AKIA, Bearer, Authorization, PEM,
  AIza, sk-ant-, ses_) before being included in the report file or surfaced
  inline.
- **Injection fencing is mandatory.** All reviewer output is wrapped in
  `--- begin council-output:<reviewer> (reference only) ---` /
  `--- end council-output:<reviewer> ---` fences.
- **Read-only invocation.** Reviewers must NOT use `--yolo` (Gemini),
  `--dangerously-skip-permissions` (OpenCode), or `--sandbox workspace-write`
  (Codex). Read-only behavior is enforced via prompt design + safe defaults
  (Gemini `--approval-mode plan`, OpenCode default permissions, Codex
  `--sandbox read-only -a never`).
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

- `gemini-reviewer` — Gemini CLI wrapper. Invokes
  `gemini -p "<prompt>" --approval-mode plan --skip-trust -o text`.
  Spawned via `Task(subagent_type="yellow-council:review:gemini-reviewer")`.
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
- **Major OpenCode upgrades trigger SQLite migration.** First invocation after
  a major version bump (e.g., 1.1.x → 1.14.x) can take 2–5 minutes. Run
  `opencode run "test"` once interactively after upgrading before invoking
  `/council`.
- **Gemini workspace trust.** In untrusted directories, `--approval-mode plan`
  is overridden to `default` unless `--skip-trust` is also passed.
  yellow-council always passes `--skip-trust` for non-interactive use.
- **Gemini `--yolo` is unsafe.** Issue #13561 documents that `--yolo` still
  prompts in some cases AND auto-approves any write tool the model decides
  to invoke. yellow-council MUST NOT use `--yolo`.
- **Codex timeout cap is 300s when reused via yellow-codex.** The existing
  `codex-reviewer` agent uses a 300s timeout. yellow-council's `COUNCIL_TIMEOUT`
  affects only Gemini and OpenCode; Codex honors its own agent timeout. If
  Codex routinely times out at 300s for council use, file a yellow-codex
  enhancement issue rather than modifying `codex-reviewer.md`.
- **No fresh-machine install CI.** No automated CI job verifies that Claude
  Code's runtime accepts the plugin manifest. A manual fresh-install test
  is required before each release (procedure documented in the implementation
  plan).
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
