---
'yellow-linear': minor
'yellow-core': minor
'yellow-agy': patch
---

`/linear:delegate` can hand a Linear issue to the local agent, yellow-agy
(CLAUDE-261). The remote-agent classifier reports yellow-agy under `localAgent`
and returns the new `READY_AGY` state when no remote-agent provider is enabled;
yellow-agy sits outside the group's exactly-one rule, so it never causes a
`CONFLICT`. `--provider agy` picks it in any other state. The agy branch runs a
plan-only `delegate` on a new `agy/<ISSUE-ID>-r<rev>` branch under the owner's
grant, and prints the owner's `authorize` line when none covers it. After
2026-11-11, `READY_JULES` points to yellow-agy. `setup:all` probes
`agy_cli_resolved`, and `validate-provider-groups` checks the local agent at
every consumer site.
