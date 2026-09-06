---
title: Upstream Concept-Fork Snapshot Protocol
date: 2026-04-28
category: code-quality
track: knowledge
tags: [concept-fork, upstream-drift, snapshot, versioning, plugin-authoring, everyinc, merge-plan]
problem: Concept-fork implementation plans adopt upstream skills/agents at an implicit "current main" snapshot, then accumulate silent drift as upstream ships breaking changes — causing ports to target stale APIs, deprecated command aliases, or unfixed bugs.
components: [yellow-plugins, plans]
---

# Upstream Concept-Fork Snapshot Protocol

## Problem

A concept-fork relationship — where yellow-plugins selectively ports skills,
agents, or patterns from an upstream plugin (e.g., EveryInc/compound-engineering-plugin)
— drifts silently when upstream ships breaking changes between the research
phase and the implementation phase.

Concretely observed in April 2026: CE shipped v3.0.0 on April 22 (breaking
rename of all skills to `ce-` prefix via #503), then v3.1.0, v3.2.0, v3.3.0,
and v3.3.1 in the following six days — replacing the LFG auto-resolve rubric
with best-judgment, moving artifact storage from `.context/` to `/tmp`, and
fixing a reviewer-queuing bug that silently dropped reviewers when subagent
slots filled (#716). An implementation plan authored against "main" before
April 22 would reference deprecated command aliases (`ce:review`,
`ce:document-review`), the wrong artifact path, a broken rubric description,
and would inherit the queuing bug.

## Root Cause

Implementation plans treat the upstream source as a stable reference rather
than a moving target. "Phase 0: fetch upstream snapshot" is written as
narrative intent without recording:
- the locked SHA or tagged release at time of authoring
- a check of upstream release notes for breaking changes since snapshot
- a version-pin requirement on the adopted artifact

## Fix

Apply the snapshot protocol to every concept-fork port:

**1. Lock the snapshot SHA immediately on authoring:**
```
# In the plan or adoption PR description:
upstream-snapshot: EveryInc/compound-engineering-plugin@v3.3.1 (SHA: <hash>)
snapshot-date: 2026-04-28
```

**2. Audit release notes from snapshot date backward to last plan revision:**
Before writing any adoption prose, fetch the upstream changelog between the
prior plan revision date and today. For GitHub repos:
```bash
gh api repos/EveryInc/compound-engineering-plugin/releases \
  --jq '.[] | select(.published_at > "2026-04-01") | {tag: .tag_name, body: .body}'
```
Look for: skill/agent renames, command alias deprecations, artifact path
changes, rubric replacements, bug fixes tagged with "silent failure" or
"queuing" symptoms.

**3. Version-pin to the latest patch with known-issue fixes:**
When adopting multi-agent orchestration features (reviewer pipelines, queuing
logic), explicitly pin to the release that contains the latest known-issue
fix. Do not snapshot main without checking the issue tracker for open P1 bugs.

In the plan, record:
```
minimum-upstream-version: v3.3.1  # contains reviewer-queuing fix #716
```

**4. Re-audit on plan re-open:**
Any plan that was paused and is being resumed must re-run the release notes
audit for the gap period before any Wave begins.

## Concrete CE Example (April 2026)

| CE Release | Date | Breaking / Relevant |
|---|---|---|
| v3.0.0 | 2026-04-22 | BREAKING: all skills renamed to `ce-` prefix (#503); `ce-learnings-researcher` schema path fix (#630) |
| v3.1.0 | 2026-04-23 | Swift/iOS reviewer persona added (#638) |
| v3.2.0 | 2026-04-26 | LFG rubric replaced by best-judgment; artifact paths `.context/` → `/tmp` |
| v3.3.0 | 2026-04-27 | Patch release between v3.2.0 and v3.3.1 (minor fixes; not directly load-bearing for the merge plan) |
| v3.3.1 | 2026-04-28 | Reviewer queuing fix when subagent slots filled (#716) |
| v3.3.2 | 2026-04-29 | Locked SHA `e5b397c9d1883354f03e338dd00f98be3da39f9f` — snapshot baseline used by `plans/everyinc-merge.md` (date matches `MANIFEST.md`) |

An adoption plan snapshotted before v3.0.0:
- Uses deprecated command aliases (`/plugin/workflow:plan`, `ce:review`) instead of canonical post-rename forms
- References `.context/` artifact path (wrong since v3.2.0)
- Inherits the reviewer-queuing silent-drop bug (unfixed until v3.3.1)
- References the unreadable schema path in `ce-learnings-researcher` (fixed in v3.0.0 #630)

## Prevention

- [ ] Every "Phase 0: fetch upstream" step in a port plan records: locked SHA/tag, snapshot date, release-notes-audited-from date
- [ ] Before authoring Wave N content, run `gh api ...releases` audit for upstream changes since last plan revision
- [ ] Multi-agent pipeline PRs include `minimum-upstream-version` annotation referencing the fix commit for any known queuing/silent-failure bugs
- [ ] Plans re-opened after a pause (>1 week) trigger a mandatory re-audit step before Wave 1 kickoff
- [ ] `subagent_type` registration tables and skill adoption tables list post-rename canonical names, not legacy aliases

## Related Documentation

- `plans/everyinc-merge.md` — the merge plan that surfaced this pattern (1733 lines, 19 PRs [7 backbone + 12 Wave 3], April 2026 CE v3.3.2 baseline)
- `docs/research/merge-plan-completeness-audit-april-2026.md` — research pass that identified the CE v3.0.0–v3.3.1 drift window
- MEMORY.md: "Upstream Concept-Fork Snapshotting Protocol" entry

---

## Update — 2026-09-05: verification script pitfalls in MANIFEST.md

The protocol above says to run integrity and drift-recheck scripts, but says
nothing about how those hand-run bash blocks themselves fail. PR #767's
`MANIFEST.md` (the `thermo-nuclear-code-quality-review` snapshot) shipped both
scripts with the same class of bug: on failure, they report success instead
of erroring. Because these scripts are run manually by whoever re-verifies
the snapshot later, a false "OK" is worse than no script at all — it
actively vouches for an unchecked snapshot.

Observed failure modes, all in a ~15-line bash block:

1. **Unanchored file enumeration reports "0 problems" when it finds nothing
   to check.** `find . -type f ! -name MANIFEST.md` run from the snapshot
   directory is fine, but the surrounding instructions did not `cd` into
   that directory first. Run from repo root, it fans out over the entire
   checkout; run from an unrelated directory, it matches zero files, the
   `drift` counter never increments, and the script prints
   `OK: snapshot matches upstream` with exit 0 — indistinguishable from a
   verified-clean snapshot. Fix: `cd` to the snapshot directory (or better,
   iterate the manifest's own explicit path table instead of `find`), and
   assert the checked-file count equals the expected count before trusting
   a zero-drift result.
2. **Piping a fallible command into a hash silently swallows the failure.**
   `gh api ... | sha256sum` never checks `gh`'s exit status. If the API call
   fails (auth expired, rate-limited, network down), `sha256sum` happily
   hashes empty input, the local file hashes to something else, and the
   script reports `DRIFT: <file>` — a false positive that looks like an
   upstream change but is actually a fetch error. Fix: capture `gh`'s exit
   status separately (`PIPESTATUS`, or split the pipe into `remote=$(gh api
   ...)` then check `$?` before hashing) and fail loudly on a fetch error
   rather than reporting it as drift.
3. **The drift re-check enumerates files independently of the integrity
   check, so the two lists diverge.** The integrity script derives its file
   set from `find`; the re-check script hardcodes a `for p in ...` list that
   omitted `cursor-team-kit/LICENSE`. Any file present in one path's set but
   not the other's is silently unverified by whichever check omits it. Fix:
   drive both scripts from the manifest's own explicit path table (the same
   list used in the "Snapshotted files" section) so there is exactly one
   source of truth for "which files are in scope."
4. **A blank/failed command output reads the same as a real zero.** The
   drift re-check's `gh api .../commits?path=$p&since=... --jq 'length'`
   prints an empty string and exits 0 when the API call fails, which is
   visually identical to "0 commits since pin" in the script's own output
   format. Fix: check the exit status explicitly; treat a nonzero exit (or
   empty result where a number is expected) as an unknown/error state, not
   as a verified zero.
5. **A recorded-but-unused check column is worse than no column.** The
   manifest recorded a Blob SHA per file but no script actually compared it
   to `git hash-object` output — so a reader trusts a column that nothing
   verifies. Fix: either wire the comparison into the script or drop the
   column; a table cell that looks like a check but isn't is a silent-failure
   surface in documentation form.

### Prevention (verification scripts in MANIFEST.md-style snapshots)

- [ ] Every hand-run verification script starts with `set -euo pipefail` —
      a missing flag here is how items 1-4 above go unnoticed for months.
- [ ] File enumeration is driven from the manifest's explicit path table,
      never a bare `find` from an unstated working directory. If `find` is
      used, `cd` into the target directory first and assert the resulting
      count against an expected number.
- [ ] Any command piped into a hash or comparison (`gh api ... | sha256sum`,
      `curl ... | jq`) has its own exit status checked before the piped
      output is trusted — a fallible producer feeding a hasher becomes
      untraceable once piped.
- [ ] A "0 drift" / "0 commits since pin" result is only valid when paired
      with an assertion that the check actually ran against a nonzero,
      expected file/commit set — an empty result and a verified-clean
      result must be visually and programmatically distinguishable.
- [ ] Every column in a manifest table that reads like a verification
      artifact (blob SHA, hash, checksum) either has a script that checks
      it, or is removed — don't ship a check-shaped column nothing verifies.
