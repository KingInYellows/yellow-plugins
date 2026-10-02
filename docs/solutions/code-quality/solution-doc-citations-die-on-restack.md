---
title:
  'Solution Docs Written Mid-Stack Cite Commit Hashes That Rebasing Destroys,
  and Prescribe Fixes the Named Tool Cannot Perform'
date: '2026-09-11'
category: 'code-quality'
track: 'knowledge'
problem:
  'Two solution docs written during an in-flight stacked PR were themselves
  found defective in the next review pass: one cited two commit hashes that a
  restack had rewritten — they still resolve as unreachable objects on the
  author machine, so the citation looks live locally and is dead for every other
  reader — and named the wrong commit for the claim besides, while the other
  prescribed verifying a tarball sha512 before extraction using a command that
  has no such step'
tags:
  - solution-docs
  - knowledge-compounding
  - graphite
  - restack
  - commit-citation
  - prescription-verification
  - self-review
components:
  - docs/solutions/code-quality/layered-contract-fixes-cross-cutting-collision.md
  - docs/solutions/security-issues/npm-install-missing-ignore-scripts-and-integrity.md
---

# Solution Docs Written Mid-Stack Cite Hashes That Rebasing Destroys

## Context

A knowledge-compounding pass usually runs against a branch that is still moving.
On PR #793 two solution docs were written during review round 3 and committed to
the same branch. Round 4 reviewed them as ordinary diff content and found a
defect in each — the docs had inherited exactly the failure modes they exist to
prevent.

## Finding 1: Commit Hashes Do Not Survive a Restack, but They Still Resolve Locally

`layered-contract-fixes-cross-cutting-collision.md` opened by placing its
findings in history: _"had already been through two prior review-fix passes
(commits `<deadhash-a>`, `<deadhash-b>`)." _ By the next pass, neither hash was
an ancestor of the branch head — Graphite's restack had rewritten every commit
on the branch. The subtle part:

```text
$ git cat-file -t <deadhash-a>
commit
$ git merge-base --is-ancestor <deadhash-a> HEAD && echo IS || echo NOT
NOT
```

The object still exists in the author's local repository as an unreachable
commit, so `git show <deadhash-a>` prints happily and the citation looks fine to
the one person who will never need it. For every other reader — and for the
author after `git gc` — it is a dangling reference. In a workflow where every
branch is restacked on every trunk sync (this repo mandates Graphite), a commit
hash written into a tracked file has a short and unpredictable life.

Worse, the hash was also _wrong for the claim_: `<deadhash-a>` is the commit
that added a provenance caveat, not one of the two review-fix passes the
sentence describes. And the count itself was stale — three fix passes had landed
by the time the sentence was written, not two, and a fourth followed.

**Rules:**

- Cite a **PR number** or another durable reference (file path with heading
  anchor, issue URL). PR numbers survive rebasing, squashing, and merging.
  Commit subjects can disappear or be reworded in a squash merge, so do not
  treat them as stable identifiers.
- Never verify a citation with `git show <hash>` on the machine that wrote it.
  Unreachable objects make that check vacuous. `git merge-base --is-ancestor` is
  the check that actually fails.
- Do not write running tallies ("two prior passes") into a document produced
  while the process is still running. Describe the shape — "each successive pass
  re-found the previous pass's fix one site over" — which stays true as the
  count changes.

## Finding 2: A Prescription Must Name a Mechanism the Tool Actually Has

`npm-install-missing-ignore-scripts-and-integrity.md` correctly identified two
defects in a vendor-SDK install path (no `--ignore-scripts`, no integrity pin)
and then prescribed, in its **Good** code block, recording the resolved
tarball's sha512 and _"on every subsequent install compare the downloaded
tarball's sha512 against that recorded value before extraction and abort on
mismatch"_ — as a comment attached to a plain `npm install --prefix` command.

`npm install` exposes no such hook. It fetches and unpacks in one step, and
verifies integrity only against a `package-lock.json` `integrity` field. The
prescription describes a behavior no reader can implement from the command they
were given, which converts a correct diagnosis into an unactionable remedy. The
implementable form is a committed lockfile carrying the `integrity` hash plus
`npm ci --ignore-scripts`, which makes npm itself perform the comparison and
fail the install on mismatch.

