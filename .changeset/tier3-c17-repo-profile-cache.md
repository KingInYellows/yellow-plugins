---
"yellow-core": minor
---

Add `lib/repo-profile.sh`: a git-SHA-keyed repo-orientation profile cache
(CE protocol adapted). Key = lexicographically-first root commit + HEAD, with
a proactive `--is-shallow-repository` guard (shallow rev-list silently
returns the boundary commit — no error to trap); HIT requires schema-version
match and no dirty profile-input path (conservative superset,
over-invalidation accepted). Atomic whole-object tmp+mv writes, single
writer per key; docs/solutions/ enumeration is never cached. Degrades to
NO-CACHE everywhere — the cache never blocks. First consumer wired:
`/workflows:plan` Phase 2 passes the profile to research agents as advisory
context. 17-test bats suite included.
