---
name: plan:complete
description: 'Archive a completed plan with two safety gates: Gate A scans for unchecked task boxes; Gate C verifies merged-PR evidence via file-commit provenance, then a strict slug match, then a loose token-coverage fallback. Use when a plan is fully shipped and ready to move from plans/ to plans/complete/.'
argument-hint: '<plan-filename>'
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# Plan Complete

Archives a single open plan from `plans/<arg>.md` to
`plans/complete/<arg>.md` via two gates:

- **Gate A** (mechanical): scans the plan body for `^[[:space:]]*- \[ \]` —
  any unchecked task box is a hard block. The PR-diff-scoped
  `validate-plans.js` CI gate enforces the same rule on archived files in
  the diff; running `/plan:complete` locally catches the same issue
  before commit.
- **Gate C** (evidence): tiered merged-PR match. A file-provenance tier
  runs first: it finds the commit that most recently touched the plan
  file on `origin/main` and looks up the merged PR(s) GitHub associates
  with that commit — exact, not fuzzy. A unique match passes without
  prompting, recorded via a `Plan-Verifier-FileProvenance:` commit
  trailer. When that tier finds no commit or an ambiguous set of PRs
  (rare — e.g. history rewrites, cherry-picks), the strict tier queries
  GitHub for a merged PR whose title and branch contain the full slug
  with word boundaries. When it also finds nothing (branch names rarely
  carry the full plan slug), a loose tier scores the 100 most recent
  merged PRs by slug-token coverage over branch + title: a UNIQUE PR
  containing all slug tokens except at most one (all of them for slugs
  of ≤3 tokens) passes without prompting, recorded via a
  `Plan-Verifier-LooseMatch:` commit trailer. Ambiguous (2+) or zero
  loose matches prompt the user for a PR-number override
  (`Plan-Verifier-Override:` trailer captures the decision).

This command does NOT delete the source file or push directly to main —
it creates an archival branch (`plan/archive-<slug>`), records the
rename via `git mv`, commits, and submits via `gt submit --no-interactive`.
Review and merge land via the normal PR flow.

Sibling commands: `/plan:status` (read-only dashboard),
`/workflows:plan` (creates plans). See `plugins/yellow-core/CLAUDE.md`
for the namespace split.

## Input

`#$ARGUMENTS` — the filename inside `plans/` (e.g.,
`solution-doc-git-workflow.md` or
`2026-05-08-plan-lifecycle-management.md`). A leading `plans/` prefix is
accepted and stripped (tab-completion convenience).

## Phase 0: Prerequisites

```bash
set -euo pipefail
command -v gh >/dev/null 2>&1 || { printf '[plan:complete] error: gh not installed\n' >&2; exit 1; }
command -v gt >/dev/null 2>&1 || { printf '[plan:complete] error: gt not installed\n' >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { printf '[plan:complete] error: jq not installed\n' >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { printf '[plan:complete] error: gh not authenticated (run: gh auth login)\n' >&2; exit 1; }
# Clear any stale state from a prior aborted run. Without this, a previous
# run that wrote the override in Phase 4 then cancelled at the Phase 5
# dirty-tree prompt would leave the file behind, and the NEXT run for a
# different plan would stamp that stale PR number into its commit trailer
# (review finding, correctness + adversarial).
# Resolve the git tmp dir via `git rev-parse --git-path` so this works from a
# linked worktree, where `.git` is a file (gitdir pointer) and a literal
# `.git/tmp` path would fail with "Not a directory".
GIT_TMP=$(git rev-parse --git-path tmp)
rm -f "$GIT_TMP/plan-complete.count" "$GIT_TMP/plan-complete.override" "$GIT_TMP/plan-complete.loose" "$GIT_TMP/plan-complete.provenance"
```

## Phase 1: Filename validation + slug derivation

Every Bash block is a fresh subprocess; argument and derived variables
must be reconstructed in each block that uses them. See MEMORY.md "$VAR
in bash code blocks". The block below derives both `CLEAN_ARG` and
`SLUG` so subsequent steps can re-derive consistently.

