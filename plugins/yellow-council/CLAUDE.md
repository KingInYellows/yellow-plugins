# yellow-council Plugin

On-demand cross-lineage code review plugin. Fans out to four reviewers in
parallel — an in-process Claude reviewer plus Codex (via yellow-codex optional
dependency), Gemini, and OpenCode CLIs via subprocess spawn-and-wait —
synthesizes verdicts inline, and persists the full report to
`docs/council/<date>-<mode>-<slug>.md`.

## Core Principle

The council is **on-demand and advisory** — never automatic, never blocking.
It is invoked deliberately when the user wants a heavyweight cross-lineage
opinion. Output never gates a merge, never triggers an automatic fix pass,
and never auto-commits. The user decides what to do with the verdicts.

## Required Environment

- **Bash 4.3+** — for associative arrays and `${var^}` case-conversion used in `/council` orchestration
- **GNU coreutils + findutils** — `timeout`, `mktemp`, `mv`, `awk`, `sed`,
  `grep`, and `find` (the last drives the stale-`/tmp` sweep; without it a
  cancelled run leaves raw reviewer output behind until the OS reaps `/tmp`)
- **`jq`** — required for OpenCode JSON event stream parsing
- **External CLIs (user-installed; soft-skipped if missing):**
  - `agy` — Google Antigravity CLI v1.0+ (replaces Gemini CLI, which stopped
    serving consumer subscriptions on 2026-06-18; run `agy` once
    interactively to migrate auth, `agy plugin import gemini` for extensions)
  - `opencode` — OpenCode CLI v1.14+ (curl install or npm `opencode-ai`)
- **Optional cross-plugin dependency:** `yellow-codex` ≥ 0.2.0 — provides the
  `yellow-codex:review:codex-reviewer` agent. If absent, council runs with
  3 of 4 reviewers (graceful soft-skip).

## Conventions

- **Synchronous parallel fan-out.** All four reviewers spawned in a single
  message via Task tool; Claude Code's harness runs them concurrently.
  council.md collects return values after all four complete.
- **One in-process slot, three CLI slots.** `claude-reviewer` runs inside
  Claude Code with no `Bash` and no subprocess. Consequences: `COUNCIL_TIMEOUT`
  does not bound it, it has no not-installed degradation branch, and its
  redaction and fence-escaping safeguards are prompt-level prose rather than
  the `awk`/`sed` mechanics the CLI wrappers run. It also cannot mint its own
  temp path, so `council.md` mints its fenced-output path with `mktemp -u` and
  passes the literal path in the spawn prompt.
- **Per-reviewer timeout: 600 seconds** (CLI reviewers only). Configurable via
  `COUNCIL_TIMEOUT`.
  Partial results: timed-out reviewers are excluded from synthesis but the
  council still produces a report with the remaining verdicts.
- **Output redaction is mandatory.** Each reviewer's output passes through an
  11-pattern awk redaction block (sk-proj-, sk-ant-, sk-, AIza, gh[pous]_,
  github_pat_, AKIA, Bearer, Authorization, ses_, PEM private key blocks)
  before being included in the report file or surfaced inline. Canonical
  list and awk source in `council-patterns` SKILL.md. **Where it runs differs
  by slot:** the three CLI reviewers run it inside their own agent, over the
  CLI output, before writing their fenced file. `claude-reviewer` has no Bash
  and cannot, so `council.md` Step 7 runs the same block over its fenced file
  before appending it to the report. The invariant is that no reviewer's
  content reaches `docs/council/<report>.md` unredacted — the enforcement
  point, not the guarantee, is what varies.
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

### Commands (2)

- `/council <mode> [args]` — main entry point with four modes:
  - `plan <path-or-text>` — council on a planning doc / design proposal
  - `review [--base <ref>]` — council on the current diff
  - `debug "<symptom>" [--paths <files>]` — council on a debug investigation
  - `question "<text>" [--paths <files>]` — open-ended consultation
- Bare `/council` prints the four-mode help and exits 0.
- `/council fleet` is reserved for V2 fleet management; prints "fleet management
  not available in V1 — coming in V2" and exits 0.
- `/council:setup` — prerequisite check (bash 4.3+, `timeout`, `jq`) plus a
  reviewer-availability summary. Does NOT verify CLI authentication.

### Agents (3)

- `claude-reviewer` — the in-process slot. No CLI, no subprocess, no `Bash`:
  it reads the pack from its spawn prompt, investigates with Read/Grep/Glob,
  and returns the same 6-key contract as the CLI wrappers. Carries a
  contrarian review stance (R6) to decorrelate it from the synthesizer it
  shares a model family with. Holds `Write` for exactly one file — the
  fenced-output path `council.md` mints with `mktemp -u` — and is allowlisted
  for that in `scripts/validate-agent-authoring.js`. Spawned via
  `Task(subagent_type="yellow-council:review:claude-reviewer")`.
