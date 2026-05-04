# Feature: yellow-council Plugin (GodModeSkill Integration V1)

**Source brainstorm:** `docs/brainstorms/2026-05-03-godmodeskill-integration-brainstorm.md`
**Source investigation:** `research/GodModeSkill Integration Investigation.md`
**GodModeSkill reference commit:** `b693d1da498cbcfc2e5cba1f85b3d341205bfeb0`
**Plan date:** 2026-05-03
**Detail level:** COMPREHENSIVE

---

## Overview

Add a new dedicated plugin — `yellow-council` — to the yellow-plugins marketplace. The plugin provides a single user-invoked command, `/council <mode> [input]`, that fans out a context pack to three external CLI reviewers (Codex via existing `yellow-codex:review:codex-reviewer`, Gemini via new `gemini-reviewer`, OpenCode via new `opencode-reviewer`) in parallel subprocesses, applies a 600-second per-reviewer timeout with partial-result reporting, synthesizes the verdicts inline in the active conversation, and persists the full report to `docs/council/<date>-<slug>.md` after an `AskUserQuestion` save gate.

V1 is synchronous, advisory-only, and never blocks merges. V2 will evolve toward GodModeSkill's native persistent-session model with lineage-weighted quorum and quote-backed evidence verification — V1 must not foreclose that path.

This plan reflects findings from two parallel research passes (repo conventions + external CLI best practices), with explicit corrections to the brainstorm where upstream upstream CLIs proved different from documented behavior (Gemini `-o json` was broken upstream; OpenCode `opencode run` creates persistent sessions; Gemini `--yolo` still prompts).

---

## Problem Statement

### Current Pain Points

The existing `yellow-review` plugin runs a 14-reviewer Claude-only pipeline with confidence-rubric aggregation. It is mature for in-Claude PR review, but:

- It cannot bring in independent perspectives from other model lineages (OpenAI Codex, Google Gemini, Anthropic via OpenCode, etc.). Multi-LLM consensus on a tricky design decision is unreachable today.
- It is bound to PR review semantics. There is no mechanism to ask "what do three different model families think about this planning doc / this debug symptom / this freeform question?" outside of a code-change context.
- yellow-codex provides Codex as a single supplementary reviewer inside `review:pr`, but only there. There is no on-demand cross-lineage council surface.

### User Impact

When a developer hits a hard design decision, debugging a confusing failure, or evaluating a planning doc, they currently have to:
1. Open three separate terminals (one per CLI), or
2. Manually paste the same context into each tool, or
3. Just trust the in-Claude review and move on.

A single `/council <mode>` command that returns a synthesized cross-lineage verdict in 60–120 seconds is the missing tool.

### Business Value

- **Higher-confidence design decisions.** Cross-lineage agreement on an architectural choice is materially stronger evidence than single-model approval.
- **Lower context-switching overhead.** No more juggling three terminal sessions for ad-hoc consultations.
- **V2 lineage-quorum readiness.** V1 establishes the plugin shape and command surface so V2's GodModeSkill-style aggregation can drop in without rewriting any of the fan-out, pack-build, or output-capture stages.

---

## Proposed Solution

### High-Level Architecture

```
User invokes /council <mode> [input]
            │
            ▼
   ┌────────────────────┐
   │  council command   │  (commands/council/council.md — bash flow)
   │                    │
   │  1. validate mode  │
   │  2. build pack     │  (per-mode template from council-patterns SKILL.md)
   │  3. fan-out        │  (parallel subprocess spawn with timeout 600)
   │  4. wait + collect │  (wait "$pid" per-process, capture exit codes)
   │  5. redact + fence │  (8-pattern awk + AIza/sk-ant-/ses_ extras)
   │  6. synthesize     │  (Headline + Agreement + Disagreement)
   │  7. M3 confirm     │  (AskUserQuestion gate before write)
   │  8. atomic write   │  (mktemp same-dir → mv to docs/council/)
   └────────────────────┘
            │
            ├─► Task: yellow-codex:review:codex-reviewer  (graceful skip if absent)
            ├─► Bash: gemini "<prompt>"     (timeout 600 + temp file)
            └─► Bash: opencode run "<prompt>" + opencode session delete
```

The command is the orchestrator; agents are reviewer wrappers. The skill (`council-patterns`) holds shared invocation conventions and per-mode pack templates.

<!-- deepen-plan: codebase -->
> **Codebase:** Actual fan-out model is Task-based, not bash-subprocess-based. council.md spawns three Task tool calls (Codex via `yellow-codex:review:codex-reviewer`, Gemini via `yellow-council:review:gemini-reviewer`, OpenCode via `yellow-council:review:opencode-reviewer`) in a single message; Claude Code's harness runs them concurrently. Each reviewer agent internally spawns ONE `timeout ... <cli> ...` bash subprocess — there is no multi-PID `wait` loop INSIDE council.md. Precedent: `plugins/yellow-review/commands/review/review-pr.md:392` ("Launch all selected agents EXCEPT `code-simplifier` in parallel via Task tool"); `plugins/yellow-codex/agents/review/codex-reviewer.md` is the per-agent single-CLI invocation pattern.
<!-- /deepen-plan -->

### Key Design Decisions

| # | Decision | Rationale (locked in brainstorm + validated by research) |
|---|----------|----------------------------------------------------------|
| 1 | New plugin, not a modification of yellow-review | Different runtime contract (sidecar binaries vs in-Claude); separate failure semantics; clean V2 evolution surface |
| 2 | Synchronous parallel fan-out, 600s per-reviewer timeout | User explicitly invoked the heavyweight tool; `wait "$pid"` per-process pattern is portable to Bash 4.3+; `timeout --kill-after=10 600` matches yellow-codex precedent |
| 3 | yellow-codex as optional dep (Task spawn, not bundled Codex) | Avoids two diverging Codex implementations; `subagent_type="yellow-codex:review:codex-reviewer"` is the documented cross-plugin pattern |
| 4 | Explicit modes (plan/review/debug/question), no magic inference | Deterministic pack assembly; user always knows what reviewers see; V2-portable to GodModeSkill's XML pack templates |
| 5 | Inline synthesis + file write, simple V1 synthesizer | Synthesis is the V2 swap surface — keep it isolated and prose-simple in V1; raw count + verbatim presentation, not weighted quorum |

### Trade-offs Considered

- **A — sync inline (chosen) vs B — fire-and-watch with file polling.** Fire-and-watch was rejected because it would require a `/council status` command, polling state, and a notification model — none needed when the user is present and waiting. The 600s blocking wait is acceptable for an explicitly-invoked heavyweight tool.
- **A — new plugin (chosen) vs B — extend yellow-codex vs C — yellow-core command.** Extending yellow-codex would entangle the "Codex is optional" story; yellow-core would drag binary deps into the foundation. New plugin is the only option that preserves both contracts.
- **B — explicit modes (chosen) vs A — mode-tagged freeform.** Mode inference was rejected because failure mode is silent ("council seems off-topic") and prompt design must be deterministic for V2's structured-output evolution.
- **A — inline synthesis + file (chosen) vs B — raw side-by-side vs C — inline only.** Synthesis is V2's swap surface — defining it in V1 means V2 just replaces logic, not also introducing synthesis. File write is the lowest-cost piece of the feature and provides V2's `/council history` foundation.

---

## Implementation Plan

### Phase 1: Discovery & Setup