**Rule:** a solution doc's remedy is an assertion about a tool's capability and
needs the same mechanical check as any other claim — read the tool's flags or
docs for the step you are prescribing, and prefer a remedy the tool performs
itself over one the reader is told to perform around it. This is
[`doc-fix-mechanical-verification-gap.md`](./doc-fix-mechanical-verification-gap.md)
applied to the compounding output rather than to product docs: the substitution
of an assertion for a check does not stop being a defect because the artifact is
a lesson.

## Guidance for Compounding Passes

1. **Write docs against stable identifiers.** PR numbers, file paths with
   heading anchors — never raw SHAs on a branch that will be restacked, and
   never line numbers alone.
2. **Treat every `Fix:` / **Good** block as a claim under test.** If it names a
   command, the command must be able to do what the surrounding prose says it
   does.
3. **Expect the docs to be reviewed as code.** A compounding commit that lands
   on an open PR enters the next review pass's diff. That is a feature — it is
   how both of these defects were caught — but it means the doc should be
   written to survive review, not appended as an afterthought once the
   interesting work is done.
4. **Prefer shape to tally** for anything the in-flight process will change:
   pass counts, finding counts, "currently N of M."

## When to Apply

- Any `/flow:compound` or `/review:pr` compounding pass whose output lands on a
  branch that is not yet merged.
- Any solution doc that references the work that produced it, in a repository
  using Graphite, stacked PRs, squash merges, or any rebase-based workflow.

---

## Update — 2026-10-01

### Finding 3: Claims About Code State Rot When the Code Ships

PR #972 added seven auto-promoted solution docs. One review pass found four
defects in them, all one kind: a claim about the state of code or tooling that
was false when written or became false when the work shipped. The paths below
are as of PR #972's review rounds; the docs may have been reworded or renamed
since.

- **Self-contradiction.** In
  `docs/solutions/integration-issues/ruvector-embedder-mismatch-if-ruvector-intelligenc.md`,
  the closing sentence forbade running a bare `hooks reembed` while the MCP
  server was live. Step 3 of the same runbook (the real reembed, after the
  `--dry-run` in Step 2) did exactly that, with writes quiesced and a restart in
  Step 4.
- **Plan-time doc read as current.** In
  `docs/solutions/code-quality/council-md-extension-constraints.md`, a
  constraints doc written while planning an unshipped change said "Step 5 has no
  bash" and "`--single-pass` is a silent no-op until an arm is added". By merge,
  Step 5 held bash fences, the flag had an arm, and the fences were labelled
  `council-output:S<n>`.
- **Stale claim inside a warning about stale claims.** A checklist item in
  `docs/solutions/integration-issues/plugin-add-enumeration-checklist-gaps.md`
  said the header comment of `scripts/validate-provider-groups.js` listed only
  one provider group, but the file already listed two.
- **Phantom tool.**
  `docs/solutions/workflow/squash-commit-ancestry-verification-in-merge-queue.md`
  told readers to run a check "that Gate C enforces", naming a tool absent from
  the repo, with no pointer to where it lives and no command to run in its
  place.

**Rules:**

- Mark a doc written before the implementation ships as plan-time in its Context
  and reconcile it before the implementing PR merges. Otherwise phrase the
  lesson as an invariant the code enforces, not as "currently X" or "has no Y".
- Before saving, check every "currently / only / no X / the header says" claim
  against the file with `rg`, and re-read the closing sentence against the
  numbered steps above it.
- Name a tool by where it lives, or substitute the underlying command. Here that
  command is `git merge-base --is-ancestor <SQUASH_SHA> origin/main`, where
  `<SQUASH_SHA>` is the squash-merge commit's object id (from the merged PR) and
  `origin/main` must be fetched first (`git fetch origin main`).
- Treat state claims in compound-staging entries as unverified. They are written
  from one moment of a session transcript, with no check against the tree.
