# Feature: Solution Doc Git Workflow

## Overview

Establish a documented policy + light tooling that governs when solution docs
under `docs/solutions/` are committed to git, prevents orphaned MEMORY.md
references, and adds a non-blocking CI nudge plus a blocking exact-slug-
collision gate. The default pattern is **in-PR (co-shipped)** with the change
that generated the learning, eliminating the orphan-doc gap that prompted
backfill PR #548. The implementation has five small prongs that ship in a
single PR.

**Design pivot (2026-05-21):** Phase 0 calibration against the existing 88-
doc corpus showed maximum pairwise token Jaccard = 0.345 across all 3,828
pairs — no accidental duplicates exist. The originally-proposed Jaccard
duplicate detection (0.5 warn / 0.6 block) is dropped from the initial
implementation. The validator enforces only exact-slug collision and
frontmatter required fields. Full calibration data:
`docs/research/2026-05-21-solution-doc-jaccard-calibration.md`.

## Problem Statement

### Current Pain Points

Four distinct commit patterns are in active use with no documented policy:

| Pattern | Example | Failure mode |
|---|---|---|
| Co-shipped (in-PR) | `db4547d5` | None — this is the desired default |
| Dedicated post-PR | `9a51dde1`, `f7f35ee5` | Doc lands later; MEMORY.md may point at it prematurely |
| Session capture | `dd30b68d`, `ce3bb8b3` | No PR anchor; doc has no traceable origin |
| Backfill | `959a2cd5` (PR #548) | Orphan refs in MEMORY.md accumulate before backfill |

The orphan-doc gap is the most concrete failure mode: MEMORY.md accumulates
pointers to docs that do not exist in the repository, making the memory system
unreliable. `CONTRIBUTING.md`, `AGENTS.md`, and `docs/CLAUDE.md` contain zero
mention of solution doc policy today. The `knowledge-compounder` agent
handles file creation but has no commit-timing guidance. The
`compound-lifecycle` skill performs retroactive dedup (BM25 + cosine) but no
write-time conflict detection. No CI gate exists for solution docs.

### User Impact

- Contributors don't know when a solution doc is expected vs optional.
- MEMORY.md references rot, eroding trust in the index over time.
- Reviewers have no shared rubric to check "should this PR have a doc?"

### Business Value

- Atomic doc+code commits preserve causal links between learnings and fixes.
- Exact-slug collision detection prevents accidental file overwrites.
- A discoverable policy in `CONTRIBUTING.md` shortens contributor ramp-up.

## Proposed Solution

### High-Level Architecture

Five small, independently-verifiable prongs:

1. **`scripts/validate-solutions.js`** — diff-scoped Node validator. Blocks
   PRs that add a doc whose slug exactly matches an existing one (catches
   accidental filename collisions). Enforces required frontmatter fields on
   **new/modified** files only. No similarity scoring (calibration showed no
   accidental duplicates exist in the corpus).

2. **`knowledge-compounder` agent in-PR mode** — new explicit invocation path
   (no hook, no auto-trigger). Author runs `/workflows:compound --in-pr`
   while on a feature branch; the agent reads the current PR context, drafts
   the solution doc + MEMORY.md line, and gates on the existing M3
   AskUserQuestion before writing.

3. **CONTRIBUTING.md "Solution Docs" section** — codifies the policy:
   default, exceptions, skip criteria, opt-out mechanism. PR checklist gains
   one line.

4. **CI workflow** — new advisory `validate-solutions` job in
   `.github/workflows/validate-schemas.yml`. The blocking duplicate check
   joins the existing `validate:schemas` aggregator. The non-blocking missing-
   doc heuristic runs as a separate step using
   `closingIssuesReferences` GraphQL to detect P0/P1-labeled issues with no
   `docs/solutions/` change in the diff.

5. **PR template + error catalog plumbing** — new
   `## Solution doc` checkbox in `.github/PULL_REQUEST_TEMPLATE.md`;
   `ERROR-SOL-*` codes added to `packages/domain/src/validation/errorCatalog.ts`
   using the existing `ErrorSeverity` enum (no new `WARN-` prefix class).

### Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| In-PR trigger | **Explicit only** (`/workflows:compound --in-pr`) | Avoids hook recursion, PR-noise, and context overload. Author opts in when a learning is worth capturing. |
| Validator scope | **Diff-scoped** (`git diff origin/main...HEAD`) | Existing 88-doc corpus has frontmatter drift (`track: feature` outlier, 12 docs with `problem_type`). Diff scoping ships immediately without a normalization PR blocking work. |
| Duplicate algorithm | **Exact slug match only** | Phase 0.1 calibration on the 88-doc corpus: max pairwise Jaccard = 0.345; zero accidental duplicates exist. Adding Jaccard would be ~60 LOC of infrastructure that never fires + a stop-word list + threshold tuning + an opt-out edge case — all solving a phantom problem. Exact-slug catches the only real failure mode (accidental filename reuse). See `docs/research/2026-05-21-solution-doc-jaccard-calibration.md`. |
| Heuristic trigger | **P0/P1 issue labels only** | Eliminates revert-PR and squash-merge false positives. Narrower coverage, near-zero noise. |
| Error code namespace | **`ERROR-SOL-*` (ERROR severity only)** | Two codes: SOL-001 slug collision, SOL-002 frontmatter invalid or missing required fields. No WARNING-tier codes needed (advisory job emits `::warning::` directly). |
| MEMORY.md target | **User-local `~/.claude/projects/<slug>/memory/MEMORY.md`** | Existing knowledge-compounder writes here. Repo has no project-scoped MEMORY.md; agent-memory files at `.claude/agent-memory/` are per-plugin and out of scope. |
| Backfill scope | **None now** | Existing orphan refs accepted as historical noise. In-PR flow prevents new ones. |
| Revisit Jaccard | **When corpus exceeds ~500 docs OR real duplicates land in main** | Re-run the calibration in `docs/research/2026-05-21-solution-doc-jaccard-calibration.md`; if the bimodal distribution shifts to show real near-duplicates, add Jaccard then with corpus-derived thresholds. |

### Trade-offs Considered

- **Hook vs explicit invocation:** Rejected PostToolUse on `gt stack submit`
  because the hook would run on every submit (most submits don't need a doc),
  adding context overload. The compound-lifecycle hook recursion guard
  (`COMPOUND_DRAIN_IN_PROGRESS=1`) precedent shows how to safely build this if
  needed later — kept as a follow-up option.
- **GitHub Action posting doc draft as comment:** Rejected because the comment
  lives out-of-band from the local branch and requires manual copy-paste.
- **Corpus-wide validation:** Rejected because the 13 non-conforming existing
  docs would block every new PR until normalized. A separate normalization
  effort is filed as an out-of-scope follow-up.
- **BM25 + cosine duplicate detection:** Rejected. 88 docs is too small to
  justify the implementation complexity. Token Jaccard was the alternative —
  then itself rejected by Phase 0 calibration.
- **Token Jaccard duplicate detection (originally proposed):** Rejected after
  Phase 0.1 calibration. Max pairwise score across 3,828 pairs is 0.345; all
  high-similarity pairs are intentional siblings. No threshold setting
  produces value without false positives. Documented in
  `docs/research/2026-05-21-solution-doc-jaccard-calibration.md` for future
  revisit. Slug-exact match remains the only structural duplicate gate.

## Implementation Plan

### Phase 0: Discovery & Calibration (COMPLETE)

Phase 0 ran during plan refinement on 2026-05-21. Full data + methodology
captured at `docs/research/2026-05-21-solution-doc-jaccard-calibration.md`.
Summary:

- **0.1 — Jaccard sweep:** Max pairwise score across 3,828 pairs = 0.345.
  Zero accidental duplicates in the corpus. Proposed 0.5/0.6 thresholds
  would never fire. **Result:** Jaccard duplicate detection dropped from
  initial implementation (see Key Design Decisions above).
- **0.2 — DF-based stop-words:** No tokens cross 40% DF threshold (highest is
  `plugin` at 23.9%). **Result:** Moot — no stop-words needed since Jaccard
  is dropped.
- **0.3 — error-codes regex check:** `scripts/lint-error-codes.js` uses
  `/ERROR-[A-Z]+-\d+/g` — matches `ERROR-SOL-001` without modification.
  **Result:** No regex change required.

**Constraint surfaced by Phase 0.3 (still applies):** `lint-error-codes.js`
blocks scripts that hard-code catalog code literals. `validate-solutions.js`
must import codes from the built `@yellow-plugins/domain` package or
assemble them via string concatenation — never embed `'ERROR-SOL-001'` as a
literal.

### Phase 1: validate-solutions.js (Prong 1)

- [x] 1.1: Create `scripts/validate-solutions.js` modeled on
      `scripts/backfill-solution-frontmatter.js` (handles `docs/solutions/`
      traversal, handrolled YAML-frontmatter regex, path-traversal guards,
      `--check` mode). Target ~120 LOC.
  - `#!/usr/bin/env node` + `'use strict';`
  - `ROOT = path.resolve(__dirname, '..')`
  - `SOLUTIONS_DIR = path.join(ROOT, 'docs', 'solutions')` with
    `SOLUTIONS_DIR.startsWith(ROOT + path.sep)` guard
  - `colors`/`logError`/`logWarning` inline helpers
  - `errors[]` accumulator; exit 1 if any errors
- [x] 1.2: Implement diff detection: `git diff --name-only origin/main...HEAD`
      filtered to `^docs/solutions/`. Soft-skip with `::notice::` if no
      changed files OR if `origin/main` unreachable (fork PR fallback).
- [x] 1.3: For each changed file, parse frontmatter via handrolled regex
      (`text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/)` plus
      field-level regexes — same pattern as `backfill-solution-frontmatter.js`,
      with `\s*` after each `---` to tolerate trailing whitespace on delimiters).
      Validate:
  - Required fields: `title`, `date`, `category`, `track`, `problem`, `tags`
  - Optional: `components`, `severity`
  - Enums: `track ∈ {bug, knowledge}`,
    `category ∈ {security-issues, build-errors, integration-issues, code-quality, workflow, logic-errors}`
  - Slug regex: `^[a-z0-9]+(-[a-z0-9]+)*$`, max 50 chars
  - ISO 8601 date
  - Missing-required-field or invalid-enum → block with `ERROR-SOL-002`
- [x] 1.4: Implement exact slug collision detection:
  - Walk existing `docs/solutions/**/*.md` corpus, build slug index
  - For each new file (added in diff, not modified), check slug against index
  - Collision (same slug, different path) → block with `ERROR-SOL-001`
- [x] 1.5: Emit GitHub Actions annotations when `GITHUB_ACTIONS=true`:
      `::error file=<path>::<msg>`.
- [x] 1.6: Add `package.json` entries:
  - `"validate:solutions": "node scripts/validate-solutions.js"`
  - Append `&& node scripts/validate-solutions.js` to `"validate:schemas"`.
- [x] 1.7: Add `ERROR-SOL-001` and `ERROR-SOL-002` to the error catalog:
  - In `packages/domain/src/validation/types.ts`: add a
    `ErrorCategory.SOLUTION_DOCS` enum value (match existing naming
    convention by inspecting other categories) and a corresponding entry in
    `getErrorCodesByCategory`.
  - In `packages/domain/src/validation/errorCatalog.ts`: add two entries
    using `ErrorSeverity.ERROR` from `types.js` (enum values are UPPERCASE
    in this codebase: `'ERROR'`, `'WARNING'`).
  - SOL-001: "Solution doc slug `<slug>` collides with existing
    `<existing-path>`."
  - SOL-002: "Solution doc frontmatter invalid in `<path>`: `<detail>`."
  - **Critical constraint:** `validate-solutions.js` must NOT embed
    `'ERROR-SOL-001'` as a string literal — `lint-error-codes.js` blocks
    scripts hard-coding catalog codes. Import codes from the built
    `@yellow-plugins/domain` package (or assemble via concatenation if
    import is impractical from a `scripts/*.js` file).
- [x] 1.8: Integration tests at `tests/integration/validate-solutions.test.ts`
      following the `tests/integration/backfill-solution-frontmatter.test.ts`
      fixture-tmpdir pattern (create a temp `docs/solutions/` tree, run the
      script via `child_process`, assert on exit code + stdout):
  - Fixture: new doc with slug collision against existing → block (SOL-001)
  - Fixture: new doc missing required frontmatter field → block (SOL-002)
  - Fixture: new doc with invalid `track:` enum value → block (SOL-002)
  - Fixture: new doc with invalid `category:` enum value → block (SOL-002)
  - Fixture: new doc with bad slug regex (trailing hyphen, uppercase) → block
  - Fixture: new doc with valid frontmatter and unique slug → exit 0
  - Fixture: existing doc *modified* (not added) → skip slug-collision check;
    only lint frontmatter
  - Fixture: no `docs/solutions/` changes in diff → `::notice::` exit 0
  - Fixture: `origin/main` unreachable → soft-skip exit 0

### Phase 2: knowledge-compounder in-PR mode (Prong 2)

- [x] 2.1: Read `plugins/yellow-core/agents/workflow/knowledge-compounder.md`
      lines 57-75 (existing `--- begin review-findings ---` fast path) as the
      structural model.
- [x] 2.2: Add a parallel fast-path branch keyed off
      `--- begin pr-context ---` delimiters. When the agent is spawned with
      this delimiter, it:
  - Reads `gh pr view --json title,body,commits,closingIssuesReferences` for
    the current branch
  - Skips the 5-subagent Phase 1 pipeline; uses the PR body + commit subjects
    as the source for Context Analyzer + Solution Extractor
  - Defaults `ROUTING_HINT: BOTH` (write doc + MEMORY.md line)
  - Runs Related Docs Finder against `docs/solutions/` corpus to detect
    AMEND_EXISTING signal BEFORE the suffix-collision loop
- [x] 2.3: Fix the suffix-loop / Jaccard interaction (P1 logic gap surfaced
      by spec-flow):
  - If Related Docs Finder returns `AMEND_EXISTING`, the suffix loop MUST be
    skipped. The agent appends a `## Update — YYYY-MM-DD` section to the
    matched existing doc.
  - The suffix loop is reserved for true structural collisions only (same
    slug stem, demonstrably different problem statement, which is rare).
- [x] 2.4: Add an explicit `SKIP` exit path in the in-PR branch: if
      Context Analyzer determines all skip criteria are met (trivial fix,
      typo, version bump, no concrete failure mode), output
      "No solution doc required: <reason>" to the user and exit before M3.
- [x] 2.5: Extend the M3 AskUserQuestion (lines 198-213 of the agent file) to
      show the MEMORY.md entry draft inline alongside the doc draft and file
      paths.
- [x] 2.6: Create `plugins/yellow-core/commands/workflows/compound.md` arg
      handling for `--in-pr`:
  - Detect current branch via `git branch --show-current`
  - Verify PR exists via `gh pr view`; if not, error with actionable message
    ("Create a draft PR first with `gt stack submit --draft`")
  - Build the `--- begin pr-context ---` delimited prompt
  - Dispatch via existing `subagent_type: "yellow-core:workflow:knowledge-compounder"`
- [x] 2.7: Update `plugins/yellow-core/CLAUDE.md` and
      `plugins/yellow-core/README.md` to document the new flag.
- [x] 2.8: Bats tests for the `--in-pr` argument parsing in
      `plugins/yellow-core/tests/` (mock `gh pr view`).

### Phase 3: CONTRIBUTING.md + AGENTS.md policy (Prong 3)

- [x] 3.1: Add a new `## Solution Docs` section to `CONTRIBUTING.md` after
      the existing `## Versioning` section (Versioning starts at line 143,
      ends ~line 242; insert after line 242). Cover:

<!-- deepen-plan: codebase -->
> **Codebase:** Line-number corrections from plan-original: `## Versioning`
> starts at line 143, ends ~line 242 (file is 481 total lines). ToC entries
> are at lines 8-14 (ToC heading at line 6). "Before Submitting" checklist
> heading is at line 125; items at lines 127-133. A second checklist exists
> under Versioning at line 182.
<!-- /deepen-plan -->
  - Default pattern (in-PR co-shipped)
  - When a doc is required (recurring learning that could waste future time)
  - Skip criteria (trivial, already documented, subjective preference)
  - Exception path: post-PR dedicated `docs(solutions):` PR with explicit
    justification in PR description
  - How to invoke: `/workflows:compound --in-pr` while on a feature branch
  - CI behavior: blocking on exact-slug collision and invalid frontmatter;
    non-blocking missing-doc warn for P0/P1-labeled issue closures
  - Note the heuristic's blind spots: cross-repo `closes` references
    (`closes other-repo#123`) and commit-message-only closures don't surface
    via `closingIssuesReferences` — author judgment fills the gap
  - [x] 3.2: Add the new section to the CONTRIBUTING.md ToC at line 8.
  - [x] 3.3: Add a checklist line to "Before Submitting" (heading line 125,
        items lines 127-133):
        `- [ ] Solution doc written, updated, or skip criteria documented in PR description`
  - [x] 3.4: Cross-reference from `AGENTS.md` "Critical Agent Authoring Rules"
        section pointing at the new `validate:solutions` validator.

### Phase 4: CI workflow integration (Prong 4)

- [x] 4.1: Edit `.github/workflows/validate-schemas.yml`:
  - Add `docs/solutions/**` and `scripts/validate-solutions.js` to the
    `on.pull_request.paths` trigger.
  - Confirm `fetch-depth: 0` is set on the relevant checkout step (required
    for `origin/main...HEAD` diff).
- [x] 4.2: Add a new `validate-solutions-advisory` job (mirrors the
      `changeset-check` job at lines 760-800 — `validate-versions` lacks
      `fetch-depth: 0`) for the **non-blocking** missing-doc heuristic:

  ```yaml
  validate-solutions-advisory:
    name: Solution Doc Advisory
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 2
    permissions:
      pull-requests: read
      issues: read
    steps:
      - uses: actions/checkout@<pinned>
        with:
          fetch-depth: 0
      - name: Check P0/P1 issue label + missing doc
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          # Use gh api graphql with closingIssuesReferences
          # Emit ::warning:: if labeled issue with no docs/solutions/ change
          # Always exit 0 (advisory only)
  ```

<!-- deepen-plan: external -->
> **Research:** `permissions: { pull-requests: read, issues: read }` is the
> minimum required. The advisory job is read-only, so it's safe under fork
> PRs via the `pull_request` event (GITHUB_TOKEN is forced read-only for
> forks, which is fine for GraphQL reads). **Do NOT use `pull_request_target`**
> — it grants write scopes to fork code (supply-chain risk). Rate-limit
> budget: ~1 GraphQL point per call at the 5000/hr budget — non-issue at
> 10-50 PRs/day. Sources:
> <https://docs.github.com/en/actions/security-guides/automatic-token-authentication>,
> GitHub Community Discussion #24706.
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Canonical query shape for "PR closes which issues, with what
> labels":
>
> ```graphql
> query($owner: String!, $repo: String!, $pr: Int!) {
>   repository(owner: $owner, name: $repo) {
>     pullRequest(number: $pr) {
>       closingIssuesReferences(first: 25) {
>         nodes {
>           number
>           title
>           labels(first: 10) { nodes { name } }
>         }
>       }
>     }
>   }
> }
> ```
>
> Pass vars via `gh api graphql -F owner="$OWNER" -F repo="$REPO" -F pr="$PR_NUMBER"`.
> Guard with `if .data.repository == null then error(...)` in jq —
> `IssuesConnection` is nullable. Source:
> <https://github.com/orgs/community/discussions/24706>
<!-- /deepen-plan -->

<!-- deepen-plan: external -->
> **Research:** Two heuristic gotchas — (1) Cross-repo closes (`closes
> owner/other-repo#123`) do NOT appear in `closingIssuesReferences`; the
> advisory will miss them. At single-repo scale this is unlikely to matter.
> (2) Issues linked only in commit messages or PR comments do NOT trigger
> the field — only PR body keywords (`closes`, `fixes`, `resolves`) do.
> Surface both caveats in CONTRIBUTING.md so contributors know the
> heuristic's blind spots. Draft PRs DO populate the field normally.
<!-- /deepen-plan -->
- [x] 4.3: The blocking duplicate check rides via `validate:schemas` (already
      includes `validate-solutions.js`). No new job needed — it runs inside
      the existing `validate-schemas` matrix.
- [x] 4.4: Do NOT add `validate-solutions-advisory` to the `ci-status`
      aggregate gate at lines 947-994. Its skipped/failed state must not
      block merge.
- [x] 4.5: Use the canonical 6-element `gh api graphql` pattern (inline the
      pattern in the job; the referenced solution doc does not exist yet):

<!-- deepen-plan: codebase -->
> **Codebase:** Correction: `docs/solutions/integration-issues/gh-api-graphql-plugin-command-template.md`
> does NOT exist. The pattern lives only as MEMORY.md notes. Two options:
> (a) Inline the 6 elements directly in the workflow YAML comment block as
> documentation. (b) Create the missing solution doc as part of this PR
> (good fit — this work is about solution doc discipline). Recommend
> option (b): authoring the missing reference doc dogfoods the new policy.
<!-- /deepen-plan -->
  - Soft-skip if `gh` or auth unavailable
  - `-f` flags for variables (no string interpolation)
  - `--jq` for server-side filtering
  - SC2016 disable on separate line
  - Symmetric exit-code capture
  - jq null-repository guard
  - [x] 4.6: Detect the P0/P1 label set via `closingIssuesReferences` (not PR
        labels). Configurable label list — default: `P0`, `P1`, `bug-critical`.

### Phase 5: PR template + final polish (Prong 5)

- [x] 5.1: Edit `.github/pull_request_template.md` (lowercase, already
      exists): add a `## Solution Doc` checklist line referencing the new
      CONTRIBUTING.md section.

<!-- deepen-plan: codebase -->
> **Codebase:** Correction: filename is lowercase `.github/pull_request_template.md`,
> not uppercase. File already exists with 4 sections (Summary, Stack context,
> Test plan, Notes for reviewers). Augment in place — do not create a new
> file with different casing (would create two templates on case-sensitive
> filesystems).
<!-- /deepen-plan -->
- [x] 5.2: Update `docs/CLAUDE.md` to reference the new policy under release
      checklist material.
- [x] 5.3: Add a one-line MEMORY.md index entry under `## CORE_RULES →
      Project Structure` pointing at the new section in `CONTRIBUTING.md`.
- [x] 5.4: Update `docs/plugin-validation-guide.md` if it enumerates
      validators (add `validate:solutions`).
- [x] 5.5: Run full validation gate: `pnpm validate:schemas && pnpm test:unit
      && pnpm lint && pnpm typecheck`.

### Phase 6: Stack submit + changeset

- [x] 6.1: Generate changeset via `pnpm changeset` — patch-level for
      `yellow-core` (knowledge-compounder + command body change) and root
      tooling change for `validate-solutions.js`.
- [x] 6.2: CRLF normalize any newly-created shell or markdown files:
      `sed -i 's/\r$//' <files>`.
- [x] 6.3: `gt stack submit` — this is sized for a single PR, not a stack.

## Technical Specifications

### Files to Create

| Path | Purpose | Approx LOC |
|---|---|---|
| `scripts/validate-solutions.js` | Diff-scoped frontmatter validator + exact-slug collision check | ~120 |
| `tests/integration/validate-solutions.test.ts` | Integration tests (mirrors `backfill-solution-frontmatter.test.ts`) | ~120 |
| `docs/research/2026-05-21-solution-doc-jaccard-calibration.md` | (Already authored) calibration data + design rationale | ~150 |
| `docs/solutions/integration-issues/gh-api-graphql-plugin-command-template.md` | Backfill the referenced-but-missing pattern doc (dogfoods the new policy) | ~120 |

### Files to Modify

| Path | Change |
|---|---|
| `packages/domain/src/validation/types.ts` | Add `ErrorCategory.SOLUTION_DOCS` enum value + `getErrorCodesByCategory` entry |
| `packages/domain/src/validation/errorCatalog.ts` | Add `ERROR-SOL-001` and `ERROR-SOL-002` entries (import `ErrorSeverity` from `types.js`) |
| `.github/pull_request_template.md` | Add Solution Doc checklist line (lowercase filename — exists) |
| `package.json` | Add `validate:solutions` script; append to `validate:schemas` aggregator |
| `plugins/yellow-core/agents/workflow/knowledge-compounder.md` | Add in-PR fast-path branch (parallel to review-findings branch) + suffix-loop fix + SKIP exit |
| `plugins/yellow-core/commands/workflows/compound.md` | Add `--in-pr` arg handling |
| `plugins/yellow-core/CLAUDE.md` | Document `--in-pr` flag |
| `plugins/yellow-core/README.md` | Reference new flag |
| `CONTRIBUTING.md` | New `## Solution Docs` section + ToC + checklist line |
| `AGENTS.md` | Cross-reference to validate:solutions |
| `docs/CLAUDE.md` | Reference new policy |
| `.github/workflows/validate-schemas.yml` | Add path trigger; new advisory job; exclude from ci-status gate |
| `docs/plugin-validation-guide.md` | Add validate:solutions entry |

### Dependencies

No new dependencies. The validator parses YAML frontmatter with a handrolled
regex (same pattern as `scripts/backfill-solution-frontmatter.js`); no
`js-yaml` is needed.

### API Changes

**Before:** No solution-doc-specific tooling. Authors manually write docs
post-hoc; orphan refs accumulate in MEMORY.md.

**After:**

```bash
# Author workflow during a fix:
gt branch create fix/some-bug
# ... write code, commit ...
gt stack submit --draft       # creates PR
/workflows:compound --in-pr   # agent drafts doc + MEMORY.md line
# ... author reviews, agent writes both ...
gt amend                       # adds the doc to the PR
gt stack submit                # marks ready
```

CI on the PR:
- `validate-solutions` (blocking) runs inside `validate:schemas` — fails if
  new doc collides with an existing slug or has invalid/missing frontmatter.
- `validate-solutions-advisory` (non-blocking) warns if PR closes a P0/P1
  issue but has no `docs/solutions/` change.

### Frontmatter Schema (validated by Phase 1)

```yaml
---
title: 'Doc title sentence'                # required, string
date: 2026-05-21                            # required, ISO 8601
category: workflow                          # required, enum
track: bug                                  # required, enum {bug, knowledge}
problem: 'One-line keyword-rich summary'    # required, string
tags:                                       # required, array of strings
  - git
  - ci
components:                                 # optional, array of strings
  - github actions
severity:                                   # optional, P0/P1/P2 or {critical:N, important:N}
  critical: 1
---
```

## Testing Strategy

### Integration Tests (`tests/integration/validate-solutions.test.ts`)

Listed in Phase 1.8 task above. Covers: slug collision, frontmatter missing
required field, invalid enum values for `track:` / `category:`, bad slug
regex, valid new doc, modified (not added) existing doc, empty diff, and
fork-PR `origin/main` fallback.

### Bats Tests (`plugins/yellow-core/tests/`)

- `/workflows:compound --in-pr` with no PR for current branch → error with
  actionable message.
- `/workflows:compound --in-pr` with PR → dispatches agent with correct
  delimiter.

### Manual Smoke Test Checklist

- [x] Run `/workflows:compound --in-pr` on a branch with an open draft PR.
      Agent reads PR context, drafts doc, M3 shows both doc + MEMORY.md
      previews, write succeeds.
- [x] Add a doc with a deliberate slug collision → CI fails with clear
      `ERROR-SOL-001` annotation pointing at the conflicting existing doc.
- [x] Add a doc missing `track:` → CI fails with `ERROR-SOL-002`.
- [x] Close a P0-labeled issue via PR without adding a doc → CI emits
      `::warning::` but does not block.

## Acceptance Criteria

1. `scripts/validate-solutions.js` exists and is wired into
   `pnpm validate:schemas`. Running it on a PR-added doc with a slug
   matching an existing file fails with exit 1 and `ERROR-SOL-001`. Running
   it on a PR-added doc with missing or invalid frontmatter fails with
   `ERROR-SOL-002`.
2. `pnpm test:integration` covers all 9 fixture cases listed in Phase 1.8
   and passes.
3. `/workflows:compound --in-pr` invokable from a feature branch with an
   open PR. Dispatches `knowledge-compounder` with the in-PR fast path. M3
   confirmation shows both doc draft and MEMORY.md draft. Cancel path
   produces no writes.
4. `knowledge-compounder` agent's suffix-collision loop is skipped when
   Related Docs Finder returns `AMEND_EXISTING`. Verified by Bats or unit
   test on the agent's branch logic.
5. `CONTRIBUTING.md` contains a `## Solution Docs` section discoverable from
   the ToC. The Before Submitting checklist has the new line.
6. CI workflow has `validate-solutions-advisory` job emitting `::warning::`
   annotations on P0/P1-labeled PRs without `docs/solutions/` changes. The
   job is NOT in the `ci-status` aggregate gate.
7. `packages/domain/src/validation/errorCatalog.ts` contains `ERROR-SOL-001`
   and `ERROR-SOL-002`. `pnpm validate:error-codes` passes.
8. `pnpm release:check` passes on the feature branch.

## Edge Cases & Error Handling

| Scenario | Behavior |
|---|---|
| Author writes a sibling doc sharing vocabulary with an existing one | No CI block — Jaccard is dropped from initial implementation. Authors rely on their own judgment + review feedback; `knowledge-compounder` Related Docs Finder still surfaces near-matches at write time. |
| Two PRs open simultaneously add the same slug | First merges cleanly; second's CI fails after rebase against updated `origin/main` with `ERROR-SOL-001`. Author renames or amends. |
| knowledge-compounder suffix loop collides with existing doc | Cannot happen post-fix: Related Docs Finder runs first, returns `AMEND_EXISTING`, suffix loop is skipped. |
| Revert PR with `Revert "fix: ..."` subject | Heuristic uses `closingIssuesReferences` labels only, not commit subjects. No false positive. |
| Squash-merged PR | Heuristic uses GraphQL `closingIssuesReferences`, not `git log` on `main`. Squash strategy irrelevant. |
| PR closes 0 issues | GraphQL returns empty `closingIssuesReferences`; advisory job exits early without warning. |
| Cross-repo issue references | `closingIssuesReferences` only tracks same-repo links. Advisory misses cross-repo `closes other-repo#123`. Documented in CONTRIBUTING.md as a known blind spot. |
| Commit-message-only closing keyword | `closingIssuesReferences` only surfaces PR-body keywords. Commit-message-only closures bypass the heuristic. Documented in CONTRIBUTING.md. |
| Fork PR | `pull_request` event grants read-only GITHUB_TOKEN, sufficient for the GraphQL read. Validator's `git diff` still works because `fetch-depth: 0` is set on checkout. Do NOT use `pull_request_target`. |
| `gh` rate-limited or auth missing | Advisory job soft-skips with `::notice::`; blocking validator still runs (no GraphQL dependency). |
| `origin/main` unreachable | Both validator and advisory soft-skip with explanatory notice. `fetch-depth: 0` on checkout step prevents this in normal CI. |
| Author runs `/workflows:compound --in-pr` with trivial fix | Context Analyzer detects skip criteria, agent exits before M3 with "No solution doc required: <reason>". |
| Existing doc with non-conforming frontmatter modified by unrelated PR | Diff-scoped validator runs frontmatter validation on the modified file; if pre-existing fields are missing it blocks. Mitigation: out-of-scope normalization PR (see Out-of-Scope below) or scope the validator to "added only, not modified" (a one-line tweak in Phase 1.4). |

## Performance Considerations

- 88 docs × ~5 changed files per PR → O(N×M) = ~440 slug comparisons per PR
  run. Each comparison is O(1) hash-set lookup after corpus walk. Total
  wall-clock cost well under 1s on CI.
- No corpus-size scaling concern at any realistic future size.

## Security Considerations

- **GraphQL query construction:** follows the canonical 6-element
  `gh api graphql` pattern with `-f` flags only. No user-input interpolated
  into the query string.
- **Frontmatter parsing:** handrolled regex with explicit `[\s\S]*?` non-
  greedy capture; no `eval`, no YAML deserialization (no `js-yaml`).
- **Slug regex:** `^[a-z0-9]+(-[a-z0-9]+)*$` rejects trailing/consecutive
  hyphens, uppercase, and path separators — no traversal vector.
- **Path traversal in corpus walk:** validator must verify
  `SOLUTIONS_DIR.startsWith(ROOT + path.sep)` before any `readdir` —
  copy the guard from `backfill-solution-frontmatter.js`.

## Migration & Rollback

### Deployment

- Single PR. Lands on `main`; CI immediately enforces blocking slug-
  collision + frontmatter checks on the next PR.
- Existing 13 non-conforming docs remain untouched — diff-scoped validator
  only runs on files in the current PR's diff. Modifying one of them in a
  later PR will trigger frontmatter validation (acceptable — fix on touch).

### Rollback

- Remove `validate:solutions` from `validate:schemas` aggregator in
  `package.json` (1-line revert).
- Delete `validate-solutions-advisory` job from
  `.github/workflows/validate-schemas.yml`.
- `knowledge-compounder` in-PR branch is additive (existing flow unaffected)
  — revert is safe.

### Breaking Changes

None. All additions:

- New script + CI job (additive)
- New agent code path triggered only by explicit `--in-pr` (existing paths
  unchanged)
- New CONTRIBUTING.md section (documentation)
- New error codes in `errorCatalog.ts` (additive)
- New frontmatter fields (`intentional_variant`, `variant_of`) — out of scope
  for the initial implementation; reserved for a future Jaccard-based phase

## References

- Brainstorm: `docs/brainstorms/2026-05-21-solution-doc-git-workflow-brainstorm.md`
- Related: PR #548 (the orphan-ref backfill that prompted this work) — commit
  `959a2cd5`
- Existing patterns:
  - `scripts/validate-doc-counts.js` (boilerplate model)
  - `scripts/validate-marketplace.js` (frontmatter validation patterns)
  - `.github/workflows/validate-schemas.yml` lines 737-756 (validate-versions
    job — model for new advisory job)
  - `.github/workflows/validate-schemas.yml` lines 759-800 (changeset-check
    job — model for git-diff-based detection)
  - `plugins/yellow-core/agents/workflow/knowledge-compounder.md` lines 57-75
    (existing review-findings fast path — model for in-PR fast path)
  - `plugins/yellow-core/skills/compound-lifecycle/SKILL.md` (existing BM25 +
    cosine dedup — retroactive counterpart)
  - `docs/solutions/integration-issues/gh-api-graphql-plugin-command-template.md`
    (6-element GraphQL safety pattern for the advisory job)
  - `docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md`
    (frontmatter parser quirks to avoid)
- External:
  - [GitHub Workflow Commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands) — `::warning::` / `::error::` syntax
  - [Google SRE Postmortem Culture](https://sre.google/sre-book/postmortem-culture/) — Prevention section convention
  - Ben Frederickson, [Distance Metrics for Fun and Profit](https://www.benfrederickson.com/distance-metrics/) — Jaccard rationale

<!-- deepen-plan: external -->
> **Research (deepen-plan):** Additional sources added during plan enrichment:
> - [Draisbach & Naumann, "On Choosing Thresholds for Duplicate Detection," HPI Potsdam 2013](https://hpi.de/fileadmin/user_upload/fachgebiete/naumann/publications/2013/On_Choosing_Thresholds_for_Duplicate_Detection.pdf) — labeled-pair threshold sweep methodology for Phase 0 calibration
> - [Microsoft Research, "Duplicate News Story Detection Revisited," 2013](https://www.microsoft.com/en-us/research/wp-content/uploads/2013/12/NewsDuplicateDetectionRevisted.pdf) — DF-based domain stop-word selection
> - [nelhage, "Finding near-duplicates with Jaccard similarity and MinHash"](https://blog.nelhage.com/post/fuzzy-dedup) — bimodal Jaccard distribution, ~500-1000 doc inflection point
> - [GitHub Automatic Token Authentication](https://docs.github.com/en/actions/security-guides/automatic-token-authentication) — fork PR permissions behavior
> - [GitHub Community Discussion #24706](https://github.com/orgs/community/discussions/24706) — `closingIssuesReferences` semantics + IssuesConnection nullable
<!-- /deepen-plan -->

## Out-of-Scope (Tracked as Follow-Ups)

- Retroactive normalization of existing 13 non-conforming docs (`track:
  feature` outlier, `problem_type` extra field) — file as a separate PR after
  this lands. Until then, the validator only fires on those docs when they're
  modified.
- Auto-generation of MEMORY.md as a build artifact (explicitly rejected in
  brainstorm Q5).
- Blocking PRs for missing solution docs (brainstorm Q4 — non-blocking only).
- PostToolUse hook on `gt stack submit` to auto-trigger in-PR mode — kept as
  future enhancement once the explicit flow is validated in practice.
- `<!-- no-solution-doc -->` PR-body opt-out for the advisory job —
  initial advisory rollout is already non-blocking, so an opt-out is not
  strictly needed; add only if author noise complaints surface.
- `Prevention` section enforcement in `validate-solutions.js` (parsing
  markdown heading structure) — defer until corpus compliance is measured.
- **Jaccard / TF-IDF / BM25 duplicate detection at write time** — Phase 0.1
  calibration showed no accidental duplicates in the 88-doc corpus (max
  pairwise Jaccard = 0.345; all high-similarity pairs are legitimate
  siblings). Re-run the calibration when the corpus exceeds ~500 docs or
  when a real duplicate lands in `main`. Methodology + thresholds:
  `docs/research/2026-05-21-solution-doc-jaccard-calibration.md`.
- `intentional_variant: true` / `variant_of:` frontmatter fields — only
  needed if/when Jaccard duplicate detection is added back. Out of scope
  for the initial implementation.

---

## Archival Verification

Archived 2026-06-30. All 38 task boxes were validated against `main` by a
per-task verifier pass (cited file/line + commit evidence) before ticking —
not blind-ticked, per the validate-before-ticking rule.

**Result: 37/38 DONE, 1 knowingly DEFERRED.**

**⚠️ Deferred (not done): task 2.8** — Bats tests for
`/workflows:compound --in-pr` argument parsing (the planned `mock gh pr view`
coverage) were never written. The `--in-pr` feature itself **is fully shipped
and functional** on `main` (`compound.md` arg handling, `knowledge-compounder.md`
PR-context fast path); only the test coverage is absent. The box is ticked to
close the plan per explicit user decision (2026-06-30) to archive with this
gap annotated rather than block on it. Follow-up test coverage tracked
separately, not by this plan.

**Provenance:** **PR #553** (MERGED) —
`feat(yellow-core): solution-doc git-workflow implementation` — shipped all six
phases (validate-solutions.js + `ERROR-SOL-*` codes, knowledge-compounder
`--in-pr` mode, CONTRIBUTING/AGENTS/docs, CI advisory job, PR template,
changeset).

**Gate C override rationale:** PR #553's branch is `agent/feat/solution-doc-impl`
(truncated — does not contain the slug `solution-doc-git-workflow`), so Gate C
finds no slug match — expected. The archival commit carries
`Plan-Verifier-Override: user-confirmed-no-pr-evidence (pr=#553)`,
grep-discoverable via `git log --grep='Plan-Verifier-Override'`.