```bash
set -euo pipefail
ARG="$ARGUMENTS"
if [ -z "$ARG" ]; then
  printf '[plan:complete] error: missing plan filename argument\n' >&2
  exit 1
fi
# Strip leading `plans/` for tab-completion ergonomics.
CLEAN_ARG="${ARG#plans/}"
# Reject path traversal, slashes, leading hyphen, and uppercase. The pattern
# mirrors the post-derivation slug contract below (optional YYYY-MM-DD- date
# prefix + lowercase kebab-case) so an invalid name is rejected HERE with a
# clear message rather than passing this gate and failing later as a
# confusing "derived slug contains invalid characters" error. Underscores
# and dots are intentionally excluded: a dot in a slug becomes a regex
# wildcard in the Phase 4 headRefName boundary test.
if ! printf '%s' "$CLEAN_ARG" | grep -qE '^([0-9]{4}-[0-9]{2}-[0-9]{2}-)?[a-z0-9]+(-[a-z0-9]+)*\.md$'; then
  printf '[plan:complete] error: invalid filename %s (optional YYYY-MM-DD- prefix + lowercase kebab-case + .md)\n' "$CLEAN_ARG" >&2
  exit 1
fi
# Derive slug: strip optional YYYY-MM-DD- prefix.
SLUG=$(basename "$CLEAN_ARG" .md | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-//')
# Post-derivation regex: lowercase alphanumeric + single hyphens,
# no leading/trailing/consecutive hyphens. Guards prompt-injection
# of any shell context (the slug is interpolated into `gh` and
# `git` commands further down).
if ! printf '%s' "$SLUG" | grep -qE '^[a-z0-9]+(-[a-z0-9]+)*$'; then
  printf '[plan:complete] error: derived slug %s contains invalid characters\n' "$SLUG" >&2
  exit 1
fi
printf '[plan:complete] arg=%s slug=%s\n' "$CLEAN_ARG" "$SLUG"
```

## Phase 2: Idempotency guard + source-file existence

```bash
set -euo pipefail
ARG="$ARGUMENTS"
CLEAN_ARG="${ARG#plans/}"
if [ -f "plans/complete/$CLEAN_ARG" ]; then
  printf '[plan:complete] already archived: plans/complete/%s exists. Nothing to do.\n' "$CLEAN_ARG" >&2
  exit 0
fi
if [ ! -f "plans/$CLEAN_ARG" ]; then
  printf '[plan:complete] error: source file plans/%s does not exist\n' "$CLEAN_ARG" >&2
  exit 1
fi
```

**If the bash block above exited 0 with an "already archived" message,
stop the workflow — do not proceed to Phase 3.** (The early `exit 0` ends
the subprocess but not your turn; this instruction ends the turn.)

## Phase 3: Gate A — unchecked-box scan

The same mechanical check applied by `scripts/validate-plans.js` on
archived files in the PR diff. Running it here gates archival locally
before any branch is created.

```bash
set -euo pipefail
ARG="$ARGUMENTS"
CLEAN_ARG="${ARG#plans/}"
UNCHECKED=$(grep -cE '^[[:space:]]*- \[ \]' "plans/$CLEAN_ARG" 2>/dev/null || true)
: "${UNCHECKED:=0}"
if [ "$UNCHECKED" -gt 0 ]; then
  printf '[plan:complete] Gate A FAIL: %d unchecked task box(es) in plans/%s\n' "$UNCHECKED" "$CLEAN_ARG" >&2
  printf '             Complete or remove the open tasks before archiving.\n' >&2
  exit 1
fi
printf '[plan:complete] Gate A PASS: no unchecked boxes in plans/%s\n' "$CLEAN_ARG"
```

## Phase 4: Gate C — merged-PR evidence

A file-provenance tier runs first: it asks git+GitHub directly "which
merged PR last touched this exact file?" instead of pattern-matching a
slug against a PR's title/branch. This is exact, not fuzzy, and catches
the routine case a slug-match can't: a plan expanded from a shell and
implemented in the same PR (`/workflows:expand-shell` + `/workflows:work`
bundled into one PR) has a branch name derived from the FEATURE, not the
plan slug — e.g. plan slug `claude-code-codex-plugin-pilot-02-codex-tooling`
merged via branch `agent/feat/codex-pilot-02-codex-tooling`, which shares
only 4 of the slug's 7 tokens and fails even the loose tier's threshold.
The commit that added or last modified the plan file IS the evidence in
that case; no heuristic scoring needed.

