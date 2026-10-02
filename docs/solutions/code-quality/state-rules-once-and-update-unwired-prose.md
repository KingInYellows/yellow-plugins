---
title: 'State each rule once, and make wiring PRs sweep every "unwired" prose claim'
date: 2026-10-01
category: code-quality
track: knowledge
problem: edit-bounds rule contradicted across clusters.md, agent and Step 4; wiring PR left changeset, CLAUDE.md, description and tokens stale
tags: [documentation-drift, single-source-of-truth, changeset, contract-tokens, plugin-authoring, yellow-review]
components: [yellow-review]
---

## Context

PR #954 wired `/review:resolve` and `pr-comment-resolver` into the review flow.
Review produced a P1 and six related P2s that share one cause: behaviour is
described in several prose places, and the places disagree or still describe
the pre-wiring state.

- `clusters.md` said changed lines `none` or `unknown` means no edit, while the
  agent and Step 4 allowed in-cluster edits (P1; four reviewers).
- The changeset still said `/review:resolve` and `pr-comment-resolver` were
  unwired and unchanged.
- Plugin `CLAUDE.md` listed Scripts (9) and omitted `commit-resolve-fixes`,
  `run-verify-command`, the libs, `references/resolve` and the new gates.
- The `/review:resolve` description omitted that it now replies, files issues,
  commits and pushes.
- The `dispositions.md` "Implementation status" paragraph was stale and omitted
  `pr-changed-ranges` and `poll-new-threads`.
- `resolve-stack` still matched the token `skipped (cluster cap)` that
  `/review:resolve` no longer emits in PR #954's branch (the producer there
  records `not attempted (cluster cap)`).
- The command preamble said every stop prints the Resolve line, but the Step 2
  pre-flight stops did not.

## Guidance

1. Put each behavioural rule in one place, a table row or section, and have
   every other file point to it. The edit-bounds rule belongs in one
   edit-bounds table; the agent, `clusters.md` and Step 4 reference it.
2. When a PR changes a component from unwired to wired, search the repo for
   the old claim before finishing: `unwired`, `unchanged`, `not yet`,
   "Implementation status", counts of scripts or agents, and old output tokens.
3. Key cross-command matching on the tokens the producer emits now, and grep
   the consumer for the old token when the producer changes. Take the token
   from the producer's own text, not from this doc. Point-in-time: PR #954
   changes the producer to `not attempted (cluster cap)` and
   `not attempted (rate limit)`; until it merges, `resolve-pr.md` still emits
   `skipped (cluster cap)` and `resolve-stack.md` still matches it.
4. Scope universal claims ("every stop prints X") to the steps where they hold,
   or make them true.
5. Rewrite the changeset to describe what ships: the wiring, new exit codes,
   resolver without Bash, the HEAD check.

## Why This Matters

Agents and reviewers read these files as instructions. Two rules for the same
case make the outcome depend on which file was read last. A stale count or
token silently breaks downstream matching, and a stale changeset ships wrong
release notes.

## When to Apply

- Any PR that adds, removes or rewires a command, agent, script or lib.
- Any PR that renames an output token or exit code.
- Any time a rule is about to be copied into a second file.

## Examples

Before: `clusters.md` says no edit on `none` or `unknown`; Step 4 allows
in-cluster edits.

After: one edit-bounds table states which changed-line states permit edits;
`clusters.md` and Step 4 link to it.

Sweep command after a wiring PR (`skipped \(cluster cap\)` is the stale token
once PR #954 lands; on a branch without it, that string is still the live one):

```bash
rg -n 'unwired|not yet wired|Implementation status|skipped \(cluster cap\)' plugins/yellow-review .changeset
```

Related: `docs/solutions/code-quality/stale-env-var-docs-and-prose-count-drift.md`
and `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md`.

---

## Update — 2026-10-01

PR #955 (resolve-stack callers) hit this pattern four more times. Each
was found by reviewers, not by a validator.

- **Copied procedure, narrower copy.** The own-paths and trusted-config
  classification was pasted into `resolve-stack` and `sweep-all`, each
  with a hand-copied deny list narrower than the canonical `rp_denied`.
  A path the shared function denies could pass the pasted list. Move
  classification into one tested mode of `run-verify-command` (or one
  shared reference) and have both commands call it. A copy that has to
  stay in sync with a tested function will not.
- **Wired behaviour, unwired contract prose.** `sweep-all` gained
  dirty-tree and rate-limit stops, but its Error Handling section still
  said the loop continues and exits 0, and no exit codes were named for
  the new stops. When a PR adds a stop, grep the command for every
  statement that says "continues", "exits 0" or "never aborts", and
  scope it.
- **Counts and tables.** The README Scripts table listed 9 of 11
  scripts, and its intro still scoped gh/jq and Linear wording to the
  old set. After adding scripts, recount against the scripts directory.
- **Duplicate index entries.** `SKILL.md` listed `check-resolve-text`
  twice, and both entries said "posted to Linear". Delete the stale
  entry. Do not reword both.