- [ ] **1.1: Spike — Gemini `-o json` schema.** Run `gemini -o json "What is 2+2?"` against current Gemini CLI installation. Verify whether the flag now works (issue #9009 was P1, closed as duplicate Sept 2025) and document the actual response shape (`response` field? `messages[]`? error envelope?). If broken, fall through to `--output-format text` for V1. Output: `docs/spikes/gemini-cli-output-format-2026-05-03.md` with verbatim CLI output samples.
- [ ] **1.2: Spike — OpenCode `--format json` event stream.** Run `opencode run --format json "What is 2+2?"` and capture the full JSONL output. Document: which event types appear (`step_start` / `text` / `tool_use` / `step_finish` / `error`), how to extract the final assistant message (concatenate all `text` events vs last `text` before `step_finish`), and confirm the `sessionID` field is present in event 0 for cleanup. Output: `docs/spikes/opencode-cli-format-json-2026-05-03.md`.
- [ ] **1.3: Spike — OpenCode session cleanup.** Run `opencode run "test" --format json`, capture the session ID, then run `opencode session delete <id>`. Verify: does `opencode session list` confirm deletion? Is there a batch delete option for stale sessions? Document the cleanup contract in the same spike doc.
- [ ] **1.4: Spike — Gemini approval mode for read-only.** Run a benign read-only prompt against Gemini CLI WITHOUT `--yolo` (issue #13561 confirmed yolo still prompts in some cases). Document: does the default approval mode block the prompt waiting for input, or does a prompt that asks for analysis-only complete cleanly? If it blocks, document the exact non-interactive flag combination that works.
- [ ] **1.5: Plugin scaffold.** Create `plugins/yellow-council/` with the directory structure from brainstorm Decision 3 (lines 102–126). Files to create as empty stubs first:
  ```
  plugins/yellow-council/
    .claude-plugin/plugin.json
    agents/review/gemini-reviewer.md
    agents/review/opencode-reviewer.md
    commands/council/council.md
    skills/council-patterns/SKILL.md
    CLAUDE.md
    README.md
    package.json
    CHANGELOG.md
  ```
- [ ] **1.6: Manifest authoring.** Populate `plugins/yellow-council/.claude-plugin/plugin.json` and `plugins/yellow-council/package.json` mirroring the yellow-codex shape. Initial version: `0.1.0`. Required fields per `schemas/plugin.schema.json`: `name`, `version`, `description`, `author`. `repository` MUST be a string URL (not object). No `changelog` key.
- [ ] **1.7: Marketplace registration.** Append yellow-council entry to `.claude-plugin/marketplace.json`:
  ```json
  {
    "name": "yellow-council",
    "description": "On-demand cross-lineage code review fanning out to Codex, Gemini, and OpenCode CLIs in parallel.",
    "version": "0.1.0",
    "author": { "name": "KingInYellows" },
    "source": "./plugins/yellow-council",
    "category": "development"
  }
  ```
- [ ] **1.8: Catalog version bump.** Run `node scripts/catalog-version.js patch` to bump root `metadata.version`.
- [ ] **1.9: Changeset + initial CHANGELOG.md.** Two files in tandem:
  1. `.changeset/yellow-council-initial-release.md`:
     ```markdown
     ---
     "yellow-council": minor
     ---

     Initial release of yellow-council plugin: on-demand cross-lineage council command (`/council <mode>`) fanning out to Codex, Gemini, and OpenCode CLIs in parallel.
     ```
  2. `plugins/yellow-council/CHANGELOG.md` pre-populated with `# yellow-council` header + `## 0.1.0` block (see "Files to Create" annotation above for exact content). Empty CHANGELOG.md will produce malformed output on first `pnpm apply:changesets` run — yellow-codex precedent ships the file pre-populated.
- [ ] **1.10: W1.5 allowlist update.** Add `plugins/yellow-council/agents/review/gemini-reviewer.md` and `plugins/yellow-council/agents/review/opencode-reviewer.md` to `REVIEW_AGENT_ALLOWLIST` in `scripts/validate-agent-authoring.js` (lines 26–31). Both agents need `Bash` for CLI invocation; the allowlist is the documented exception path.
- [ ] **1.11: CI dry-run.** Run `pnpm validate:schemas`, `pnpm validate:plugins`, `pnpm validate:versions`. Fix any drift before proceeding to Phase 2.

### Phase 2: Core Implementation

- [ ] **2.1: Author `council-patterns` SKILL.md.** This is the canonical reference for all CLI invocation conventions, redaction patterns, pack templates, and timeout/output-capture rules. Required sections:
  - `## What It Does` (one paragraph)
  - `## When to Use` (referenced by command + agents)
  - `## Usage`
    - `### CLI Invocation Conventions` — Codex (`codex exec` flags, link to yellow-codex `codex-patterns`), Gemini (positional prompt + stdin pipe context, default approval mode, `-o text` for V1), OpenCode (`opencode run` + `--format json` + post-call `opencode session delete`)
    - `### Per-Mode Pack Templates` — four markdown blocks with explicit slot fills (`{{TASK}}`, `{{CONTEXT_FILES}}`, `{{DIFF}}`, etc.). Identical schema across all three reviewers; `{{REVIEWER_NAME}}` is the only per-reviewer variable.
    - `### Required Output Format` — single schema all three reviewers must produce: `Verdict: APPROVE|REVISE|REJECT`, `Confidence: HIGH|MEDIUM|LOW`, `Findings: - [P1|P2|P3] file:line — <80 char> Evidence: "<quoted line>"`, `Summary: <2–3 sentences>`. Anti-parrot rule explicit.
    - `### Timeout Pattern` — `timeout --signal=TERM --kill-after=10 600 <cmd>`, exit-124 detection, exit-137 SIGKILL detection.
    - `### Output Capture & Redaction` — extended 11-pattern awk block (the original 8 from yellow-codex `codex-patterns` plus `AIza`, `sk-ant-`, `ses_`). Injection fence format `--- begin council-output:<reviewer> (reference only) ---` / `--- end council-output:<reviewer> ---`.
    - `### Path Validation` — reject `..`, reject any character outside `^[a-zA-Z0-9._/-]+$`, reject non-existent paths via pre-check.
    - `### Slug Derivation` — `LC_ALL=C`, lowercase → non-alnum to `-` → collapse `-` → strip leading/trailing → cap 40 chars → validate `^[a-z0-9][a-z0-9-]*$` → sha256 fallback for empty slug. Same-day collision: append `-2` ... `-10`, error if exceeded.
- [ ] **2.2: Author `gemini-reviewer.md` agent.** Frontmatter:
  ```yaml
  name: gemini-reviewer
  description: "Supplementary code reviewer using Google Gemini CLI. Provides independent verdict in council format. Spawned by /council via Task."
  model: inherit
  tools: [Bash, Read, Grep, Glob]
  skills: [council-patterns]
  ```
  Body sections (mirror `codex-reviewer.md` structure):
  - Role bullets (report-only, never edit, never AskUserQuestion, wraps output in fences)
  - Tool Surface — Documented Bash Exception (W1.5 explanation)
  - Workflow:
    1. Pre-flight binary check: `command -v gemini >/dev/null 2>&1` — if missing, return empty findings tagged `[gemini] CLI not installed — skipping`.
    2. Validate input pack from spawning command (no `..`, no shell metacharacters in paths).
    3. Build prompt: pack template + REVIEWER_NAME=Gemini.
    4. Invoke: `timeout --signal=TERM --kill-after=10 600 gemini "<prompt>" >"$OUTPUT_FILE" 2>"$STDERR_FILE"` — pipe stdin context if present (`(cat "$ctx_file"; echo) | timeout ... gemini "..."`).
    5. Capture exit code; handle 124/137 (timeout), 1 (CLI error — grep stderr for `rate limit`/`auth`/`invalid`).
    6. Apply 11-pattern redaction to `$OUTPUT_FILE`.
    7. Wrap in injection fence: `--- begin council-output:gemini (reference only) --- ... --- end council-output:gemini ---`.
    8. Parse `Verdict:`, `Confidence:`, `Findings:`, `Summary:` lines via grep + awk. If `Verdict:` line absent, mark verdict `UNKNOWN` and include full output in summary.

       <!-- deepen-plan: codebase -->
       > **Codebase (2nd pass):** No existing reviewer in yellow-review or yellow-codex implements a `Verdict:` contract — the plan is defining a new structured-output convention. This means there's no precedent for re-prompting on parse failure (which would cost another 30–90s per reviewer and require conversational state across Task invocations). Stick with the documented "mark UNKNOWN" path. Concrete fallback semantics for V1:
       >
       > - `Verdict:` line absent → `verdict=UNKNOWN`, `confidence=LOW`
       > - Include the reviewer's full prose output (capped at 2K chars) in the synthesis report's raw section
       > - Surface a one-line warning in the synthesis Headline: `[gemini] Warning: no Verdict: line found in output — marked UNKNOWN`
       > - Do NOT count UNKNOWN verdicts toward the synthesis Headline majority computation (treat as missing reviewer for headline purposes; still surface findings prose in Disagreement section if any)
       >
       > **New acceptance criterion to add (AC 14):** When a reviewer's output does not contain a `Verdict:` line, the synthesizer marks that reviewer's verdict as `UNKNOWN` (not an error), logs a structured-output-failure warning in the Headline, and includes the reviewer's full prose output (capped at 2K chars) in the report's raw section.
       <!-- /deepen-plan -->
    9. Return structured findings to spawning command.
  - Cleanup: `rm -f "$OUTPUT_FILE" "$STDERR_FILE"`.
- [ ] **2.3: Author `opencode-reviewer.md` agent.** Same frontmatter shape as gemini-reviewer with `name: opencode-reviewer`. Workflow differences:
  - Pre-flight: `command -v opencode >/dev/null 2>&1`.
  - Invoke: `timeout 600 opencode run --format json --variant high "<prompt>" >"$OUTPUT_FILE" 2>"$STDERR_FILE"`. Default `--variant high` (not `max` — research showed max is significantly slower); env override `COUNCIL_OPENCODE_VARIANT`.
  - Extract session ID from first event in `$OUTPUT_FILE`: `SESSION_ID=$(jq -r 'select(.part.snapshot.sessionID) | .part.snapshot.sessionID' "$OUTPUT_FILE" | head -1)`.
  - Extract assistant text: `ASSISTANT_TEXT=$(jq -r 'select(.type=="text") | .part.text' "$OUTPUT_FILE" | tr -d '\000')` — concatenate all `text` events.
  - Check for `error` events FIRST: `jq -r 'select(.type=="error") | .error.data.message' "$OUTPUT_FILE"` — if non-empty, treat as reviewer failure and skip parsing.
  - Apply redaction to extracted text (NOT the raw JSONL — JSONL may contain `tool_use` events with embedded file content that includes credentials).
  - Cleanup session: `opencode session delete "$SESSION_ID" 2>/dev/null || true` — failure is logged but does not fail the review.
- [ ] **2.4: Author `commands/council/council.md`.** Frontmatter:
  ```yaml
  ---
  description: On-demand cross-lineage code review via Codex, Gemini, and OpenCode CLIs.
  argument-hint: <plan|review|debug|question> [args]
  allowed-tools:
    - Bash
    - Read
    - Grep
    - Glob
    - Task
    - AskUserQuestion
    - Write
  ---
  ```
  Body steps:
  1. **Argument parsing.** Parse `$ARGUMENTS` into mode + remaining args. If empty or unknown mode → print help (4 modes, one-line each) and exit. Reserve `fleet` mode word: print "fleet management not available in V1 — coming in V2" and exit.

     <!-- deepen-plan: codebase -->
     > **Codebase (2nd pass):** No existing yellow-* plugin reserves a subcommand word with a "coming in V2" stub — yellow-council is establishing this pattern. Concrete implementation:
     >
     > ```bash
     > case "$MODE" in
     >   plan|review|debug|question)
     >     # main logic continues
     >     ;;
     >   fleet)
     >     printf '[council] fleet management not available in V1 — coming in V2\n'
     >     exit 0
     >     ;;
     >   "")
     >     # bare /council — print help
     >     printf '[council] Usage: /council <mode> [args]\n'
     >     printf '  plan <path-or-text>             Council on a planning doc or design proposal\n'
     >     printf '  review [--base <ref>]           Council on the current diff\n'
     >     printf '  debug "<symptom>" [--paths]     Council on a debug investigation\n'
     >     printf '  question "<text>" [--paths]    Open-ended council consultation\n'
     >     exit 0
     >     ;;
     >   *)
     >     printf '[council] Error: unknown mode "%s"\n' "$MODE" >&2
     >     printf '[council] Valid modes: plan, review, debug, question\n' >&2
     >     exit 1
     >     ;;
     > esac
     > ```
     >
     > **Critical: `fleet` exits 0, not 1.** A reserved-but-deferred command is not an error — scripts that check exit codes should treat `fleet` as "intentionally no-op" not "invocation failed." Bare `/council` also exits 0 (help is success). Only unknown modes exit 1.
     >
     > **New acceptance criterion to add (AC 15):** `/council fleet` prints `[council] fleet management not available in V1 — coming in V2` and exits 0. No reviewer is spawned. `/council unknownmode` exits 1 with error + help. Bare `/council` exits 0 with help.
     <!-- /deepen-plan -->
  2. **Per-mode input validation.** `plan` requires path-or-text, `review` accepts optional `--base <ref>`, `debug` requires symptom + optional `--paths`, `question` requires text + optional `--paths`.

     <!-- deepen-plan: codebase -->
     > **Codebase (2nd pass):** Plan does not specify a default for `--base` when `/council review` is invoked without it. Use the same fallback as `codex-reviewer.md:98`:
     >
     > ```bash
     > BASE_REF="${BASE_REF:-$(git merge-base HEAD "origin/$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null | sed 's|.*/||' || echo 'main')")}"
     > ```
     >
     > Falls back to upstream-tracking-branch's merge-base; if no upstream, falls back to `origin/main`. Matches the established pattern; do not invent a different default.
     <!-- /deepen-plan -->
  3. **Path sanitization.** All `--paths` and `plan` file inputs validated via SKILL pattern (regex + `..` reject + existence check). Limit injected file content: 8K chars per file, 3 files max for V1. Configurable via `COUNCIL_PATH_CHAR_CAP` and `COUNCIL_PATH_MAX_FILES` env vars.
  4. **Pack build.** Read per-mode template from SKILL, fill slots, output to a single context string per reviewer. All three reviewers receive structurally-identical packs (only `{{REVIEWER_NAME}}` differs).
  5. **Parallel fan-out.** Spawn three reviewers:
     - Task spawn for Codex: `Task(subagent_type="yellow-codex:review:codex-reviewer", prompt="<pack>")`. If yellow-codex absent, the Task spawn fails — catch and mark Codex as `UNAVAILABLE (yellow-codex not installed)`. Use the work.md graceful-skip prose pattern.
     - Task spawn for Gemini: `Task(subagent_type="yellow-council:review:gemini-reviewer", prompt="<pack>")`.
     - Task spawn for OpenCode: `Task(subagent_type="yellow-council:review:opencode-reviewer", prompt="<pack>")`.
     - Spawn all three Tasks in a single message (parallel execution per Claude Code's tool-call concurrency).

     <!-- deepen-plan: codebase -->
     > **Codebase:** Earlier draft labeled Gemini/OpenCode rows as "Bash spawn" — corrected to "Task spawn." All three reviewers use the Task tool. Per-CLI bash invocation (`timeout 600 <cli> ...`) lives INSIDE each reviewer agent's body, not in council.md. Confirmed against `review-pr.md:392` parallelism pattern.
     <!-- /deepen-plan -->
  6. **Collect verdicts.** Each reviewer returns `verdict`, `confidence`, `findings[]`, `summary`, `raw_output_path`, `exit_status` (`OK` | `TIMEOUT` | `ERROR` | `UNAVAILABLE`).

     <!-- deepen-plan: codebase -->
     > **Codebase:** This return schema is **novel** — it does NOT match the existing yellow-review compact-return envelope (`{reviewer, findings[], residual_risks, testing_gaps}` per `plugins/yellow-review/skills/pr-review-workflow/SKILL.md:143-165`). That divergence is architecturally fine because council reviewers carry verdict/confidence semantics that yellow-review's PR-focused reviewers do not. The plan is defining a NEW contract specific to council, not "following an existing pattern." During implementation, ensure the schema is documented in `council-patterns/SKILL.md` so each reviewer agent can produce it consistently.
     <!-- /deepen-plan -->
  7. **Synthesis (V1 — simple).**
     - Headline: count verdicts. Format per brainstorm Decision 5 lines 167–171.
     - Agreement: dedupe findings by `<file>:<line>`. If ≥2 reviewers cite same coordinate, list once with each reviewer's phrasing.
     - Disagreement: findings unique to one reviewer; verdict conflicts at same coordinate.
     - Summary block: 2–3 sentences synthesizing the council's overall stance.
  8. **M3 confirmation gate.** AskUserQuestion: show resolved `$REPORT_PATH` + headline summary + options `[Save report]` / `[Cancel]`. Only "Save" proceeds. "Cancel" prints `[council] Report not saved.` and exits.
  9. **Atomic file write.** Compute slug per SKILL convention. `$REPORT_PATH = docs/council/$(date +%Y-%m-%d)-<mode>-<slug>.md`. Apply collision suffix loop (cap `-10`). Write to `${REPORT_PATH}.tmp.XXXXXX` via `mktemp` IN THE SAME DIRECTORY as destination (avoid cross-device EXDEV). Use Write tool to write the temp file. Then `mv` rename for atomicity.

     <!-- deepen-plan: codebase -->
     > **Codebase:** Two follow-ups before implementation:
     >
     > **1. .gitignore drift risk.** Root `.gitignore` ignores `*.tmp` (exact suffix), NOT `*.tmp.*` or `*.tmp.XXXXXX`. The proposed `${REPORT_PATH}.tmp.XXXXXX` pattern would NOT be caught by existing rules. If the same-dir mktemp pattern is kept, add `docs/council/*.tmp.*` to root `.gitignore` in this same PR.
     >
     > **2. Existing precedent diverges from this design.** No existing plugin writes temp files under `docs/`. Every existing `mktemp` in the codebase targets `/tmp/`: `codex-reviewer.md:121` (`mktemp /tmp/codex-reviewer-XXXXXX.txt`), `codex-executor.md:78`, `codex/review.md:91`. yellow-research `deep.md` and yellow-core `brainstorm-orchestrator.md` skip the temp-file stage entirely — both write directly to the final path via the Write tool (no atomicity, but matches the existing convention). Recommend two simpler alternatives:
     > - **Option A (matches all precedent):** `mktemp /tmp/council-XXXXXX.md`, write content, then `mv` to `docs/council/<final>.md`. Cross-device EXDEV is theoretically possible but extremely rare in WSL2/Linux dev environments where `/tmp` and the project share the filesystem.
     > - **Option B (matches brainstorm-orchestrator):** Use the Write tool directly to the final `docs/council/<final>.md` path, no temp file. Write tool failure leaves no partial file. This is what brainstorm-orchestrator does for an analogous single-file synthesis write. Lowest implementation cost.
     >
     > Recommend **Option B** for V1 — matches the closest precedent (brainstorm-orchestrator) and avoids the .gitignore concern entirely. Reserve atomic-write-via-rename for V2 if concurrent invocations become possible.
     <!-- /deepen-plan -->
  10. **Inline synthesis output.** Print synthesis report to user (Headline + Agreement + Disagreement + Summary). Reference the file path: "Full reviewer outputs: see `<REPORT_PATH>`". Do NOT paste raw reviewer outputs inline.
- [ ] **2.5: Author `CLAUDE.md`.** Sections per yellow-codex precedent: Core Principle ("Council is on-demand and advisory; never blocks merges"), Required Environment (Gemini CLI, OpenCode CLI, optional yellow-codex for Codex reviewer), Conventions (CLI invocation rules, redaction, fencing, sanitization), Plugin Components (1 command, 2 agents, 1 skill), Cross-Plugin Dependencies (yellow-codex optional), When to Use What, Known Limitations, **Configuration**.

  <!-- deepen-plan: codebase -->
  > **Codebase (2nd pass):** The `COUNCIL_*` env var prefix is correct — confirmed against the predominant convention (`CODEX_*`, `DEBT_*`, `DEVIN_*`, `MORPH_*`, `CI_*`, all using the SHORT plugin name without `yellow-` prefix). No correction needed.
  >
  > **Add a `## Configuration` section to CLAUDE.md** (yellow-codex documents `CODEX_MODEL` under "Model Selection" — yellow-council needs an analogous section since it has FOUR env vars). Required content:
  >
  > | Var | Type | Default | Purpose |
  > |-----|------|---------|---------|
  > | `COUNCIL_TIMEOUT` | integer seconds | `600` | Per-reviewer timeout passed to GNU `timeout`. Increase for very slow models / very large packs. |
  > | `COUNCIL_OPENCODE_VARIANT` | `high \| max \| minimal` | `high` | OpenCode `--variant` reasoning effort. `max` is significantly slower; reserve for `--verbose` mode. |
  > | `COUNCIL_PATH_CHAR_CAP` | integer chars | `8000` | Per-file content cap for `--paths` injection in `debug`/`question` modes. |
  > | `COUNCIL_PATH_MAX_FILES` | integer | `3` | Maximum number of files accepted via `--paths` in any single invocation. |
  >
  > Without a Configuration section, users will hit "why does the council take so long" or "why is OpenCode so slow" and have no documented knob to turn.
  <!-- /deepen-plan -->
- [ ] **2.6: Author `README.md`.** Standard structure: install via `/plugin marketplace add KingInYellows/yellow-plugins` then `/plugin install yellow-council@yellow-plugins`, four mode examples with sample output, link to brainstorm + plan.

### Phase 3: Edge Cases & Polish

- [ ] **3.1: Partial-result reporting on timeout.** If any reviewer exits 124/137, the synthesis must include `Council ran with N of 3 reviewers (<name> timed out at 600s — omitted from synthesis)`. The remaining reviewers' verdicts are still synthesized normally. Verify that the headline computation handles N<3 gracefully.
- [ ] **3.2: yellow-codex absent path.** If Codex reviewer is unavailable (Task spawn fails because plugin not installed), output reads `Council ran with 2 of 3 reviewers (Codex not available — yellow-codex plugin not installed)`. This is permanent V1 behavior — no fallback bundled Codex.
- [ ] **3.3: All-three-fail path.** If all three reviewers fail (timeout, missing CLI, or auth error), the synthesis report is `Council failed: 0 of 3 reviewers returned verdicts. See <REPORT_PATH> for individual failure details.` The file is still written with the failure details. The M3 gate still asks before write — user can cancel.
- [ ] **3.4: Bash 4.3+ check at command entry.** Pre-flight `bash --version | head -1 | grep -E 'version (4\.[3-9]|[5-9]\.)'` or equivalent. If older, print `[council] Error: bash 4.3+ required for parallel wait pattern` and exit. (WSL2 Ubuntu typically ships 5.1+; this is a defensive check.)
- [ ] **3.5: Same-day collision overflow.** If `<date>-<mode>-<slug>` collides 10 times in one day (unlikely but possible during testing), the suffix loop errors out: `[council] Error: too many same-day collisions for slug "<slug>" (>10)`. This matches brainstorm-orchestrator pattern.
- [ ] **3.6: Empty input rejection.** `/council debug ""` and `/council question ""` reject empty text. Print mode-specific usage and exit.
- [ ] **3.7: `--paths` cap enforcement.** If user passes `--paths file1,file2,file3,file4`, reject with `[council] Error: --paths limit is 3 files in V1 (got 4). Override via COUNCIL_PATH_MAX_FILES env var.`
- [ ] **3.8: File content cap enforcement.** Per file, truncate to 8K chars and append `\n[... truncated for council, original was N chars]`. Document in the pack template that truncation occurred.
- [ ] **3.9: Stale OpenCode session cleanup safety.** If `opencode session delete` fails, log to stderr but do not fail the review. Sessions accumulate but are not corruption-causing.
- [ ] **3.10: Redaction completeness audit.** Run a synthetic test: feed each CLI a prompt that asks it to output `sk-test-1234567890`, `AIza` + 35 chars, `sk-ant-test`, `ses_test123`, a fake PEM block, and a fake `Bearer` token. Verify all five appear redacted in the captured output. (Document test procedure in `docs/spikes/`.)

### Phase 4: Testing & Documentation

- [ ] **4.1: Manual end-to-end test — review mode.** On a small test branch with a known diff, run `/council review`. Verify all three reviewers return verdicts within 300 seconds. Verify report file is written. Verify M3 gate appears. Verify cancel path works.
- [ ] **4.2: Manual end-to-end test — plan mode.** Run `/council plan docs/brainstorms/2026-05-03-godmodeskill-integration-brainstorm.md` against this very plan's source. Verify reviewers produce thoughtful planning critiques.
- [ ] **4.3: Manual end-to-end test — debug mode.** Run `/council debug "TypeError: undefined is not a function" --paths plugins/yellow-codex/agents/review/codex-reviewer.md`. Verify debug-specific context (recent git log on cited paths) appears in pack.
- [ ] **4.4: Manual end-to-end test — question mode.** Run `/council question "Should yellow-council ship a bundled Codex fallback when yellow-codex is absent?"`. This is meta — the council answers a question about itself. Useful as a smoke test for question mode.
- [ ] **4.5: Manual timeout test.** Set `COUNCIL_TIMEOUT=10` and run `/council review` against a large diff. Verify all three reviewers timeout and report partial results (or zero results) without crashing.
- [ ] **4.6: Manual yellow-codex absent test.** Temporarily disable yellow-codex (rename its `plugin.json`), run `/council review`. Verify the report shows "Codex not available" without erroring the whole council.
- [ ] **4.7: Documentation update — root README.md.** Add yellow-council to the plugin list (currently 16 plugins → 17). Update if the README has a count mismatch.
- [ ] **4.8: Documentation update — plugin CLAUDE.md polish.** Review for completeness against yellow-codex's CLAUDE.md as the gold standard.
- [ ] **4.9: CI green confirmation + fresh-machine install test.** `pnpm validate:schemas`, `pnpm validate:plugins`, `pnpm validate:versions`, `pnpm validate:agents` all pass. Local CI passes does NOT guarantee Claude Code's remote validator accepts the plugin (per MEMORY.md `Claude Code Plugin Manifest Validation Errors`) — perform the 8-step fresh-machine install test below before declaring the PR mergeable:

  <!-- deepen-plan: codebase -->
  > **Codebase (2nd pass):** No CI job exists in `.github/workflows/` for fresh-machine plugin install testing. There is no `pnpm test:install` script, no `claude plugin install` step in any workflow, and no automated verification that Claude Code's runtime accepts the manifest. Fresh-install testing is necessarily manual. Concrete 8-step procedure:
  >
  > ```
  > 1. Open a NEW Claude Code session (fresh context, no cached plugin state).
  > 2. Verify yellow-council is NOT already installed:
  >      /plugin list
  >      # yellow-council should not appear
  > 3. Add the marketplace (if not already added):
  >      /plugin marketplace add KingInYellows/yellow-plugins
  >      # Must succeed without error
  > 4. Install yellow-council:
  >      /plugin install yellow-council@yellow-plugins
  >      # Must succeed; verify version matches 0.1.0
  > 5. Confirm command surfaces (BLOCKING):
  >      /council
  >      # Expected: 4-mode help table; exit 0
  > 6. Confirm fleet reservation (BLOCKING):
  >      /council fleet
  >      # Expected: "fleet management not available in V1 — coming in V2"; exit 0
  > 7. Confirm unknown mode (advisory):
  >      /council unknownmode
  >      # Expected: error + help; exit 1
  > 8. Spot-check agent wiring (advisory; requires gemini or opencode installed):
  >      /council question "What is 2+2?"
  >      # Expected: synthesis report with at least one reviewer responding
  > ```
  >
  > Steps 5 and 6 are blocking — they verify the manifest is parseable and the command + reserved-word handling work end-to-end. Steps 7 and 8 are advisory but recommended. Document the 8-step results in the PR description before requesting review.
  <!-- /deepen-plan -->
- [ ] **4.10: Compound learnings.** After PR merge, run `/workflows:compound` to capture: any spike findings that contradicted research; any redaction patterns discovered missing during testing; the final per-reviewer timing data (P50/P95) for post-V1 timeout tuning.

---

## Technical Specifications

### Files to Create

| Path | Purpose |
|------|---------|
| `plugins/yellow-council/.claude-plugin/plugin.json` | Plugin manifest (schema-validated) |
| `plugins/yellow-council/package.json` | Changesets version source |
| `plugins/yellow-council/CHANGELOG.md` | Pre-populated with header + v0.1.0 entry at PR creation; later versions appended by changesets |

<!-- deepen-plan: codebase -->
> **Codebase:** Earlier draft said "Empty initially; populated by changesets" — that is **wrong**. yellow-codex's initial commit (`4f5cfff6`) included a hand-written CHANGELOG.md with `# yellow-codex` header + `## 0.1.0` block + `### Minor Changes` + initial release line. Changesets generates entries on `pnpm apply:changesets` runs, but it prepends to the existing file — if the file is empty, the result is malformed (no plugin-name header). Pre-populate at PR creation per yellow-codex precedent:
>
> ```markdown
> # yellow-council
>
> ## 0.1.0
>
> ### Minor Changes
>
> - Initial release: on-demand cross-lineage council command (`/council <mode>`) fanning out to Codex, Gemini, and OpenCode CLIs in parallel.
> ```
<!-- /deepen-plan -->
| `plugins/yellow-council/CLAUDE.md` | Plugin-local agent context |
| `plugins/yellow-council/README.md` | User-facing install + usage docs |
| `plugins/yellow-council/commands/council/council.md` | The `/council` command body |
| `plugins/yellow-council/agents/review/gemini-reviewer.md` | Gemini CLI wrapper agent |
| `plugins/yellow-council/agents/review/opencode-reviewer.md` | OpenCode CLI wrapper agent |
| `plugins/yellow-council/skills/council-patterns/SKILL.md` | Shared invocation conventions, pack templates, redaction, slug rules |
| `.changeset/yellow-council-initial-release.md` | Required changeset for new plugin |
| `docs/spikes/gemini-cli-output-format-2026-05-03.md` | Spike output (Phase 1.1) |
| `docs/spikes/opencode-cli-format-json-2026-05-03.md` | Spike output (Phase 1.2 + 1.3) |

### Files to Modify

| Path | Change |
|------|--------|
| `.claude-plugin/marketplace.json` | Append `yellow-council` entry to `plugins` array; bump `metadata.version` |
| `scripts/validate-agent-authoring.js` | Add yellow-council reviewers to `REVIEW_AGENT_ALLOWLIST` (lines 26–31) |
| `README.md` (root) | Update plugin count from `14 plugins` to `17 plugins`. (Verified: marketplace.json has 16 plugins; root README line 2 is already drifted from 14 → 16; yellow-council makes 17.) |

<!-- deepen-plan: codebase -->
> **Codebase (2nd pass):** Verified counts: `jq '.plugins | length' .claude-plugin/marketplace.json` returns 16; root README.md line 2 still says "14 plugins" (drifted by 2 already, separate from this PR). yellow-council makes 17. The plan's Files-to-Modify text was previously ambiguous about which number to use as the starting point — corrected above. Recommend the README update edit go from `14 plugins` → `17 plugins` (skip the intermediate `16`; one edit, not two).
<!-- /deepen-plan -->

### Dependencies

- **System tools (must be present at runtime):** `bash` 4.3+, `timeout` (GNU coreutils), `awk`, `sed`, `grep`, `jq`, `mktemp`, `mv`, `command`. All standard on Linux/WSL2/macOS.
- **External CLIs (user-installed; soft-skipped if missing):** `gemini`, `opencode`. (`codex` is reused via `yellow-codex` plugin; not a direct dep of yellow-council.)
- **Cross-plugin (optional):** `yellow-codex` ≥ 0.2.0 — provides the `yellow-codex:review:codex-reviewer` agent. If absent, council runs with 2 of 3 reviewers.
- **No npm dependencies.** All logic is bash + markdown.

### CLI Invocation Specs

**Codex (via yellow-codex Task spawn):**
```
Task(subagent_type="yellow-codex:review:codex-reviewer", prompt="<pack>")
```
Pack must include: mode, task, context blocks, required output schema. Codex's existing review pipeline handles the rest. If yellow-codex absent, mark UNAVAILABLE.

<!-- deepen-plan: codebase -->
> **Codebase:** The existing `codex-reviewer.md` uses `timeout --signal=TERM --kill-after=10 300` (5 minutes). yellow-council uses 600s (10 minutes) — deliberate difference because council is user-invoked and heavier than the in-pipeline review. The codex-reviewer agent spawned via Task will respect its OWN 300s timeout, NOT council's 600s. If a council invocation needs Codex to honor a longer timeout, the spawning Task would need to pass an override prompt-time flag — which yellow-codex does not currently expose. For V1, accept that Codex caps at 300s when invoked via the existing reviewer; if Codex routinely times out at 300s for council use, file a yellow-codex enhancement issue to add a `COUNCIL_TIMEOUT_OVERRIDE` knob. Do NOT modify codex-reviewer.md as part of this PR.
<!-- /deepen-plan -->

**Gemini (direct bash):**
```bash
timeout --signal=TERM --kill-after=10 "${COUNCIL_TIMEOUT:-600}" \
  gemini -p "<prompt>" --approval-mode plan --skip-trust -o text \
  >"$OUTPUT_FILE" 2>"$STDERR_FILE" &
```
With stdin context:
```bash
( printf '%s\n\n' "$context_block"; printf '%s' "$prompt" ) | \
  timeout --signal=TERM --kill-after=10 "${COUNCIL_TIMEOUT:-600}" \
  gemini -p "<prompt>" --approval-mode plan --skip-trust -o text \
  >"$OUTPUT_FILE" 2>"$STDERR_FILE" &
```
**`-p` / `--prompt` is REQUIRED** for non-interactive mode in v0.40+; positional `gemini "<prompt>"` defaults to TUI and hangs in non-TTY contexts (verified 2026-05-04 spike). **Do NOT use `--yolo` / `--approval-mode yolo`** (issue #13561 — still prompts in some cases; safety risk for read-only review). Use `-o text` for V1 — `-o json` was fixed in v0.40+ per issue #9009, but the structured-output schema is not yet stable; defer to V2. See `docs/spikes/gemini-cli-output-format-2026-05-04.md`.

**OpenCode (direct bash):**
```bash
timeout --signal=TERM --kill-after=10 "${COUNCIL_TIMEOUT:-600}" \
  opencode run --format json --variant "${COUNCIL_OPENCODE_VARIANT:-high}" "<prompt>" \
  >"$OUTPUT_FILE" 2>"$STDERR_FILE" &
```
Post-call cleanup:
```bash
SESSION_ID=$(jq -r 'first(.part.snapshot.sessionID // empty)' "$OUTPUT_FILE" 2>/dev/null)
[ -n "$SESSION_ID" ] && opencode session delete "$SESSION_ID" 2>/dev/null || \
  printf '[council] Warning: failed to delete OpenCode session %s\n' "$SESSION_ID" >&2
```
Final assistant message extraction:
```bash
ASSISTANT_TEXT=$(jq -r 'select(.type=="text") | .part.text' "$OUTPUT_FILE" | tr -d '\000')
```

**Parallel wait pattern (location correction):**

<!-- deepen-plan: codebase -->
> **Codebase:** Earlier draft placed the multi-PID `wait "$pid"` loop in `council.md`. That is **incorrect**. council.md does not invoke CLIs directly — it spawns three Task agents and Claude Code's harness runs them concurrently. The bash multi-PID wait pattern is unnecessary at the orchestrator level. **Each reviewer agent (gemini-reviewer.md, opencode-reviewer.md) spawns ONE CLI subprocess, so even within an agent body there's no need for a multi-PID wait loop — a simple `timeout ... <cli> ... > "$outfile" 2>&1` (no backgrounding) is sufficient.** The `&` and `wait "$pid"` machinery is only required if a single agent ever spawns multiple subprocesses, which V1 does not.
>
> The actual orchestrator-level "fan-out" in council.md is:
>
> ```
> # In a single message, three Task tool calls:
> Task(subagent_type="yellow-codex:review:codex-reviewer", prompt=$PACK)
> Task(subagent_type="yellow-council:review:gemini-reviewer", prompt=$PACK)
> Task(subagent_type="yellow-council:review:opencode-reviewer", prompt=$PACK)
> # Claude Code runs all three in parallel; council.md collects their return values after all complete.
> ```
>
> Each agent then runs (synchronously inside its own context):
>
> ```bash
> OUTPUT_FILE=$(mktemp /tmp/council-<reviewer>-XXXXXX.txt)
> STDERR_FILE=$(mktemp /tmp/council-<reviewer>-err-XXXXXX.txt)
> timeout --signal=TERM --kill-after=10 "${COUNCIL_TIMEOUT:-600}" \
>   <cli-invocation> >"$OUTPUT_FILE" 2>"$STDERR_FILE"
> CLI_EXIT=$?
> # parse, redact, fence, return structured findings
> rm -f "$OUTPUT_FILE" "$STDERR_FILE"
> ```
<!-- /deepen-plan -->

(Codex's exit status comes from the `yellow-codex:review:codex-reviewer` Task return; Gemini and OpenCode exit statuses come from their respective agent Task returns.)

### Redaction Pattern Set (extends yellow-codex's 8 patterns)

```awk
# Existing 8 (from yellow-codex codex-patterns SKILL.md):
/sk-proj-[A-Za-z0-9_-]{20,}/        # OpenAI project key
/sk-[A-Za-z0-9]{20,}/               # OpenAI legacy key
/gh[pous]_[A-Za-z0-9]{36,}/         # GitHub PAT prefix variants
/github_pat_[A-Za-z0-9_]{40,}/      # GitHub fine-grained PAT
/AKIA[0-9A-Z]{16}/                  # AWS Access Key ID
/Bearer [A-Za-z0-9._~+\/-]{20,}/    # Bearer tokens
/Authorization: [A-Za-z0-9 ._~+\/-]{20,}/  # Auth header
/-----BEGIN [A-Z ]+PRIVATE KEY-----/  # PEM key block (multi-line state)

# yellow-council additions (from research findings):
/AIza[0-9A-Za-z_-]{35}/             # Google API key (Gemini)
/sk-ant-[A-Za-z0-9_-]{20,}/         # Anthropic API key (OpenCode may use)
/ses_[A-Za-z0-9]{16,}/              # OpenCode session IDs
```

Each match line is replaced with `--- redacted credential at line N ---`.

### Per-Mode Pack Templates (in `council-patterns` SKILL)

All four modes share this structural envelope; only the `## Task` block differs:

```
You are {{REVIEWER_NAME}}, a code reviewer performing an INDEPENDENT analysis.
Do not reference what other reviewers might say. Only report findings you can
cite with a file:line reference. Do not write any files; analyze only.

## Task: {{MODE}}
{{MODE_SPECIFIC_CONTEXT}}

## Required Output Format
Verdict: APPROVE | REVISE | REJECT
Confidence: HIGH | MEDIUM | LOW
Findings:
- [P1|P2|P3] file:line — <80-char summary>
  Evidence: "<exact quoted line from file>"
[repeat per finding; if none: write "Findings: none"]
Summary: <2–3 sentences in your own words>

## Rules
- P1 = security/correctness blocker; P2 = quality issue; P3 = style/nit
- Cite file paths relative to repository root
- If a finding has no quotable line (e.g., "missing function"), write `Evidence: N/A — <reason>`
- The `Verdict:` line is required and must appear exactly as shown
```

Per-mode `{{MODE_SPECIFIC_CONTEXT}}` block:

| Mode | Context block contents |
|------|------------------------|
| `plan` | `### Planning Document` + fenced full content + `### Repo Conventions` + truncated CLAUDE.md |
| `review` | `### Diff (HEAD vs <BASE>)` + fenced `git diff` output + `### Changed Files` + truncated content of each |

<!-- deepen-plan: codebase -->
> **Codebase (2nd pass):** Plan body says "truncation guards from `work-pack-build` pattern" but never specifies the algorithm. The only existing diff-size pattern in the repo is `codex-reviewer.md:101-116` — a pre-flight `wc -c` check that estimates tokens at 4 bytes/token and SKIPS the reviewer entirely if estimate exceeds 100K tokens (no head/tail truncation, no per-file cap). yellow-council needs a real truncation algorithm because skipping is unacceptable for the council use case (user explicitly asked for cross-lineage input).
>
> **V1 algorithm to specify in `council-patterns` SKILL "Pack Build — Review Mode":**
>
> ```
> 1. DIFF_BYTES=$(git diff "${BASE_REF}...HEAD" | wc -c)
> 2. If DIFF_BYTES > 200000 (≈50K tokens at 4 bytes/token):
>    a. Inject `git diff --stat` output as the diff header
>    b. Append first 200 lines of raw `git diff`
>    c. Append marker: "[... truncated — full diff is N lines; showing first 200 ...]"
> 3. Per changed file injected into ## Changed Files: cap at 4K chars per file
> 4. Total pack hard cap: 100K chars before injection fencing
>    (drives under Codex's 128K token budget with ~22% headroom; Gemini 1M and OpenCode are larger so this is the binding constraint)
> ```
>
> Designing to Codex's tightest window means all three reviewers receive identical packs. Gemini and OpenCode could handle larger packs but uniformity > capacity for synthesis comparability.
>
> **New acceptance criterion to add (AC 13):** When `git diff` for a `review` mode invocation exceeds 200K bytes, the injected diff block contains `git diff --stat` + first 200 lines of raw diff + a truncation marker; each changed file is capped at 4K chars; total pack fits within 100K chars.
<!-- /deepen-plan -->
| `debug` | `### Symptom` + user text + `### Cited Files` + content + `### Recent History` + `git log -10 --oneline -- <paths>` |
| `question` | `### Question` + user text + (optional) `### Referenced Files` + content + `### Repo Conventions` + truncated CLAUDE.md |

---

## Testing Strategy

- **Unit testing:** N/A — bash command + agent files. Validation is via the existing `pnpm validate:*` scripts plus manual smoke tests.
- **Integration testing:** Phase 4.1–4.6 manual smoke tests. Run each mode end-to-end with both happy-path and failure-path scenarios.
- **Spike-driven verification:** Phase 1.1–1.4 spikes are themselves tests of the upstream CLI behavior. Their findings update this plan before Phase 2 begins.
- **CI gates:** All four `pnpm validate:*` scripts must pass; changeset present; W1.5 allowlist updated.
- **Cross-platform:** WSL2/Linux is the primary target. macOS should work (same `bash`/`timeout`/`jq`). Windows native is not supported (no `bash` in default env).

---

## Acceptance Criteria

1. **`/council` is a registered command** discoverable via `/plugin install yellow-council@yellow-plugins` and surfaces in Claude Code's command list.
2. **All four modes produce a synthesis report inline** when invoked with valid inputs and external CLIs are present (verifiable via Phase 4.1–4.4).
3. **Synthesis report format matches Decision 5 spec:** Headline + Agreement + Disagreement + reference to file path. No raw reviewer outputs inline.
4. **File at `docs/council/<date>-<mode>-<slug>.md`** is written after M3 confirmation, contains synthesis report + three labeled raw output sections with injection fences (verifiable via Phase 4.1).
5. **Per-reviewer timeout enforced:** A reviewer exceeding `${COUNCIL_TIMEOUT:-600}` seconds is marked TIMEOUT and excluded from synthesis (verifiable via Phase 4.5).
6. **Partial-result tolerance:** If 1 or 2 of 3 reviewers fail (timeout, missing CLI, error), the council still produces a report with the remaining verdicts (verifiable via Phase 4.5 + 4.6).
7. **yellow-codex graceful soft-skip:** When yellow-codex is not installed, `/council review` reports "Codex not available" and runs with 2 of 3 reviewers without erroring (verifiable via Phase 4.6).
8. **All credential patterns redacted:** None of the 11 credential patterns appear unredacted in the written report file (verifiable via Phase 3.10).
9. **Path sanitization rejects malicious input:** `/council debug "test" --paths "../../etc/passwd"` is rejected with a sanitization error (manual test).
10. **M3 gate prevents accidental writes:** Selecting `[Cancel]` at the M3 gate prevents the file write and exits cleanly (verifiable via Phase 4.1).
11. **All `pnpm validate:*` scripts pass** with the new plugin in place.
12. **Three-way version sync** between `package.json`, `plugin.json`, and `marketplace.json` for `yellow-council`.

<!-- deepen-plan: codebase -->
> **Codebase (2nd pass):** Three additional acceptance criteria added from second-pass research findings — these cover gaps in structured-output failure handling, the diff-truncation algorithm, and the V2 reservation pattern.
<!-- /deepen-plan -->

13. **Diff truncation for large `review` invocations:** When `git diff` exceeds 200K bytes, the injected diff block contains `git diff --stat` + first 200 lines of raw diff + a truncation marker; each changed file is capped at 4K chars; total pack fits within 100K chars. Verifiable via Phase 4.5 with a synthetic large-diff test.
14. **`UNKNOWN` verdict on structured-output failure:** When a reviewer's output does not contain a `Verdict:` line, the synthesizer marks that reviewer's verdict as `UNKNOWN` (not an error), logs a structured-output-failure warning in the synthesis Headline, and includes the reviewer's full prose output (capped at 2K chars) in the report's raw section. UNKNOWN verdicts are excluded from headline majority count. Verifiable via a synthetic test where the prompt asks the reviewer to "answer in haiku" instead of structured form.
15. **`fleet` reservation:** `/council fleet` prints `[council] fleet management not available in V1 — coming in V2` and exits 0 (success). No reviewer is spawned. `/council unknownmode` exits 1. Bare `/council` exits 0 with help. Verifiable via Phase 4.9 fresh-install test steps 5 and 6.

---

## Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| Bare `/council` (no mode) | Print 4-mode help table and exit 0 |
| `/council fleet` | Print "fleet management not available in V1 — coming in V2" and exit 0 (reserves the word for V2) |
| `/council unknown-mode` | Print error + 4-mode help and exit 1 |
| Path with `..` traversal | Reject with `[council] Error: path traversal not allowed` |
| Path with shell metacharacters | Reject with `[council] Error: invalid characters in path` |
| Missing path in `--paths` | Reject with `[council] Error: file not found: <path>` |
| Empty `debug`/`question` text | Reject with mode-specific usage |
| Reviewer timeout (exit 124/137) | Mark TIMEOUT in synthesis; exclude from agreement/disagreement; report ran with N<3 |
| Reviewer auth error (stderr keyword `auth`) | Mark ERROR in synthesis; include short error excerpt |
| Reviewer rate limit (stderr keyword `rate limit`) | Mark ERROR; suggest retry in synthesis prose |
| All three reviewers fail | Write report with all-failure details; M3 gate still asks |
| Slug collision >10 same-day | Error: `too many same-day collisions for slug "<slug>" (>10)` |
| Empty slug after normalization | Use sha256 fallback (debt-synthesizer pattern) |
| `bash` < 4.3 | Pre-flight error and exit |
| `jq` missing | Pre-flight error: required for OpenCode JSON parsing |
| `timeout` missing | Pre-flight error: required for per-reviewer timeout |
| OpenCode session cleanup fails | Log warning to stderr; do not fail review |
| `docs/council/` not writable | `mkdir -p` fails with explicit error |
| Cross-device temp file | Avoided by `mktemp` in same dir as destination |

---

## Performance Considerations

- **Total wall time per `/council` invocation:** ≈ max(t_codex, t_gemini, t_opencode). Empirical estimates from research: 60–180 seconds for moderate inputs; up to 600 seconds at the timeout cap.
- **Subprocess overhead:** negligible (3 short-lived bash processes + 3 CLI invocations).
- **Memory:** each CLI may consume 100–500 MB transiently; total peak around 1.5 GB during fan-out.
- **Disk:** temp files in `/tmp` (cleaned up after parse); single report file per invocation in `docs/council/` (~10–100 KB each).
- **Network:** each CLI makes its own provider API call. Concurrent calls may hit per-provider rate limits — partial-result reporting handles this gracefully.

No optimization is needed for V1. If repeat invocations become common, V2's persistent-session model amortizes per-invocation startup cost.

---

## Security Considerations

- **No auth handling in plugin.** Each CLI uses its own credential store (Codex uses `OPENAI_API_KEY` or `~/.codex/auth.json`; Gemini uses Google auth; OpenCode uses provider-configured creds). yellow-council never reads, writes, or transports credentials.
- **Output redaction is mandatory.** Even if the CLIs do not echo credentials in their primary output, error messages, debug logs, and `tool_use` event payloads in OpenCode's JSON stream may contain them. The 11-pattern awk block runs on every reviewer output before fencing.
- **Injection fencing is mandatory.** All reviewer output is wrapped in `--- begin council-output:<reviewer> (reference only) ---` / `--- end council-output:<reviewer> ---` fences before being included in the report file or surfaced inline. This prevents the council report itself from being weaponized as a prompt-injection vector for downstream consumers.
- **Path validation rejects traversal and metacharacters.** All file paths derived from user input pass through the SKILL's path-validation pattern before being constructed into shell arguments.
- **No `--yolo` / `--dangerously-skip-permissions` flags.** Both Gemini and OpenCode have flags that auto-approve all tool calls including file writes. yellow-council does NOT use these flags. Read-only behavior is enforced via prompt design ("do not write any files; analyze only") not via CLI flags.
- **OpenCode session cleanup.** Persistent sessions in `~/.local/share/opencode/` are explicitly deleted after each invocation. Failure to clean up is logged but does not fail the review (sessions accumulate but are not corruption-causing).
- **`tool_use` event redaction in OpenCode.** OpenCode's `--format json` event stream may contain `tool_use` events whose `part.state.input` and `part.state.output` fields embed full file contents read by the assistant. Redaction is applied to the EXTRACTED assistant text, not just the raw JSONL — but the JSONL itself is never written to the report file. Only the extracted text + injection fence makes it to disk.
- **No exposure of internal reasoning.** Gemini's `--variant` and reasoning chains are NOT included in the report. Only the final assistant text plus structured verdict/findings/summary fields.

---

## V2 Trajectory — Constraints V1 Must Preserve

V2 will evolve toward GodModeSkill's native model. V1 design choices that protect V2:

1. **`council-patterns` SKILL is the swap surface for the XML evidence contract.** V2 replaces the markdown `Verdict: ... Findings: ...` template with GodModeSkill's `<file-path>` / `<line-number>` / `<quoted-line><![CDATA[...]]></quoted-line>` XML. No agent code changes.
2. **Synthesizer logic is isolated in `council.md` Step 7.** V2 swaps Step 7 with lineage-weighted quorum aggregation + quote-verification pass. Fan-out, pack-build, and output-capture stages stay unchanged.
3. **Mode word `fleet` is reserved.** V2 adds `/council fleet status`, `/council fleet restart`. V1's reservation prevents naming conflict.
4. **Per-reviewer timeout + partial-result collection are isolated in SKILL.** V2 swaps subprocess-with-timeout for `inotifywait`-style event-driven waiting on `## DONE` markers. The collection logic (which reviewers returned, which timed out, how to format partial results) is re-used as-is.
5. **Multi-round support via `--round 2` flag.** V1 single-shot semantics. V2 adds a flag that injects V1 output as prior context with round-aware trimming. The pack-build stage is the only thing that changes.

---

## Open Questions Resolved by Research

The brainstorm listed 7 open questions. Research outcomes:

1. **Soft-skip vs minimal Codex bundle.** **Resolved: soft-skip permanent.** Bundling a fallback Codex would mean maintaining two parallel Codex implementations. yellow-codex is the canonical Codex integration; if user wants Codex in council, they install yellow-codex. Plan documents this in CLAUDE.md.

2. **Gemini `-o json` schema.** **Resolved: do NOT use in V1.** Issue #9009 confirmed `-o json` was broken upstream; closed-as-duplicate suggests recurring. Phase 1.1 spike verifies current state on this machine; default is plain text capture for V1.

3. **OpenCode `--format json` event schema.** **Resolved: confirmed.** `text` events with `part.text` field; concatenate all `text` events for final assistant message. `step_finish` with `reason: "stop"` indicates terminal response. Phase 1.2 spike verifies live; jq selector documented in agent body.

4. **`--paths` content cap.** **Resolved: 8K chars per file, 3 files max for V1.** Configurable via env vars `COUNCIL_PATH_CHAR_CAP` and `COUNCIL_PATH_MAX_FILES`.

5. **Slug derivation for `/council plan <path>`.** **Resolved: filename stem when input is a path; first N words of leading heading when input is text.** Implementation in council.md Step 9: `if [ -f "$INPUT" ]; then SLUG_BASE=$(basename "$INPUT" .md); else SLUG_BASE=$(printf '%s' "$INPUT" | head -c 80); fi` then normalize.

6. **`plugin.json` `optionalDependencies`.** **Resolved: not in current schema.** yellow-codex's cross-plugin dep is documentation-only. yellow-council follows the same pattern: CLAUDE.md "Cross-Plugin Dependencies" table marks yellow-codex as `Optional`; runtime soft-skip on Task spawn failure.

7. **Credential redaction scope for Gemini and OpenCode.** **Resolved: extend the 8-pattern awk block to 11 patterns** with `AIza` (Google), `sk-ant-` (Anthropic), `ses_` (OpenCode session IDs). Apply to extracted assistant text for OpenCode (JSONL never written to disk).

---

## References

### Plan and Brainstorm
- [GodModeSkill Integration Brainstorm (2026-05-03)](../docs/brainstorms/2026-05-03-godmodeskill-integration-brainstorm.md)
- [GodModeSkill Integration Investigation](../research/GodModeSkill%20Integration%20Investigation.md)

### Repository Patterns to Mirror
- [yellow-codex plugin manifest](../plugins/yellow-codex/.claude-plugin/plugin.json)
- [yellow-codex package.json](../plugins/yellow-codex/package.json)
- [yellow-codex CHANGELOG.md](../plugins/yellow-codex/CHANGELOG.md)
- [yellow-codex CLAUDE.md](../plugins/yellow-codex/CLAUDE.md)
- [codex-reviewer agent (binary check, timeout, redaction precedent)](../plugins/yellow-codex/agents/review/codex-reviewer.md)
- [codex-patterns SKILL (8-pattern awk redaction, exit code catalog)](../plugins/yellow-codex/skills/codex-patterns/SKILL.md)
- [Plugin schema](../schemas/plugin.schema.json)
- [Marketplace JSON](../.claude-plugin/marketplace.json)
- [W1.5 agent allowlist](../scripts/validate-agent-authoring.js)
- [pr-review-workflow SKILL (cross-plugin Task spawn pattern)](../plugins/yellow-review/skills/pr-review-workflow/SKILL.md)
- [yellow-core work.md (graceful-skip prose)](../plugins/yellow-core/commands/workflows/work.md)
- [brainstorm-orchestrator (slug + collision + AskUserQuestion gate precedent)](../plugins/yellow-core/agents/workflow/brainstorm-orchestrator.md)
- [yellow-research deep.md (slug pattern)](../plugins/yellow-research/commands/research/deep.md)
- [audit-synthesizer (sha256 fallback for empty slug)](../plugins/yellow-debt/agents/synthesis/audit-synthesizer.md)

### External Documentation
- [GodModeSkill repo (commit b693d1d)](https://github.com/99xAgency/GodModeSkill/tree/b693d1da498cbcfc2e5cba1f85b3d341205bfeb0)
- [Gemini CLI Headless Mode docs](https://google-gemini.github.io/gemini-cli/docs/cli/headless.html)
- [Gemini CLI issue #9009 — `-o json` broken](https://github.com/google-gemini/gemini-cli/issues/9009)
- [Gemini CLI issue #13561 — yolo still prompts](https://github.com/google-gemini/gemini-cli/issues/13561)
- [OpenCode CLI docs](https://opencode.ai/docs/cli/)
- [OpenCode `--format json` event schema (community cheatsheet)](https://takopi.dev/reference/runners/opencode/stream-json-cheatsheet/)
- [OWASP LLM01:2025 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [GNU `timeout` man page](https://www.man7.org/linux/man-pages/man1/timeout.1.html)
- [POSIX `rename()` specification](https://pubs.opengroup.org/onlinepubs/9699919799/functions/rename.html)
- [Kinde LLM Fan-Out 101](https://www.kinde.com/learn/ai-for-software-engineering/workflows/llm-fan-out-101-self-consistency-consensus-and-voting-patterns/)

### MEMORY.md Conventions Applied
- Shell script security patterns (PR #5, #10) — path validation, printf safety, symlink skipping
- Bash hook patterns (PR #10, #73, #74) — jq @sh consolidation, exit-code fallback, jq variant check
- Command authoring anti-patterns (PR #35, #71, #74) — ToolSearch in allowed-tools, subagent_type literal, AskUserQuestion for mid-step input, M3 before bulk writes (no threshold)
- Plugin manifest validation (2026-02-18, PR #66) — repository as string, no `changelog` key, no unknown keys
- Plugin authoring quality rules — single-line description in frontmatter, three SKILL.md headings, LF line endings
- Heredoc delimiter collision (P1 from session) — use `__EOF_<CONTEXT>__` style for any user-input heredocs

---

## Stack Decomposition

<!-- stack-trunk: main -->
<!-- stack-topology: linear -->

### 1. agent/feat/yellow-council-scaffold-and-spikes
- **Type:** feat
- **Description:** plugin scaffold, manifests, and CLI spikes
- **Scope:** plugins/yellow-council/.claude-plugin/plugin.json, plugins/yellow-council/package.json, plugins/yellow-council/CHANGELOG.md (pre-populated v0.1.0), plugins/yellow-council/CLAUDE.md (skeleton), plugins/yellow-council/README.md (skeleton), .claude-plugin/marketplace.json, .changeset/yellow-council-initial-release.md, scripts/validate-agent-authoring.js, docs/spikes/gemini-cli-output-format-2026-05-04.md, docs/spikes/opencode-cli-format-json-2026-05-04.md
- **Tasks:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11
- **Depends on:** (none)

### 2. agent/feat/yellow-council-core-implementation
- **Type:** feat
- **Description:** council-patterns skill, reviewer agents, /council command
- **Scope:** plugins/yellow-council/skills/council-patterns/SKILL.md, plugins/yellow-council/agents/review/gemini-reviewer.md, plugins/yellow-council/agents/review/opencode-reviewer.md, plugins/yellow-council/commands/council/council.md, plugins/yellow-council/CLAUDE.md (full content), plugins/yellow-council/README.md (full content)
- **Tasks:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
- **Depends on:** #1

### 3. agent/feat/yellow-council-polish-and-tests
- **Type:** feat
- **Description:** edge cases, partial-result handling, manual e2e tests, docs polish
- **Scope:** plugins/yellow-council/commands/council/council.md (refinements), plugins/yellow-council/agents/review/*.md (refinements), plugins/yellow-council/skills/council-patterns/SKILL.md (refinements based on smoke tests), README.md (root — plugin count update), plugins/yellow-council/CLAUDE.md (Known Limitations expansion)
- **Tasks:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10
- **Depends on:** #2

## Stack Progress

<!-- Updated by workflows:work. Do not edit manually. -->
- [x] 1. agent/feat/yellow-council-scaffold-and-spikes (PR #328, completed 2026-05-04)
- [ ] 2. agent/feat/yellow-council-core-implementation
- [ ] 3. agent/feat/yellow-council-polish-and-tests