```bash
set -euo pipefail
ARG="$ARGUMENTS"
CLEAN_ARG="${ARG#plans/}"
GIT_TMP=$(git rev-parse --git-path tmp)
mkdir -p "$GIT_TMP"
OWNERREPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
# origin/main, not local HEAD: the local checkout may be on a stale or
# unrelated branch when /plan:complete runs (Phase 6 doesn't sync trunk
# until after Gate C), so `git log` must start from a ref guaranteed to
# carry the merge commit rather than defaulting to a possibly-behind HEAD.
git fetch origin main --quiet 2>/dev/null || \
  printf '[plan:complete] WARNING: git fetch origin main failed; provenance tier may see a stale history\n' >&2
FILE_SHA=$(git log -1 --format=%H origin/main -- "plans/$CLEAN_ARG" 2>/dev/null || true)
PCOUNT=0
if [ -n "$FILE_SHA" ] && [ -n "$OWNERREPO" ]; then
  GH_ERR=$(mktemp)
  # GitHub's commits/{sha}/pulls endpoint returns every PR a commit is
  # associated with (open, closed-unmerged, merged) — filter to merged
  # only, since an open or abandoned PR touching the file is not
  # completion evidence.
  PULLS=$(gh api "repos/$OWNERREPO/commits/$FILE_SHA/pulls" \
    --jq '[.[] | select(.merged_at != null) | {number, title, url: .html_url}]' 2>|"$GH_ERR") || {
    printf '[plan:complete] WARNING: gh api commits/pulls lookup failed: %s\n' "$(cat "$GH_ERR")" >&2
    PULLS='[]'
  }
  rm -f "$GH_ERR"
  PCOUNT=$(printf '%s' "$PULLS" | jq 'length' 2>/dev/null || printf '0')
fi
printf '[plan:complete] Gate C provenance tier: %d merged PR(s) associated with the commit that last touched plans/%s\n' "$PCOUNT" "$CLEAN_ARG"
if [ "$PCOUNT" -ge 1 ]; then
  printf '%s\n' "$PULLS" | jq -r '.[] | "  #\(.number) — \(.title)\n    \(.url)"'
fi
if [ "$PCOUNT" -eq 1 ]; then
  printf '%s\n' "$PULLS" | jq -r --arg sha "$FILE_SHA" '.[0] | "pr=#\(.number) sha=\($sha)"' >| "$GIT_TMP/plan-complete.provenance"
fi
```

**If `PCOUNT == 1` (Gate C provenance PASS): skip the strict tier, the
loose tier, and the AskUserQuestion below entirely — proceed directly to
Phase 5.** A single merged PR associated with the file's last-touching
commit is direct evidence, stronger than any slug heuristic.

**If `PCOUNT == 0`** (no local commit found for the file — e.g. it is
uncommitted, or `git fetch`/`gh api` failed) **or `PCOUNT >= 2`** (the
commit is associated with more than one merged PR — rare, e.g. a
rebase/cherry-pick history), **fall through to the strict tier below.**
Multiple associated PRs is not a safe auto-pass; uniqueness is what makes
this tier trustworthy, same as the loose tier's own safety valve.

Server-side `--state merged` is preferred over reading `mergedAt`: per
`docs/solutions/integration-issues/merge-queue-closed-pr-null-mergedat-detection.md`,
`mergedAt` can be null for recently MQ-merged PRs during propagation lag.
GitHub's `in:title` qualifier is token-based and case-insensitive
(hyphens split tokens — `in:title "foo-bar"` matches a PR titled
`foo bar`), so the title search is a COARSE pre-filter only; the
authoritative match comes from the `--jq` post-filter on `headRefName`
which enforces a word boundary (`^|$|/|_|-`) around `$SLUG`. This strict
tier runs when the provenance tier above did not uniquely pass; the loose
token-coverage tier further below handles the common case where the
branch name carries only part of the slug.

