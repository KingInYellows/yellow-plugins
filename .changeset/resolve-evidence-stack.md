---
"yellow-review": minor
---

`/review:resolve` hardens and widens its `addressed` evidence check. A new
`check-addressed-evidence` script applies the rules in one call: on a stacked
PR, evidence may cite a fix that a lower PR in the stack made (for example the
stack's changeset), using the new `pr-changed-ranges --stack` capture of the
default branch to the PR head. A human thread under
`resolve_human_threads: evidence` is resolved as `addressed` only when the
cited line was changed by the PR or its stack, lies outside the thread's own
anchor and sits in a file no cluster edited this run. The config snapshot now
comes from a new `read-resolve-config` script that prints every
`resolve_pr.*` key validated as JSON, instead of being parsed in prose; an
unreadable `verify_command` is unset, never half-read. An interactive run
whose verify command the user does not want to run can now commit without
verifying instead of reverting the fixes.
