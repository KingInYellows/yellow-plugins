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
(commits `599c2744`, `865f2f0e`)."_ By the next pass, neither hash was an
ancestor of the branch head — Graphite's restack had rewritten every commit on
the branch. The subtle part:

```
$ git cat-file -t 599c2744
commit
$ git merge-base --is-ancestor 599c2744 HEAD && echo IS || echo NOT
NOT
```

The object still exists in the author's local repository as an unreachable
commit, so `git show 599c2744` prints happily and the citation looks fine to the
one person who will never need it. For every other reader — and for the author
after `git gc` — it is a dangling reference. In a workflow where every branch is
restacked on every trunk sync (this repo mandates Graphite), a commit hash
written into a tracked file has a short and unpredictable life.

Worse, the hash was also _wrong for the claim_: `599c2744` is the commit that
added a provenance caveat, not one of the two review-fix passes the sentence
describes. And the count itself was stale — three fix passes had landed by the
time the sentence was written, not two, and a fourth followed.

**Rules:**

- Cite a **commit subject**
  (`docs(yellow-jules): apply second review pass to the PR1 contract set`) or a
  PR number. Both survive rebasing, squashing, and merging; both are greppable
  in `git log --oneline`.
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

1. **Write docs against stable identifiers.** Commit subjects, PR numbers, file
   paths with heading anchors — never raw SHAs on a branch that will be
   restacked, and never line numbers alone.
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