- `gemini-reviewer` — Antigravity CLI (`agy`) wrapper for the Google lineage
  slot. Invokes
  `cd "$PACK_DIR" && agy --sandbox --print-timeout <duration> -p "<short trusted pointer to $PACK_FILE>"`
  (pack delivered as a workspace file — agy ignores piped stdin, and argv is
  capped at ~128KiB; cwd-isolated to the pack dir; pack ingestion verified
  via a final-line INGEST_TOKEN echo — proves the file was read to its end,
  not that instructions were followed). Spawned via
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
| Cross-lineage opinion on a design doc | `/council plan <path>` | All four reviewers see the doc + repo CLAUDE.md |
| Cross-lineage code review of current diff | `/council review` | Defaults to upstream-tracking branch's merge-base |
| Cross-lineage debug investigation | `/council debug "<symptom>" --paths <files>` | Up to 3 files, 8K chars each |
| Open-ended consultation | `/council question "<text>" [--paths]` | Most flexible; lowest context structure |
| Standard PR review (Claude only) | Use `/review:pr` from yellow-review | Council is for the heavyweight cross-lineage cases |

## Configuration

| Var | Type | Default | Purpose |
|-----|------|---------|---------|
| `COUNCIL_TIMEOUT` | integer seconds | `600` | Per-reviewer timeout passed to GNU `timeout`. Increase for very slow models / very large packs. Must be a plain integer number of seconds; non-integer values (e.g. `10m`, `600s`) fall back to 600 with a warning. |
| `COUNCIL_OPENCODE_VARIANT` | `high \| max \| minimal` | `high` | OpenCode `--variant` reasoning effort. `max` is significantly slower; reserve for explicit override. |
| `COUNCIL_PATH_CHAR_CAP` | integer chars | `8000` | Per-file content cap for `--paths` injection in `debug`/`question` modes. |
| `COUNCIL_PATH_MAX_FILES` | integer | `3` | Maximum number of files accepted via `--paths` in any single invocation. |

## Testing

`bats tests/redaction.bats` from the plugin directory (the one bats suite CI
runs as a blocking gate). The awk redaction program is shipped as three
synchronized copies (`REDACTION_SOURCES` in
`tests/lib/extract-redaction-awk.bash`): `agents/review/gemini-reviewer.md`,
`agents/review/opencode-reviewer.md`, and `skills/council-patterns/SKILL.md`.
The bats suite extracts and runs the first entry, `gemini-reviewer.md`, and
also asserts byte-identity across all three — edit the patterns in all three
files together, never just one. There is no fresh-machine install CI (see
Known Limitations).

## Known Limitations

- **OpenCode persistent sessions.** Every `opencode run` creates a SQLite
  session in `~/.local/share/opencode/`. yellow-council cleans up after each
  invocation via `opencode session delete <id>`, but if the cleanup itself
  fails (rare), sessions accumulate. Periodic manual `opencode session list`
  audit is recommended.
- **The in-process slot has no timeout bound.** `COUNCIL_TIMEOUT` covers only
  the three CLI reviewers; a `claude-reviewer` run that never returns blocks
  the whole fan-out with no fallback (detail: `council.md`'s Failure Modes
  table, "claude-reviewer never returns at all"). Mitigation is prompt-level
  only — see `claude-reviewer.md` Step 2, "Keep this bounded." Worst case,
  cancel and re-run. A real regression versus the 3-reviewer V1, accepted as
  the cost of the in-process slot.
- **"Orchestrator-minted path" is a two-hop trust chain, not one.**
  `council.md` mints `claude-reviewer`'s fenced-output path in a Bash block,
  but the value reaches the agent because the orchestrating model copied the
  printed literal into the spawn prompt — and that turn's context already
  holds the untrusted pack. The `mktemp -u` suffix carries real entropy (no
  attacker-chosen target is reachable) and both `council.md` Step 7 and the
  agent itself now shape-check the path against
  `/tmp/council-claude-fenced-*.txt`, so a substituted lookalike is refused
  rather than read. What is NOT enforced: the substitution itself is an LLM
  turn, not deterministic templating. Same class of prompt-plus-containment
  enforcement as the agy limitation below.
- **`review` mode truncates large changes.** A diff over 60K bytes is reduced
  to `git diff --stat` plus its first 200 lines; changed-file excerpts stop at a
  30K combined budget; and if the measured pack still exceeds 100K bytes,
  excerpts are dropped from the end until it fits. The thresholds are set by the
  tightest consumer — OpenCode rejects packs over 120000 bytes and returns
  `UNAVAILABLE` — not by what the reviewers could otherwise digest. Consequence
  worth stating plainly: on a wide change the council forms verdicts on a
  partial view. Both reductions are marked in the pack, so a reviewer that cites
  a file it never received is a bug, not a hallucination to ignore.