```bash
set -euo pipefail
ARG="$ARGUMENTS"
CLEAN_ARG="${ARG#plans/}"
SLUG=$(basename "$CLEAN_ARG" .md | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-//')
# Capture stderr (not /dev/null) so an auth/network failure is surfaced
# rather than silently collapsing to "no PR found" → spurious override
# prompt (review finding, pattern-recognition P1). A genuine empty result
# is `[]` with exit 0; a real failure prints to GH_ERR and we warn.
# `2>|` (not `2>`): mktemp pre-creates the file, and under zsh noclobber a
# plain `2>` onto an existing file fails — collapsing every run to "[]"
# and forcing a spurious override prompt. See
# docs/solutions/logic-errors/zsh-noclobber-mktemp-stderr-redirect.md.
GH_ERR=$(mktemp)
# shellcheck disable=SC2016
MERGED=$(gh pr list \
  --search "in:title \"$SLUG\"" \
  --state merged \
  --limit 100 \
  --json number,title,headRefName,url \
  --jq '[.[] | select(.headRefName | test("(^|[/_-])'"$SLUG"'($|[/_-])"))]' 2>|"$GH_ERR") || {
  printf '[plan:complete] WARNING: gh pr list failed (auth/network?): %s\n' "$(cat "$GH_ERR")" >&2
  printf '[plan:complete] Treating as no-evidence; you will be prompted to confirm or cancel.\n' >&2
  MERGED='[]'
}
rm -f "$GH_ERR"
COUNT=$(printf '%s' "$MERGED" | jq 'length' 2>/dev/null || printf '0')
printf '[plan:complete] Gate C strict tier: %d merged PR(s) match slug %s with word boundary\n' "$COUNT" "$SLUG"
if [ "$COUNT" -ge 1 ]; then
  printf '%s\n' "$MERGED" | jq -r '.[] | "  #\(.number) — \(.title)\n    \(.url)"'
fi
# Store COUNT for the next step. Persist via temp file because the next
# Bash block is a fresh subprocess. (The matched-PR list is already shown
# inline above; only COUNT is consumed downstream in Phase 7.) Resolve the
# git tmp dir via `git rev-parse --git-path` so it works from a linked
# worktree where `.git` is a gitdir-pointer file, not a directory.
GIT_TMP=$(git rev-parse --git-path tmp)
mkdir -p "$GIT_TMP"
printf '%s\n' "$COUNT" > "$GIT_TMP/plan-complete.count"
```

**If `COUNT >= 1` (Gate C strict PASS): skip the loose tier and the
AskUserQuestion below entirely and proceed directly to Phase 5.**

**If `COUNT == 0`, run the loose tier below.** Branch names rarely carry
the full plan slug (e.g. branch `agent/feat/ruvector-error-fix-memory`
for plan slug `ruvector-error-fix-memory-mvp`), so strict-tier misses
are routine for legitimately-completed plans. The loose tier fetches the
100 most recently created merged PRs (plans are archived close to their
PR's merge, so the recency window is acceptable; older evidence can
still be supplied via the override prompt) and scores each by slug-token
coverage over the union of branch-name and title tokens. The threshold
is all-but-one slug token — full coverage for slugs of ≤3 tokens, where
dropping a token would let generic tokens (`yellow`, `plugin`) match
unrelated PRs. Verified against live repo data (2026-07-18):
`ruvector-error-fix-memory-mvp` and
`review-resolve-branch-correctness-guard` each uniquely matched their
real PR at 5/5 and 4/5 coverage, while the short-slug FP probe
`yellow-rtk-plugin` — which a plain 2/3 threshold wrongly matched to an
unrelated removal PR — correctly returned no match.

