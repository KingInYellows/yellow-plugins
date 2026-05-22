---
'yellow-core': minor
---

feat(yellow-core): `/workflows:compound --in-pr` mode + knowledge-compounder
in-PR fast path, plus `scripts/validate-solutions.js` slug-collision +
required-frontmatter gate

This change implements the five-prong solution-doc git-workflow policy from
`plans/solution-doc-git-workflow.md`:

- **`/workflows:compound --in-pr`** (yellow-core) — new mode that reads the
  current branch's open PR via `gh pr view` (instead of the live
  conversation transcript), drafts both the solution doc and the
  MEMORY.md index line from the PR body + commit subjects, and gates on
  the existing M3 AskUserQuestion before writing. The default authoring
  pattern documented in `CONTRIBUTING.md` "Solution Docs". Standard mode
  (no flag) is unchanged.
- **`knowledge-compounder` in-PR fast path** (yellow-core) — new branch
  in `Phase 1: Parallel Extraction` keyed off `--- begin pr-context ---`
  delimiters that skips the 5-subagent pipeline and uses PR body/commits
  directly. Runs Related Docs Finder FIRST so the suffix-collision loop is
  reserved for true structural collisions (NO_MATCH from RDF); legitimate
  updates to an existing topic route to AMEND_EXISTING and never produce a
  `-2`/`-3` suffixed file. Adds an explicit SKIP exit path for trivial-fix
  PRs (typo, version bump, no closing issue). Extends M3 to show both the
  solution doc draft and the MEMORY.md line draft inline, side by side.
- **`scripts/validate-solutions.js`** (tooling) — new diff-scoped Node
  validator wired into `pnpm validate:schemas` and the
  `validate-schemas` CI matrix as a new `solutions` target. Blocks on
  `ERROR-SOL-001` (exact slug collision) and `ERROR-SOL-002` (missing or
  invalid required frontmatter) for files added/modified in the current
  PR's diff under `docs/solutions/` (excluding `archived/`). Pre-existing
  non-conforming docs are intentionally not retroactively gated. Error
  codes added to `@yellow-plugins/domain` `errorCatalog.ts` under the new
  `ErrorCategory.SOLUTION_DOCS` enum.
- **`validate-solutions-advisory` CI job** — non-blocking job that
  queries `closingIssuesReferences` via GraphQL and emits `::warning::`
  when a PR closes a P0/P1-labeled issue but contains no
  `docs/solutions/` change. Deliberately excluded from the `ci-status`
  aggregate gate; never blocks merge.
- **`docs/solutions/integration-issues/gh-api-graphql-plugin-command-template.md`**
  — backfilled reference doc capturing the 6-element `gh api graphql`
  pattern used by the advisory job and previously cited from MEMORY.md.
  Dogfoods the new in-PR policy.

Other touch-points: `CONTRIBUTING.md` gains a `## Solution Docs` section
+ ToC entry + "Before Submitting" checklist line; `AGENTS.md` and
`docs/CLAUDE.md` cross-reference the policy; the lowercase
`.github/pull_request_template.md` gains a `## Solution doc` choice block
covering co-shipped / tracked-separately / skipped paths;
`docs/plugin-validation-guide.md` enumerates `validate:solutions` in the
validator inventory.

No breaking changes. The `--in-pr` flag is purely additive; the standard
`/workflows:compound` flow is unchanged for users who don't pass the
flag. The validator only fires on PRs that touch `docs/solutions/`.
