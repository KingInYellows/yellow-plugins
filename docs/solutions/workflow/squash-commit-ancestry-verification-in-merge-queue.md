---
title: 'Squash-commit ancestry verification in merge-queue workflows'
date: 2026-09-29
category: workflow
track: knowledge
problem: 'Graphite merge-queue artifacts can diverge from reviewed PR content, so a manual recovery check should first confirm the squash commit is on origin/main before comparing landed content.'
tags: [graphite-workflow, merge-queue, git-verification]
components: [yellow-core]
source: compound-staging
---

# Squash-commit ancestry verification in merge-queue workflows

## Context

Graphite merge-queue artifacts can diverge from the reviewed PR content. When
you already know the PR number and its squash commit, check that the squash
commit reached `origin/main` before comparing content. Fetch first and stop if
the fetch fails, or the check runs against a stale ref. `git merge-base
--is-ancestor` exits 1 for "not an ancestor" and another nonzero status (128
for an unknown object) when it cannot answer, so only exit 1 means nothing
landed:

```bash
if ! git fetch origin main; then
  echo "git fetch origin main failed: cannot verify against a stale ref" >&2
  exit 1
fi
rc=0
git merge-base --is-ancestor "$SQUASH_SHA" origin/main || rc=$?
if [ "$rc" -eq 1 ]; then
  echo "squash commit is not on origin/main: nothing landed" >&2
  exit 1
elif [ "$rc" -ne 0 ]; then
  echo "could not verify squash commit ancestry (git exit $rc)" >&2
  exit "$rc"
fi
```

This is corroborating evidence, not a standalone gate: it proves the commit
landed, not that its content matches the reviewed branch. Pair it with the
landed-content comparison in `docs/solutions/workflow/plan-lifecycle-management.md`
("Verifying an MQ merge when Gate C has nothing"). It is a manual recovery step;
`/plan:complete` Gate C does not run it.

## Source

Auto-promoted by yellow-core's compound-staging pipeline from session
`1c0b4660-3047-4907-8249-d56cc3832d29` (priority 0.55, category fact).

See `plans/complete/background-compounding-triggers.md` for the pipeline architecture.