```bash
set -euo pipefail
ARG="$ARGUMENTS"
CLEAN_ARG="${ARG#plans/}"
SLUG=$(basename "$CLEAN_ARG" .md | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-//')
GIT_TMP=$(git rev-parse --git-path tmp)
mkdir -p "$GIT_TMP"
GH_ERR=$(mktemp)
RECENT=$(gh pr list \
  --state merged \
  --limit 100 \
  --json number,title,headRefName,url 2>|"$GH_ERR") || {
  printf '[plan:complete] WARNING: gh pr list failed (auth/network?): %s\n' "$(cat "$GH_ERR")" >&2
  RECENT='[]'
}
rm -f "$GH_ERR"
# Unique-ify tokens so a repeated slug token cannot double-count toward
# the threshold. The Phase 1 slug regex guarantees lowercase [a-z0-9-],
# so splitting on "-" is total.
TOKS=$(printf '%s' "$SLUG" | jq -R 'split("-") | unique')
# All-but-one coverage via integer math: hits >= total - 1 for slugs of
# >=4 tokens; hits == total for <=3 tokens (see the FP note above).
LOOSE=$(printf '%s' "$RECENT" | jq --argjson toks "$TOKS" '
  [ .[]
    | . as $pr
    | (($pr.headRefName + " " + $pr.title) | ascii_downcase | [scan("[a-z0-9]+")]) as $words
    | ($toks | map(select(. as $t | $words | index($t))) | length) as $hits
    | select($hits >= (($toks | length) - (if ($toks | length) >= 4 then 1 else 0 end)))
    | $pr + {hits: $hits, total: ($toks | length)} ]')
LCOUNT=$(printf '%s' "$LOOSE" | jq 'length' 2>/dev/null || printf '0')
if [ "$LCOUNT" -eq 1 ]; then
  printf '[plan:complete] Gate C LOOSE PASS: unique token-coverage match:\n'
  printf '%s\n' "$LOOSE" | jq -r '.[] | "  #\(.number) — \(.title)\n    \(.url) [branch: \(.headRefName), coverage \(.hits)/\(.total)]"'
  printf '%s\n' "$LOOSE" | jq -r '.[0] | "pr=#\(.number) coverage=\(.hits)/\(.total)"' >| "$GIT_TMP/plan-complete.loose"
elif [ "$LCOUNT" -ge 2 ]; then
  printf '[plan:complete] Gate C LOOSE AMBIGUOUS: %d merged PRs reach the token-coverage threshold:\n' "$LCOUNT"
  printf '%s\n' "$LOOSE" | jq -r '.[] | "  #\(.number) — \(.title)\n    \(.url) [branch: \(.headRefName), coverage \(.hits)/\(.total)]"'
else
  printf '[plan:complete] Gate C NO-EVIDENCE: no merged PR reaches the loose token-coverage threshold.\n'
fi
```

**Loose-tier outcomes:**

- **`LOOSE PASS` (exactly one match):** skip the AskUserQuestion below
  and proceed directly to Phase 5 — no prompt. The evidence is printed
  above and recorded for the `Plan-Verifier-LooseMatch:` commit trailer
  in Phase 7. Uniqueness is the safety valve: a single qualifying PR
  among the last 100 merged is strong evidence; anything ambiguous
  still prompts.
- **`LOOSE AMBIGUOUS` (2 or more matches):** prompt via the
  AskUserQuestion below, and include the candidate list (PR numbers +
  titles from the block's output) in the question text so the user can
  type the right number.
- **`NO-EVIDENCE` (zero matches):** prompt via the AskUserQuestion
  below.

Prompt the user via `AskUserQuestion` with the
following options. **The label of the free-text option MUST be the
literal string `Other`** — per MEMORY.md "AskUserQuestion 'Other' is
the ONLY free-text button", any other label (e.g.,
`Confirm with PR number`) shows as a click-only option and does NOT
open a text input.

**AskUserQuestion (only if the loose tier did NOT produce a unique
match):**

- Question: `No unique merged-PR evidence found for slug "<SLUG>"
  (strict and loose tiers). Provide a PR number to confirm, or cancel.`
  — for `LOOSE AMBIGUOUS`, append the candidate list.
- Header: `Override`
- Options:
  - Label: `Other` — Description: `Provide the PR number that
    completes this plan; the override is recorded in the commit
    trailer.`
  - Label: `Cancel` — Description: `Stop the archival. The plan
    stays in plans/.`

If the user picks `Cancel`, **stop the workflow** — do not proceed to
the next phase.

If the user enters a PR number via `Other`, persist it for the commit
trailer in Phase 7. **Substitute `<USER_RESPONSE_FROM_OTHER>` in the
block below with the exact text the user typed in the AskUserQuestion
"Other" input field** — do not run the block with the literal
placeholder.

