# Solution Doc Git Workflow

**Status:** Closed (brainstorm). See plans/ for any follow-up implementation plan.
**Date:** 2026-05-21
**Topic:** When and how to commit solution docs to git — default patterns, conflict detection, skip criteria, CI enforcement, and MEMORY.md authoring flow.

## Problem

Four distinct commit patterns are in active use across the repo with no documented policy:

- **Co-shipped** (`db4547d5`): solution doc committed in the same PR as the fix that generated it.
- **Dedicated post-PR** (`9a51dde1`, `f7f35ee5`): separate `docs(solutions):` PR that references the resolved PR number.
- **Session capture** (`dd30b68d`, `ce3bb8b3`): committed via `/workflows:compound` with no PR anchor.
- **Backfill** (`959a2cd5`, PR #548): orphaned local files referenced by MEMORY.md lines that were never committed.

The orphan-doc gap is the most concrete failure mode: MEMORY.md accumulates pointers to docs that do not exist in the repository, making the memory system unreliable. CONTRIBUTING.md, AGENTS.md, and docs/CLAUDE.md contain zero mention of solution doc policy. The knowledge-compounder agent handles file creation but has no commit-timing guidance. The compound-lifecycle skill performs retroactive dedup (BM25 + cosine) but not write-time conflict detection. No CI gate exists for solution docs today.

## Decisions

1. **Default pattern: In-PR.** Solution docs are committed in the same PR as the code change that generated the learning. This eliminates the orphan-doc problem by making the doc and the fix atomic. Post-PR dedicated PRs are a valid exception for insights that emerge during review or after merge, but they require explicit justification in the PR description. Session-capture commits without a PR anchor are deprecated.

2. **Conflict detection: Proactive (write-time).** Before committing a new solution doc, a slug/keyword match check runs against existing docs in `docs/solutions/`. False positives are acceptable — the author resolves them by updating the existing doc instead of creating a sibling. The check warns rather than blocks, giving the author the choice. This is implemented as a pre-commit heuristic or CI warning, not a hard gate.

3. **Skip criteria.** A solution doc is NOT required when the change meets any of the following:
   - **Reversible or trivial**: one-liner fix, typo correction, version bump with no behavioral implication.
   - **Already documented**: proactive conflict detection flagged a duplicate — in that case, update the existing doc rather than creating a new one.
   - **Subjective preference**: pure style or taste choice with no concrete failure mode that the doc would prevent.

   PR-specific learnings (e.g., "this particular API shape caused confusion") are NOT a skip reason — file them. The bar is whether the learning could recur and cause wasted time.

4. **CI enforcement.** Three distinct rules, each with a different severity:
   - **Non-blocking warn**: heuristic check for PRs that resolve issues labeled `bug` or `P0/P1` with no change under `docs/solutions/`. Emits a warning in CI output; does not fail the build. Author acknowledges or adds the doc.
   - **Blocking duplicate-by-slug**: if a new file in `docs/solutions/` shares a slug or a high keyword-overlap score with an existing file, CI fails with both paths listed. Author must either update the existing doc or rename the new one with a disambiguating suffix.
   - **No block on broken MEMORY.md refs**: orphan references in MEMORY.md are informational. Backfill PRs (like #548) remain acceptable and are not blocked. This prevents the backfill mechanism itself from becoming a CI bottleneck.

5. **MEMORY.md flow: Same PR, agent-written.** When a solution doc is created, the knowledge-compounder agent drafts the one-line MEMORY.md index entry and the doc frontmatter in the same PR. The author reviews both before merge. This keeps the doc and its MEMORY.md pointer atomic — the primary mechanism for preventing orphaned references going forward.

## Implications / Open Follow-Ups

- **New script: `validate-solutions.js`** (or extension of `validate-plugin.js`) implementing the blocking duplicate-by-slug check and the non-blocking missing-doc heuristic. Needs a concrete keyword/label list for the heuristic trigger (e.g., git log subject matching `fix:`, `fix!:`, issue labels `bug`/`P0`/`P1`).
- **knowledge-compounder modification**: add an in-PR mode where it drafts the solution doc and MEMORY.md line during the PR and surfaces them to the author for review, rather than running post-hoc in a separate session.
- **CONTRIBUTING.md update**: codify this policy under a "Solution Docs" section so it is discoverable without reading a brainstorm.
- **Slug-overlap threshold tuning**: cosine cutoff and shared-token count for the duplicate check need calibration against the existing doc corpus. Defer to the implementation plan — wrong thresholds produce too many false positives and the author starts ignoring them.
- **Backwards-compat**: existing orphan refs in MEMORY.md (e.g., the lines 364-365 case that prompted PR #548) — decide between a one-time backfill sweep or accepting them as historical noise. Low urgency since the in-PR flow prevents new ones.

## Non-Goals

- Retroactive dedup of existing solution docs (separate effort, not in scope here).
- Auto-generation of MEMORY.md as a build artifact (decided against in Q5 — agent-authored with human review is the chosen model).
- Blocking PRs for missing solution docs (Q4 explicitly non-blocking for the missing-doc heuristic).

## Next Step

To turn this into an implementation plan, run:
`/workflows:plan docs/brainstorms/2026-05-21-solution-doc-git-workflow-brainstorm.md`

---

## Research Findings

*Added 2026-05-21 to support implementation of `validate-solutions.js` and the
CI warning job. Five focus areas. Sources cited inline.*

---

### 1. Slug/Keyword Duplicate Detection

**Decision context:** The blocking duplicate-by-slug check in Decision 4 needs a
concrete algorithm. This repo's docs corpus is small (85 files as of today) and
will remain in the low hundreds. Authors write short slugs and titles
(`heredoc-delimiter-collision`, `hook-set-e-and-json-exit-pattern`). The check
runs in CI Node.js, so no Python ML stack is available.

**Algorithm comparison:**

| Algorithm | Strengths | Weaknesses | Fit for this repo |
|---|---|---|---|
| **Exact slug match** | Zero false positives | Misses synonyms (`crlf` vs `line-endings`) | Always run as first pass |
| **Token Jaccard** | No dependencies, fast, interpretable | Sensitive to vocabulary mismatch; short slugs have high variance | Good for slug-vs-slug; threshold ~0.5 |
| **TF-IDF cosine** | Handles full body; weights rare terms | Needs corpus IDF table; overkill for 100 docs | Optional for body comparison |
| **BM25** | Best ranking for full-body retrieval | Needs tunable K1; adds complexity | Only if false-positive rate from cosine proves too high |
| **SimHash/MinHash** | Web-scale dedup (millions of docs) | Complexity out of proportion | Not appropriate here |

**Practical recommendations from research:**

1. **Two-pass check: exact slug first, then token overlap.**
   Exact slug match on the filename stem (e.g., `heredoc-delimiter-collision`)
   catches the most obvious duplicate. Cost: one `fs.readdirSync` call.
   Source: standard practice; no external dependency needed.

2. **Jaccard on tokenized titles with threshold 0.5 for the warn path.**
   Split title/slug on `-` and common stop-words. Jaccard = |A ∩ B| / |A ∪ B|.
   At 0.5, two slugs sharing half their tokens get flagged. Empirically, thresholds
   of 0.5–0.6 are used for near-duplicate title detection in ADR tooling and doc
   corpora (source: Ben Frederickson's analysis of distance metrics shows Jaccard
   works well when corpus items are sets of discrete tokens, not frequency-weighted
   text). This is the right granularity for 3–6 word kebab-case slugs.

3. **Do NOT compare full body in CI.** Full-body cosine similarity requires
   building a corpus TF-IDF table at CI time — expensive and fragile for a
   growing doc set. The body comparison belongs in the compound-lifecycle skill
   (which already does BM25 + cosine for retroactive dedup), not in the
   blocking CI check. The CI check should operate only on frontmatter
   (`title:`, `problem:`, `tags:`) plus the filename slug.

4. **Threshold tuning guidance:**
   - Jaccard >= 0.6 on slug tokens → **block** (near-certain duplicate)
   - Jaccard 0.4–0.59 on slug + title tokens → **warn** (possible duplicate,
     author resolves)
   - Jaccard < 0.4 → pass silently
   These bands avoid alert fatigue while catching the real cases (e.g.,
   `prompt-injection-fence-breakout-literal-delimiter` vs
   `prompt-injection-fence-delimiter-escape` — both exist in the corpus and
   could have been caught at write time).

5. **Compare against same category only.** A slug collision between
   `docs/solutions/security-issues/` and `docs/solutions/code-quality/` is
   less likely to be a true duplicate than two slugs in the same directory.
   Limit Jaccard comparison to same-category docs first; cross-category
   comparison is the warn path.

**False-positive trade-off:** The primary risk is two genuinely distinct docs
sharing domain vocabulary (e.g., `hook-recursion-guard` and
`hook-set-e-json-exit` both tokenize to `hook`). Guard against this by:
(a) excluding single-token "stop words" specific to this domain (`hook`, `plugin`,
`agent`, `skill`, `ci`, `pr`) from the Jaccard set, and (b) treating a match
only when 3+ non-stop tokens overlap, not just one.

---

### 2. CI Warn-vs-Block Patterns

**Decision context:** Decision 4 specifies a non-blocking warn for missing-doc
heuristic and a blocking check for slug duplicates. This maps to two separate
CI jobs in `validate-schemas.yml`.

**GitHub Actions annotation syntax (official docs, 2026):**

```yaml
# In a shell step — emits a visible annotation in the PR Checks UI:
echo "::warning file=docs/solutions/workflow/foo.md::Possible duplicate of docs/solutions/workflow/bar.md (Jaccard 0.52)"
echo "::notice::No solution doc detected for this bug-label PR. Consider adding one."
echo "::error file=docs/solutions/workflow/foo.md::Slug collision with existing doc bar.md — rename or update existing."
```

Parameters (all optional): `file`, `line`, `endLine`, `col`, `endColumn`, `title`.
Annotations appear inline on the changed file in the PR diff view when `file=` is set.
Source: [GitHub Docs — Workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)

**Annotation limits:** 10 warnings + 10 errors per step; 50 per job; 50 per run.
For a doc-check that typically fires on 0–2 files, this is not a constraint.

**Implementing warn-without-fail (three patterns this repo uses already):**

| Pattern | How it works | Example in this repo |
|---|---|---|
| `continue-on-error: true` on a step | Step exit 1 is absorbed; job continues; annotation still emits | `plugin-shell-tests` advisory bats step |
| Exit 0 + `::warning::` | Script emits annotation but always exits 0 | `pnpm audit \|\| echo "::warning::..."` in security-audit job |
| Separate non-required job | Job is not listed as a required check in branch protection | Not yet used, but the correct model for the missing-doc heuristic |

**Recommendation for `validate-solutions.js`:**

- **Blocking slug-duplicate check**: add as a step inside the existing
  `validate-schemas` matrix (new `target: solutions`). Exit 1 on Jaccard >= 0.6.
  Use `::error file=...::` for each collision pair.
- **Non-blocking missing-doc heuristic**: add as a **separate job**
  (`advisory-doc-check`) with `continue-on-error: true` at the job level.
  This job is NOT added to the required-checks list in branch protection.
  It emits `::warning::` annotations visible to authors without ever blocking merge.

The separate-non-required-job pattern is the correct approach because:
(a) `continue-on-error: true` at step level still marks the job as failed if
any other step fails; (b) a dedicated advisory job makes the intent explicit
in the YAML; (c) it can be listed in `report-metrics` for observability without
blocking `ci-status`.

This pattern is documented as the standard workaround by the GitHub community
(the feature request for a native "warning" check status has been open since
2022 and GitHub has not committed to implementing it).
Source: [GitHub community discussion #11592](https://github.com/orgs/community/discussions/11592)

**Emitting annotations from Node.js scripts (consistent with existing validate-*.js style):**

```js
// Use the same ::warning:: prefix pattern as lint-plugins.sh
function warn(file, msg) {
  if (process.env.GITHUB_ACTIONS === 'true') {
    const escaped = msg.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    const fileParam = file ? ` file=${file}` : '';
    console.log(`::warning${fileParam}::${escaped}`);
  }
  console.error(`[validate-solutions] WARN: ${msg}`);
}
```

This mirrors the `ga_escape` + `emit_annotation` pattern in `scripts/lint-plugins.sh`
(lines 39–57) — copy that convention exactly.

---

### 3. "PR Resolves Bug Label But Missing Doc" Heuristics

**Decision context:** The non-blocking heuristic in Decision 4 triggers when a PR
closes an issue labeled `bug`/`P0`/`P1` with no new file under `docs/solutions/`.
No widely-adopted OSS pattern for this specific combination was found in research —
it is an area where this repo would be pioneering rather than following established
practice.

**What was found:**

1. **Issue label detection from PR** — The standard GitHub Actions approach:

   ```yaml
   # In the check step, use github.event.pull_request.number to fetch
   # linked issues via the GraphQL closingIssuesReferences API:
   gh api graphql -f query='
     query($pr: Int!, $owner: String!, $repo: String!) {
       repository(owner: $owner, name: $repo) {
         pullRequest(number: $pr) {
           closingIssuesReferences(first: 10) {
             nodes { labels(first: 10) { nodes { name } } }
           }
         }
       }
     }
   ' -f owner="$OWNER" -f repo="$REPO" -F pr="$PR_NUMBER"
   ```

   This is well-established in the repo already (see
   `docs/solutions/integration-issues/gh-api-graphql-plugin-command-template.md`
   for the 6-element required pattern). The check would parse label names from
   the response and trigger if any match `bug`, `P0`, or `P1`.

2. **File pattern signal** — Detect whether the PR adds any file matching
   `docs/solutions/**/*.md` using `git diff --name-only origin/main...HEAD`.
   If the PR closes a bug-labeled issue AND no such file is added, emit
   `::warning::`. The same `git diff` pattern is already used in
   `changeset-check` (lines 776–778 of `validate-schemas.yml`).

3. **Author fatigue prevention** — Three mechanisms from OSS practice:
   - **Opt-out comment**: If the PR body contains `<!-- no-solution-doc -->` or
     similar sentinel, skip the check. This mirrors the `[skip ci]` convention.
   - **Label exemption**: PRs labeled `skip-doc-check` bypass the heuristic.
     Authors who have already updated an existing doc (rather than creating one)
     apply this label. This prevents the check from firing on "update existing
     doc" PRs.
   - **Non-required job**: The heuristic job is not a branch protection
     requirement. Authors can merge over the warning — the check creates friction
     without being a gate.

4. **Narrow the label list to reduce noise.** Only `P0` and `P1` labels (not
   generic `bug`) should trigger the hard-to-ignore annotation. `bug` alone
   produces too many false positives (every small bug fix triggers it). Reserve
   `bug` for the softest advisory tier, if used at all.

Source for `closingIssuesReferences`: standard GitHub GraphQL API; documented
at [GitHub Docs](https://docs.github.com/en/graphql/reference/objects#pullrequest).

---

### 4. Solution-Doc / ADR / Postmortem Authoring Conventions

**Decision context:** The `docs/solutions/<category>/` tree is this repo's
native format. Research finds three dominant external formats worth comparing.

**Nygard ADR (canonical, 2011):**
Sections: Title, Status, Context, Decision, Consequences.
Concise, prose-oriented, no options analysis. Best for capturing a single
architectural choice with its rationale. Widely adopted; supported by `adr-tools`
CLI for numbering and cross-linking.
Source: [Nygard template](https://github.com/joelparkerhenderson/architecture-decision-record/blob/main/locales/en/templates/decision-record-template-by-michael-nygard/index.md)

**MADR (Markdown Architectural Decision Records, 2024 recommended):**
Adds: Options Considered, Decision Outcome with Pros/Cons. More structured than
Nygard; has a VS Code extension and active tooling. Appropriate when the
decision space involves multiple concrete alternatives.
Source: [adr.github.io](https://adr.github.io/adr-templates/)

**Google SRE Postmortem:**
Mandatory sections: Impact, Timeline, Root Cause, Contributing Causes,
Action Items (with owner + deadline). Trigger criteria are defined ahead of
time (user-visible outage, data loss, on-call intervention). Blameless framing
is the load-bearing principle — documents must not assign individual fault.
Source: [Google SRE Book — Postmortem Culture](https://sre.google/sre-book/postmortem-culture/)

**Comparison to `docs/solutions/<category>/` format:**

The existing solution doc structure (observed from corpus):

```yaml
---
title: "..."
date: "YYYY-MM-DD"
category: "..."
track: knowledge
problem: "..."
tags: [...]
components: [...]
---

# Title
## Problems / ## Problem
## Root Causes / ## Root Cause
## Fix
## Prevention
## Related Documentation
```

This format is a hybrid of Nygard ADR (Status → omitted; Context → Problems)
and Google SRE postmortem (Root Cause, Fix/Action Items, Prevention). It is
appropriate for this repo's use case: the "decisions" are already made (the
fix is committed); the doc captures the failure pattern and prevention recipe.

**Recommendations for consistency:**

1. Standardize frontmatter fields. Three fields vary across existing docs:
   `problem` vs `problems` (both appear in the corpus). Pick one — `problem` —
   and add it to the slug/keyword extraction logic in `validate-solutions.js`.

2. `Prevention` section is the most valuable for recurrence prevention and
   MEMORY.md authoring. Make it required (validated by the linter). The
   compound-lifecycle skill's knowledge-compounder already extracts prevention
   patterns — a consistent heading makes that extraction reliable.

3. Do NOT adopt full MADR for solution docs. Solution docs document what
   happened, not what was decided. The "options considered" section adds no
   value when the option space is already collapsed by the incident.
   ADR format is appropriate if/when the repo introduces an architecture
   decision log (`docs/decisions/`) as a separate tree.

---

### 5. Knowledge-Compounder-Equivalent Agent Flows

**Decision context:** Decision 5 specifies that the knowledge-compounder agent
drafts the MEMORY.md line and frontmatter in the same PR. Research finds no
widely-adopted OSS pattern for this exact flow, but adjacent patterns exist.

**What was found:**

1. **AI PR reviewer + postmortem link enforcement.** The Claude PR Reviewer
   GitHub Action (2025) reads `CLAUDE.md`/`AGENTS.md` for project-specific
   rules and enforces them as inline PR comments. This is the closest OSS
   analogue: an agent reads a rule file and checks whether PR content satisfies
   it. For this repo, the rule would be: "if this PR closes a P0/P1 issue,
   does it include a file under `docs/solutions/`?"
   Source: [Claude PR Reviewer — GitHub Marketplace](https://github.com/marketplace/actions/claude-pr-reviewer)

2. **PR template enforces postmortem link.** A simpler pattern: add a checkbox
   to `.github/pull_request_template.md`:

   ```markdown
   - [ ] If this PR closes a P0/P1 issue, I have added or updated a solution
         doc under `docs/solutions/`. If not applicable, check anyway and note why.
   ```

   This is zero-infrastructure but relies on author discipline. The CI
   heuristic (Area 3) is the enforcement backstop.

3. **Pre-commit hook for doc creation.** Pre-commit hooks can detect `fix:`
   commits and prompt for a solution doc path. However, pre-commit hooks are
   not enforced in CI and are skipped with `--no-verify`. Not recommended as
   the primary mechanism — use CI instead.

4. **In-PR agent mode for knowledge-compounder.** The existing compound-lifecycle
   skill runs post-hoc. The brainstorm decision (Decision 5) to add an in-PR mode
   aligns with the Claude Code PR Review pattern: the agent runs as part of
   the PR review cycle, reads the diff, and if it detects a fix-class change,
   drafts a `docs/solutions/` file and MEMORY.md line as a PR comment or
   committed artifact for author review. This is the highest-value change
   because it eliminates the "author forgets to write the doc" failure mode
   at the moment of highest context.

**Concrete implementation sketch for in-PR mode:**

```text
Trigger: PostToolUse on `gt stack submit` OR a GitHub Actions job
  that fires on pull_request events for `fix:` commits
Agent reads: git diff, linked issue labels
Agent outputs:
  1. Draft `docs/solutions/<category>/<slug>.md` with frontmatter
     and sections pre-filled from the diff context
  2. One-line MEMORY.md entry (dry-run, shown as suggestion)
  3. AskUserQuestion: "Review and approve the solution doc draft?"
Author reviews → approves → agent commits both files to the PR branch
```

This matches the "same PR, agent-written, author-reviewed" model in Decision 5
without requiring a separate post-PR session.

---

### 6. This Repo's Existing Conventions (Implementation Anchors)

These facts from reading the repo directly constrain implementation choices.

**CI annotation pattern (from `scripts/lint-plugins.sh`):**
The `ga_escape` + `emit_annotation` functions (lines 39–57) are the established
model for emitting `::warning::` and `::error::` from shell scripts with
file-anchored annotations. The new `validate-solutions.js` should replicate
this in Node.js using the snippet in Area 2 above.

**ERROR-* code convention (from `packages/domain/src/validation/errorCatalog.ts`):**
New solution-doc validation errors should follow `ERROR-{CATEGORY}-{NUMBER}`.
Suggested codes for `validate-solutions.js`:
- `ERROR-SOL-001` — slug exact collision with existing doc
- `ERROR-SOL-002` — Jaccard overlap above block threshold (>= 0.6)
- `ERROR-SOL-003` — frontmatter missing required field (`title`, `date`, `category`)
- `WARN-SOL-001` — Jaccard overlap in warn band (0.4–0.59)
- `WARN-SOL-002` — PR closes bug/P0/P1 issue with no new solution doc

The `WARN-` prefix is non-standard (current catalog uses only `ERROR-`). Options:
(a) add `WARN-SOL-*` as a new prefix class, or (b) use `ERROR-SOL-*` for both
and distinguish severity via the `ErrorSeverity` enum (`warning` vs `error`).
Option (b) is cleaner given the existing `ErrorSeverity` type in `validation/types.ts`.

**`validate-schemas.yml` matrix pattern:**
New `target: solutions` entry in the matrix runs `validate-solutions.js` the
same way `target: plugins` runs `validate-plugin.js`. The advisory missing-doc
job is a separate top-level job (not in the matrix) with `continue-on-error: true`.
Both jobs should feed into `report-metrics` via the existing
`./scripts/export-ci-metrics.sh` pattern for SLO tracking.

**Path filter for the solutions check:**

```yaml
on:
  pull_request:
    paths:
      - 'docs/solutions/**'
      - 'scripts/validate-solutions.js'
      - '.github/workflows/validate-schemas.yml'
```

The missing-doc advisory job should also trigger on `plugins/**` changes (not
just `docs/solutions/**`), since the check fires when a plugin change is present
without a doc change.

---

### Summary: 3-5 Concrete Recommendations Per Area

**Area 1 (Duplicate detection):**
1. Exact slug match → block (zero cost, zero false positives)
2. Token Jaccard on slug + `title:` + `problem:` frontmatter, threshold 0.5 warn / 0.6 block
3. Exclude domain-specific stop words (`hook`, `plugin`, `agent`, `pr`, `ci`)
4. Same-category comparison first; cross-category is warn-only
5. No full-body comparison in CI — defer to compound-lifecycle skill

**Area 2 (CI warn vs block):**
1. `::warning file=...::` syntax for all non-blocking findings (mirrors lint-plugins.sh)
2. Slug collision → `target: solutions` matrix job → exit 1 → blocking
3. Missing-doc heuristic → separate advisory job → `continue-on-error: true` → non-blocking
4. Advisory job excluded from branch protection required checks and from `ci-status` gate
5. Both jobs report to `report-metrics` via `export-ci-metrics.sh`

**Area 3 (Bug-label missing-doc heuristic):**
1. Use `closingIssuesReferences` GraphQL API to detect linked issue labels
2. Trigger on `P0`/`P1` only (not bare `bug`) to limit false positives
3. Opt-out via `<!-- no-solution-doc -->` in PR body or `skip-doc-check` label
4. Git diff detects new `docs/solutions/**/*.md` files as the "doc present" signal
5. Applies the 6-element `gh api graphql` pattern from the existing solution doc

**Area 4 (Solution doc format):**
1. Keep existing hybrid format (Problems → Root Cause → Fix → Prevention)
2. Standardize frontmatter: `title`, `date`, `category`, `problem`, `tags` as required fields
3. `Prevention` section required — validated by the linter
4. Do not adopt MADR options-table structure for solution docs (wrong use case)
5. Reserve Nygard/MADR for a future `docs/decisions/` ADR tree if architectural decisions need capturing

**Area 5 (AI-assisted knowledge capture):**
1. In-PR mode for knowledge-compounder: trigger on `fix:` commits, draft doc + MEMORY.md line
2. PR template checkbox as zero-infrastructure backstop
3. CI heuristic (Area 3) as the enforcement layer the agent drafts for
4. No pre-commit hooks — they are bypassable and not enforceable in CI
5. Agent output goes through AskUserQuestion before commit — human review is mandatory
