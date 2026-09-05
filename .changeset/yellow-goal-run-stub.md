---
'yellow-goal': minor
'yellow-core': patch
---

Add the fixed-authority `/goal:run-stub` operation: an asynchronous engine
process transport that probes `version` and `capabilities` against the pin, then
runs exactly
`run --executor stub --protocol v1 --stub-scenario <scenario> [--timeout-ms <n>] [--yes] -- <request>`
with closed stdin, a credential-free scratch environment, bounded JSON Lines
streaming, one absolute deadline, SIGTERM-then-SIGKILL cancellation and
exactly-once settlement. Results carry only the validated terminal summary and
bounded diagnostics. The blocking public-artifact job now also drives every stub
scenario, the noninteractive gate, the engine timeout and a forwarded SIGTERM
through the installed `v0.2.0` asset with real-provider traps and an unchanged
scratch target. No executor, protocol, target or raw-argv selector is exposed;
`/goal:setup` and `/goal:request` are unchanged. The yellow-core setup dashboard
now names the `0.2.0` engine pin.