```bash
set -euo pipefail
# Validate the user-provided PR number is a bare positive integer.
# Read the user's typed value through a QUOTED heredoc so no shell
# metacharacter in the input (e.g. a stray quote or `$`) can break out
# of the substitution before validation runs — this is the canonical
# "free text into shell" pattern (MEMORY.md "Heredoc for user-supplied
# free text"). The collision-resistant delimiter avoids premature close.
# tr -d strips CR/LF so a multi-line paste cannot smuggle extra content
# past the grep into the commit trailer (trailer injection).
PR_NUM=$(tr -d '\r\n' <<'__EOF_PR_OVERRIDE__'
<USER_RESPONSE_FROM_OTHER>
__EOF_PR_OVERRIDE__
)
if ! printf '%s' "$PR_NUM" | grep -qE '^[1-9][0-9]{0,9}$'; then
  printf '[plan:complete] error: invalid PR number override %s\n' "$PR_NUM" >&2
  exit 1
fi
GIT_TMP=$(git rev-parse --git-path tmp)
mkdir -p "$GIT_TMP"
printf '%s\n' "$PR_NUM" > "$GIT_TMP/plan-complete.override"
```

## Phase 5: Working-tree check

A non-empty working tree is a warning, not a block — the user may have
unrelated WIP to preserve. AskUserQuestion confirms before proceeding.

```bash
set -euo pipefail
PORCELAIN=$(git status --porcelain)
if [ -n "$PORCELAIN" ]; then
  printf '[plan:complete] DIRTY_TREE=1\n'
  printf '%s\n' "$PORCELAIN"
  # Tracked, modified files (index or worktree M/A/D/R in the first two
  # columns, excluding untracked '??') will make the `git checkout main`
  # in Phase 6 fail under `set -e`. Warn specifically so the user can
  # stash rather than picking Proceed and stranding the run mid-checkout.
  if printf '%s\n' "$PORCELAIN" | grep -qE '^[ MADRC]'; then
    printf '[plan:complete] NOTE: tracked changes present — git checkout main in Phase 6 may refuse. Consider stashing before Proceed.\n' >&2
  fi
else
  printf '[plan:complete] DIRTY_TREE=0\n'
fi
```

**If the block printed `DIRTY_TREE=0`, skip the AskUserQuestion below and
proceed directly to Phase 6.** Only when it printed `DIRTY_TREE=1` do you
prompt via `AskUserQuestion`:

- Question: `Working tree has uncommitted changes. Proceed with
  archival anyway?`
- Header: `Dirty tree`
- Options:
  - Label: `Proceed` — Description: `Carry the WIP into the archival
    branch. If a NOTE about tracked changes appeared, stash first — the
    checkout in Phase 6 will refuse otherwise.`
  - Label: `Cancel` — Description: `Stop. Commit or stash the WIP
    first.`

If `Cancel`, **stop the workflow** — do not proceed to Phase 6.

## Phase 6: Sync trunk + create archival branch

```bash
set -euo pipefail
ARG="$ARGUMENTS"
CLEAN_ARG="${ARG#plans/}"
SLUG=$(basename "$CLEAN_ARG" .md | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-//')
# Check out Graphite's CONFIGURED trunk. gt stacks against its own trunk,
# which can differ from GitHub's default branch (e.g. a repo gt-initialised
# on `develop`); basing the archival branch on the wrong trunk would stack
# the PR incorrectly. `gt checkout --trunk` resolves the configured trunk.
# Fall back to the gh default branch, then `main`, if gt cannot resolve one
# (gt is a Phase 0 prerequisite, but may be uninitialised in a fresh repo).
if ! gt checkout --trunk 2>/dev/null; then
  TRUNK=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || true)
  [ -n "$TRUNK" ] || TRUNK=main
  git checkout "$TRUNK"
fi
gt repo sync 2>/dev/null || gt sync 2>/dev/null || \
  printf '[plan:complete] WARNING: gt sync failed; proceeding on possibly-stale trunk\n' >&2
gt create "plan/archive-$SLUG"
mkdir -p plans/complete
# git mv (not bare mv): records the rename in the index immediately
# so `git commit` in Phase 7 produces a real commit (not empty).
git mv -- "plans/$CLEAN_ARG" "plans/complete/$CLEAN_ARG"
git status --short
```