- **A cancelled claude-reviewer leaves its raw output readable until the
  sweep.** `claude-reviewer` creates its fenced-output file with the `Write`
  tool under the ordinary process umask (0644 on a default umask 022), and
  `council.md` takes the mode down to 0600 in Step 4 — but Step 4 only runs
  when the slot returns and parses. If the in-process reviewer is cancelled or
  hangs, the `chmod` never executes and the file, holding RAW un-redacted
  review text, stays world-readable in `/tmp` until the age-gated sweep
  reclaims it (`STALE_MINUTES=1440`, so up to 24 hours) or the OS reaps
  `/tmp`. Closing this properly means minting the path inside a private
  `mktemp -d`, which every path guard in `council.md` rejects on purpose —
  see the `chmod` site for why that trade was taken. On a multi-user host,
  cancel a hung `/council` and remove `/tmp/council-claude-fenced-*.txt`
  by hand rather than waiting for the sweep.
- **agy workspace trust in print mode is unverified.** The Antigravity CLI
  tracks `trustedWorkspaces` in its settings; the 2026-08-01 spike ran only
  in an already-trusted repo. If a first `/council` run in a new directory
  hangs, run bare `agy` once — interactive first-run onboarding handles trust and token migration (`-p` is explicitly noninteractive and may repeat the hang); the reviewer's timeout
  guard catches the hang and reports TIMEOUT either way.
- **agy has no read-only mode.** `--sandbox` restricts the terminal only —
  the 2026-08-01 spike confirmed agy will create files in print mode with
  no permission prompt, and agy 1.0.2 ships no read-only tool policy flag.
  What IS enforced: the reviewer runs agy with its cwd in the throwaway
  pack dir (repo checkout stays out of the workspace), an explicit
  no-file-modification instruction in the `-p` prompt, and agy's own
  output is fenced before being handed back to `/council` so an injected
  instruction in its response can't execute in the orchestrator's context
  either. What is NOT enforced: a prompt-injected pack (a hostile PR diff
  or issue body) could still instruct agy to attempt an absolute-path
  write outside the pack dir — nothing flag-level blocks that attempt;
  this is prompt-plus-containment enforcement, weaker than the retired
  `--approval-mode plan`. Follow-up: if a future agy release ships an
  enforceable read-only tool policy flag, adopt it here and retire this
  limitation. Treat any unexpected file mutation after a council run as a
  bug report for this plugin.
- **A key that shares its BEGIN line with prose, or is wrapped by a
  serializer, leaks its tail.** Redaction classifies once, at BEGIN time: a
  marker that is the whole line (after decoration stripping) is a real key and
  is redacted unbounded; anything else is treated as a mention and runs under
  the bounded window, which releases after three non-key-shaped lines. Three
  shapes therefore land on the bounded path even though they carry a genuine
  key — `leaked key: -----BEGIN PRIVATE KEY-----`, a JSON string
  (`"-----BEGIN PRIVATE KEY-----",`, which OpenCode's `--format json` can
  produce), and a markdown table cell. With a narrowly wrapped body the tail
  of the key and its END marker survive into the report.
  A revision that normalized those shapes was reverted: keying "real key" off
  line length or off matched quote/table wrappers promoted ordinary MENTIONS
  to real keys, and real mode never resets until END or EOF, so one long
  paragraph or one `- "<marker>"` bullet swallowed `Verdict:`/`Confidence:`/
  `Summary:` and scored the reviewer UNKNOWN. Both directions are
  attacker-reachable. Closing the leak safely requires reworking the bounded
  window's width floor at the same time, which is deliberately left to its own
  change rather than patched shape-by-shape here.
- **agy `--dangerously-skip-permissions` is unsafe.** It auto-approves every
  tool permission request, including writes (same class as the retired
  gemini `--yolo`). yellow-council MUST NOT use it.
- **Legacy `gemini` binary is dead for consumer tiers.** Google stopped
  serving Gemini CLI requests for consumer subscriptions on 2026-06-18. A
  present `gemini` binary does not mean a working one; the reviewer checks
  for `agy` only.
- **Codex timeout cap is 300s when reused via yellow-codex.** The existing
  `codex-reviewer` agent uses a 300s timeout. yellow-council's `COUNCIL_TIMEOUT`
  affects only Gemini and OpenCode; Codex honors its own agent timeout, and
  the in-process `claude-reviewer` has no subprocess to bound at all. If
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
