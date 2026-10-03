# Docs, Debt and Delegation Borrows

## Overview

The integration evaluation (`docs/brainstorms/2026-10-02-turn-the-integration-evaluation-into-an-brainstorm.md`, Spec D) found eight places where a borrowed technique would make yellow's checks deterministic or its handoffs complete:

- **Doc staleness.** It is guessed from git blame and age, not computed from the code a doc covers.
- **yellow-debt audit-to-fix.** The loop has no regression gate ("debt can only shrink"), and its fixer refactors without first listing the tests that pin current behaviour.
- **Delegation briefs.** Sends to remote agents carry the task and repo context, but no done condition or verification.
- **Five smaller gaps:**
  - security-sentinel has no dependency-adoption rubric;
  - `/setup:claude-web` grants broad defaults instead of detected runner commands;
  - session-handoff does not mark reconstructed quotes;
  - diagram citations are never checked;
  - agents cannot discover a project's existing scripts before writing new ones.

This spec covers roadmap steps 9 (`sources` / `verified_at` frontmatter) and 10 (debt ratchet, pin inventory, non-vacuity), plus the step-12 borrows not owned by Specs B or C:

- dependency rubric;
- coding brief;
- runner detection with `--verify`;
- consent and verbatim rules;
- diagram citation check;
- script discovery.

Every behaviour is project-agnostic, because these plugins run in any repository.

## Users

- **Plugin users** running `/docs:*`, `/debt:*`, the delegate commands and `/setup:claude-web` in their own repositories.
- **Maintainer**, for yellow-plugins' own `scripts/` and `docs/solutions/`.

## Requirements

### Doc freshness (roadmap step 9)

- **R1.** Docs handled by yellow-docs, and `docs/solutions/` entries, shall accept two optional frontmatter keys:
  - `sources`: a list of repo-relative globs.
  - `verified_at`: a 40-character commit SHA.

  When either key is present and malformed, `scripts/validate-solutions.js` shall fail. Absent keys are never an error.
- **R2.** When a doc has `sources` and `verified_at`, `/docs:refresh` and `/docs:audit` shall mark it stale exactly when a file matching `sources` changed between `verified_at` and HEAD, and list those files.
  - A `verified_at` that is not in history is reported as `verified_at_unknown`.
  - Docs without the keys keep today's signals (`age_exceeded`, `source_newer`, `broken_ref`).
- **R3.** The drift computation shall be a deterministic yellow-docs script with JSON output per doc, covered by a new yellow-docs bats suite.
  - Acceptance: a seeded repo with one stale and one fresh page yields exactly the stale page and its changed files.
- **R4.** When `/docs:generate` writes a doc, and when knowledge-compounder writes a solution doc, the system shall set `sources` to the files the doc describes. For solution docs, those are the PR's changed files, or the files touched in the session.
  - It shall set `verified_at` to HEAD only when none of those files has uncommitted changes and every `sources` glob matches a tracked path, because HEAD must be the commit that contains the documented source versions.
  - Otherwise it omits `verified_at` and tells the user the stamp is pending until the sources are committed.
- **R5.** When the user accepts a `/docs:refresh` update, the system shall bump that doc's `verified_at` to HEAD, under the same clean-sources condition as R4.
  - For a doc that has `sources` but no `verified_at`, `/docs:refresh` shall offer to stamp it once its sources are committed.
- **R6.** compound-lifecycle shall treat R2 drift on a solution doc as a staleness candidate, using its existing `status: stale` / `stale_reason` vocabulary.

### Debt ratchet and pin inventory (roadmap step 10)

- **R7.** `debt-ratchet update` shall write a committed baseline at `todos/debt/RATCHET.json`. The baseline records:
  - the counts of open todos (`pending`, `ready`, `in-progress`) per category × severity;
  - the command that produced it;
  - the commit SHA and a timestamp.

  Statuses are read from todo frontmatter, not file names.
- **R8.** `debt-ratchet check` shall run with no LLM and no network.
  - Exit 1 when any category × severity count exceeds the baseline, naming each growth with remediation text: triage or close the new todo, or run `update` and commit with a reason.
  - Exit 0 otherwise.
  - Exit 2 on a missing or malformed baseline, with a hint.
- **R9.** When counts shrink, `check` shall pass and suggest running `update` to lock in the lower baseline.
- **R10.** `/debt:audit` and `/debt:status` shall show the ratchet state. yellow-debt docs give a CI snippet for `debt-ratchet check`.
- **R11.** Before debt-fixer edits code, it shall build a **pin inventory**: the tests and guards that exercise the affected files.
  - Each pin is recorded with its command and its result before the change.
  - A pin counts only if it references the affected file or symbol and passed before the change (non-vacuity).
  - With no qualifying pin, debt-fixer writes a characterization test first.