## Phase 7: Commit with override audit trail

The plan reference work (PR #556) discovered that
`gt commit create -m "<subject>" -m "<body>"` concatenates the two
`-m` values with a literal comma. Use plain `git commit -m` instead —
standard git docs guarantee multiple `-m` are joined as separate
paragraphs (subject + blank line + body). Graphite picks up the
commit on the current branch via `gt submit` in Phase 8.

```bash
set -euo pipefail
ARG="$ARGUMENTS"
CLEAN_ARG="${ARG#plans/}"
SLUG=$(basename "$CLEAN_ARG" .md | sed 's/^[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}-//')
GIT_TMP=$(git rev-parse --git-path tmp)
COUNT=$(cat "$GIT_TMP/plan-complete.count" 2>/dev/null || printf '0')
SUBJECT="docs(plans): archive completed $SLUG plan"
# Evidence priority: an explicit user override beats a loose match beats
# a provenance match beats the strict count. In practice at most one of
# these files exists per run — each tier that passes uniquely skips every
# tier after it (provenance skips strict+loose+override; loose PASS skips
# override) — but the explicit order is kept as defense in depth rather
# than relying on that invariant holding across future edits.
if [ -f "$GIT_TMP/plan-complete.override" ]; then
  OVERRIDE_PR_NUM=$(cat "$GIT_TMP/plan-complete.override")
  BODY="Verified by /plan:complete: user-confirmed override.

Plan-Verifier-Override: user-confirmed-no-pr-evidence (pr=#$OVERRIDE_PR_NUM)"
elif [ -f "$GIT_TMP/plan-complete.loose" ]; then
  LOOSE_INFO=$(cat "$GIT_TMP/plan-complete.loose")
  BODY="Verified by /plan:complete: unique loose match — all-but-one slug-token coverage on a recent merged PR's branch+title.

Plan-Verifier-LooseMatch: $LOOSE_INFO"
elif [ -f "$GIT_TMP/plan-complete.provenance" ]; then
  PROVENANCE_INFO=$(cat "$GIT_TMP/plan-complete.provenance")
  BODY="Verified by /plan:complete: unique file-provenance match — the merged PR GitHub associates with the commit that last touched this plan file.

Plan-Verifier-FileProvenance: $PROVENANCE_INFO"
else
  BODY="Verified by /plan:complete: $COUNT merged PR(s) found via gh pr list --state merged with word-boundary post-filter on headRefName."
fi
# Scope the commit to the plan-rename pathspecs only. If the user had
# pre-staged unrelated WIP and chose Proceed at the Phase 5 dirty-tree
# prompt, a bare `git commit` would bundle that WIP into the archival
# commit; the explicit pathspecs commit only the git mv (delete of the
# source + add of the destination).
git commit -m "$SUBJECT" -m "$BODY" -- "plans/$CLEAN_ARG" "plans/complete/$CLEAN_ARG"
# Clean up temp files.
rm -f "$GIT_TMP/plan-complete.count" "$GIT_TMP/plan-complete.override" "$GIT_TMP/plan-complete.loose" "$GIT_TMP/plan-complete.provenance"
```

The `Plan-Verifier-Override:`, `Plan-Verifier-LooseMatch:`, and
`Plan-Verifier-FileProvenance:` trailers are grep-discoverable via
`git log --grep='Plan-Verifier-'` for future audit. The default (Gate C
strict PASS) path omits any trailer.

## Phase 8: Submit

```bash
set -euo pipefail
gt submit --no-interactive
# Print the resulting PR URL.
gh pr view --json url -q .url 2>/dev/null || printf '[plan:complete] (submitted; PR URL unavailable — check `gt log short`)\n'
```

## Done

The plan is now on a `plan/archive-<slug>` branch with a draft PR open.
Merge via the normal review flow; the `validate:plans` CI gate will
also re-scan the archived file in the PR diff (Gate A's CI counterpart).
