---
title: 'Generator stale-sweep deleted a hand-authored file it never generated'
date: 2026-09-16
category: logic-errors
track: bug
problem: 'Generate-manifests stale-sweep deleted hand-authored hooks/hooks.json outside its generated-file contract'
tags: [generate-manifests, stale-sweep, sync-manifests, hooks-json, data-loss-prevention]
components:
  [
    scripts/generate-manifests.js,
    scripts/sync-manifests.js,
    tests/integration/generate-manifests-codex.test.ts,
    tests/integration/validate-plugin.test.ts,
  ]
---

## Problem

Routine `pnpm generate:manifests` (and `pnpm apply:changesets`, via
`scripts/sync-manifests.js`, silently) deleted a hand-authored
`plugins/<name>/hooks/hooks.json` that had no `catalog/` origin to
regenerate from. The stale-artifact sweep in `scripts/generate-manifests.js`
treats "anything in `hooks/` that isn't in my expected-paths list" as stale
and removes it — correct for files the generator itself writes
(`codex-hooks.json`, `.cursor-plugin/plugin.json`, mirrored `SKILL.md`s),
wrong for a file no catalog source ever produces. Claude Code auto-loads
`hooks/hooks.json` directly (unlike the catalog-sourced `plugin.json`
`hooks` block), so a hand-authored one is a plausible, even likely,
artifact to find sitting next to generated files — and the sweep had no
way to distinguish "stale output of a prior run" from "input I don't own."
Found during a `/review:pr` pass (adversarial, architecture personas) on
PR #798, "reject any plugins/*/hooks/hooks.json; hook config only from
catalog/".

## Symptoms

- `pnpm generate:manifests` deleted `plugins/<name>/hooks/hooks.json` with
  no warning, in normal (non-`--check`) mode.
- `pnpm apply:changesets` triggers the same sweep via
  `scripts/sync-manifests.js`, so the file could vanish from a release PR
  with no direct `generate:manifests` invocation in the visible command
  history.
- `--check` mode reported the file identically to a truly generator-owned
  stale file — nothing in the diff output distinguished the two cases, so
  there was no signal to catch the deletion before it happened.

## What Didn't Work

Treating "not in expectedPaths" as a single `stale` bucket. The sweep's
loop (`scripts/generate-manifests.js`, stale-candidate blocks starting
around line 891) enumerates candidate files under `hooks/`,
`.cursor-plugin/`, and mirrored skill directories and diffs them against
what the current catalog source would produce — but it does not
distinguish *why* a path is unexpected. A path can be unexpected because a
prior generation left it behind (safe to delete) or because it was never
the generator's to write in the first place (unsafe to delete — there is
no catalog source to regenerate it from, so deleting it destroys the only
copy).

## Solution

Give `hooks/hooks.json` its own diff state instead of folding it into
`stale`. `scripts/generate-manifests.js` (~line 931) now checks
`existsSync(forbiddenHooksJson)` explicitly and pushes
`{ path, state: 'forbidden' }` — a fourth state alongside `differs` /
`missing` / `stale`, documented in the `diffs` JSDoc (~line 583-584:
`'forbidden' = a hand-written plugins/<name>/hooks/hooks.json`). The apply
path (`for (const diff of forbidden)`, ~line 1518) never deletes a
`forbidden` entry; it only warns and sets a non-zero exit code, in both
`--check` and apply mode. The comment at ~line 923-926 explains why: this
file is "never generated, but Claude Code auto-loads it," so if the sweep
didn't special-case it, a reintroduced file would get silently deleted
again on the next run — the forbidden check exists specifically to make
that failure loud instead of silent.

## Why This Works

The fix narrows the sweep's authority to match its actual contract: "files
this generator wrote." A `forbidden` file fails the build (exit 1) so a
human has to consciously resolve it — move the hook config into
`catalog/plugins/<name>.json#hooks` and delete the file (a hand-authored
`hooks/hooks.json` is never allowed in this repo; `validate-plugin.js`
RULE 7 rejects it) — rather than the generator silently making that call by
deleting content that has no regenerable source.

## Prevention

- When writing a stale-artifact sweep (or any generator that reconciles a
  directory against an expected-output set), separate "candidates I
  generate and can safely delete" from "paths I merely don't expect" — the
  second category needs its own terminal state (report + fail), never
  silent deletion.
- Test the sweep's *unconditional* branches under every flag combination
  that reaches them, not just the common one. The same review that caught
  the deletion also caught that the new sweep test only covered
  `codexEnabled: true`, even though the sweep loop is documented as
  running regardless of that flag — fixed with `it.each` over
  Codex-enabled and Codex-disabled fixtures in
  `tests/integration/generate-manifests-codex.test.ts`.
- When documenting a fix, describe its actual post-fix mechanism (e.g.
  "no catalog/ tooling ever generates it," "reported as forbidden") rather
  than carrying the pre-fix problem-statement phrasing (e.g. "no generator
  or validator sees it") into docs written after the fix landed —
  comment-analyzer review caught this drift in `AGENTS.md` and a matching
  stale claim ("generate-manifests --check cannot see it") in a
  `tests/integration/validate-plugin.test.ts` comment.