- **R12.** After the fix, debt-fixer shall re-run every pin. It refuses to mark the todo complete if any pin regresses, and records each count with the command and commit that produced it in the todo's resolution notes.
- **R13.** The `/debt:audit` report header shall record the command, the commit and the scanner list behind its counts.

### Step-12 borrows

- **R14.** security-sentinel's "Dependencies & Supply Chain" section shall apply a dependency-adoption rubric when manifests or lockfiles change, using only Read, Grep and Glob (no registry calls):
  - eight signals combined into a USE, EXTRACT or BUILD verdict;
  - hard gates for GPL code in a proprietary project and for known active CVEs;
  - red flags for postinstall scripts, `.pth` files and likely typosquats.
- **R15.** yellow-core shall provide one canonical coding-brief reference, which a parity test keeps in sync with the delegate commands' inline copies. It has five parts:
  - goal and done condition;
  - starting evidence;
  - scope and constraints;
  - verification;
  - report shape.

  The brief never invents a language, path or version. An unknown part is stated as unknown.
- **R16.** `/devin:delegate`, `/cursor:delegate`, `/linear:delegate` and `/codex:rescue` shall each build their task from the R15 brief, within their existing prompt limits (for example, the 8,000-character packet in `/linear:delegate`). Each command adopts the brief in its own PR.
- **R17.** `/setup:claude-web` shall:
  - detect the project's linters and test runners;
  - propose narrow `Bash(<runner> *)` allow entries, asking only when detection is ambiguous;
  - accept `--verify`, which dry-runs the configured commands, reports pass or fail per command, and writes nothing.
- **R18.** session-handoff and knowledge-compounder shall follow three rules:
  - one invocation authorizes one capture;
  - quotes come verbatim from the transcript, and any reconstructed quote is marked with a leading `~`;
  - secrets are redacted from titles and tags as well as bodies.
- **R19.** Before diagram-architect writes a diagram, every file path it cites shall be checked for existence by a deterministic step. Cited paths are untrusted model output, so the step first rejects absolute paths, `..` traversal and symlinks that resolve outside the repo, then tests filesystem existence. Existence is independent of Git tracking, so a new untracked source file keeps its citation. Missing and rejected citations are removed and reported. The agent's docs state that generated diagrams are regenerated, never hand-edited.
- **R20.** Before repo-research-analyst recommends new tooling, it shall list the project's existing scripts with their usage. It reads usage from header comments and argument parsers, and never executes a script.
- **R21.** yellow-plugins' own `scripts/*.js` shall carry a header usage block. A root validator warns when a script lacks one.

### Delivery

- **R22.** Each item shall ship as its own PR. Plugin changes carry a changeset and update the plugin's CLAUDE.md and README. R21 is root tooling and needs no changeset.

## Design

### Doc freshness (R1–R6)

- **Drift script.** `plugins/yellow-docs/scripts/doc-drift.sh` is standalone bash, executed with `bash`.
  - It reads frontmatter with awk and passes the `sources` globs straight to `git diff --name-only --no-renames <verified_at>..HEAD -- <pathspecs>`, each as a `:(glob)` pathspec. It does not pre-expand them against HEAD with `git ls-files`, because that drops files deleted since `verified_at`. Git matches the pathspecs against both trees, so deletions and the old side of renames show up in `changed`.
  - It prints JSONL `{doc, state: fresh|stale|verified_at_unknown|no_keys, changed: [...]}`.
  - Tests: `plugins/yellow-docs/tests/doc-drift.bats`. The suite runs in CI's advisory plugin-bats loop.
- **Integration (R2).** In `commands/docs/refresh.md` and `commands/docs/audit.md`, `doc-auditor` calls the script first and keeps its git-blame heuristics for `no_keys` docs.
  - `skills/docs-conventions/SKILL.md` "Staleness Detection" documents the new signals and frontmatter.
  - R5's bump is an Edit after the user accepts.
- **Writers (R4).** `commands/docs/generate.md` sets the keys. `plugins/yellow-core/agents/workflow/knowledge-compounder.md` sets them on new solution docs.
  - Each writer checks `git status --porcelain -- <sources>` before stamping. Any output means the sources are uncommitted, so it writes `sources` and leaves `verified_at` out.
  - Empty output is not enough to stamp: a glob can match nothing, or only gitignored files, which `git status` hides. The writer also confirms every source glob matches a tracked path (`git ls-files --error-unmatch -- <sources>`) before setting `verified_at`. Otherwise it leaves the stamp pending.
  - A doc with `sources` but no `verified_at` falls back to today's signals until `/docs:refresh` stamps it after the commit (R5).
