---
'yellow-core': patch
---

`/flow:work` resumes without Graphite and without redoing finished work. The
stack progress check no longer runs `gt` before the provider is resolved; it
reconciles after the router, using git and `gh` only. An item submitted before
its `## Stack Progress` row was written is matched to its pull request
(repository, head, stack base, local tip) and ticked instead of being created
and submitted again. Single-branch step commits carry a `Flow-Work-Step`
trailer, so a step committed before its checkbox was ticked, including the
first, is recognised on resume. New read-only helper `lib/flow-work-resume.js`.