- **Validator (R1).** `scripts/validate-solutions.js` adds shape checks for the two optional keys.
- **compound-lifecycle (R6).** `plugins/yellow-core/skills/compound-lifecycle/SKILL.md` adds drift as a candidate signal. It calls the yellow-docs script when installed, and skips the signal otherwise.

### Debt ratchet and pin inventory (R7–R13)

- **Ratchet script.** `plugins/yellow-debt/scripts/debt-ratchet.sh` is standalone bash with the subcommands `update` and `check`.
  - It reads `todos/debt/*.md` frontmatter `status`, `category` and `severity` with awk, reusing the frontmatter-reading rule from #977.
  - It writes `RATCHET.json` with jq.
- **Integration (R10).** `commands/debt/status.md` and `commands/debt/audit.md` print `check`'s summary. `CLAUDE.md` and `README.md` gain the CI snippet.
- **Tests.** `plugins/yellow-debt/tests/debt-ratchet.bats`: growth, shrink, equal, missing baseline, malformed baseline, and a legacy file-name/frontmatter mismatch.
- **debt-fixer (R11, R12).**
  - `agents/remediation/debt-fixer.md` gains "Pin inventory" before edits and "Re-run pins" after.
  - Results go in the todo's resolution notes, and the existing transition rules block `complete` on regression.
  - The stronger, mutation-style non-vacuity proof (breaking the code to show a pin fails) is out of scope.
- **Report header (R13).** `agents/synthesis/audit-synthesizer.md` report template.

### Borrows (R14–R21)

| Item | Files |
| --- | --- |
| Dependency rubric (R14) | `plugins/yellow-core/agents/review/security-sentinel.md` §8 |
| Coding brief (R15) | `plugins/yellow-core/references/coding-brief.md` is the canonical template. yellow-devin, yellow-cursor, yellow-linear and yellow-codex declare no yellow-core dependency, so each delegate command carries an inline copy of the five-part template. A repo test (`tests/integration/coding-brief-parity.test.ts`) asserts that every copy's part headings match the canonical file. |
| Delegate adoption (R16) | `plugins/yellow-devin/commands/devin/delegate.md` Step 3; `plugins/yellow-cursor/commands/cursor/delegate.md`; `plugins/yellow-linear/commands/linear/delegate.md` packet build; `plugins/yellow-codex/commands/codex/rescue.md` |
| Runner detection (R17) | `plugins/yellow-core/commands/setup/claude-web.md`. Detection extends the existing package-manager probe, and the allow-entry proposal joins the 5c settings step. |
| Consent and verbatim (R18) | `plugins/yellow-core/skills/session-handoff/SKILL.md`, `knowledge-compounder.md` |
| Diagram citations (R19) | `plugins/yellow-docs/agents/generation/diagram-architect.md`, plus a small existence-check block. Per cited path it rejects absolute paths and `..` segments, resolves symlinks and rejects any target outside the repo root, then tests filesystem existence (`test -e`), not Git tracking, so untracked new files pass. |
| Script discovery (R20) | `plugins/yellow-core/agents/research/repo-research-analyst.md` |
| Usage headers (R21) | `scripts/*.js` headers; a warning in an existing root validator, or `scripts/validate-script-headers.js` wired into `validate:schemas` as an advisory |

### Traceability

| Component | Requirements | Consumer |
| --- | --- | --- |
| `doc-drift.sh` | R2, R3, R5, R6 | `/docs:refresh`, `/docs:audit`, compound-lifecycle |
| `sources` / `verified_at` keys | R1, R4 | `doc-drift.sh` |
| `debt-ratchet.sh` + `RATCHET.json` | R7–R10 | `/debt:status`, `/debt:audit`, project CI |
| debt-fixer pin inventory | R11, R12 | `/debt:fix` |
| Audit report header | R13 | `/debt:audit` readers |
| `coding-brief.md` | R15, R16 | four delegate commands |
| Other borrows | R14, R17–R21 | named components |

## MVP Scope

- **Next:**
  - R1–R6 (step 9), with the drift script first.
  - R7–R10 (ratchet).
  - R15–R16 (briefs; Devin first).
- **Later:**
  - R11–R13 (pin inventory and report header).
  - R14 and R17–R21 (remaining borrows), one PR each, in any order.
