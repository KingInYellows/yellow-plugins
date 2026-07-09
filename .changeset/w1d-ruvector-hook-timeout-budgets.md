---
"yellow-ruvector": patch
---

fix: enforce hook time budgets on the npx-fallback path. post-tool-use.sh now
requires the direct `ruvector` binary (npx resolution ~2700ms blows the 1s
watchdog) — same skip-npx pattern as pre-tool-use.sh. session-start.sh drops
its npx fallback and timeout-wraps each of its three CLI calls (0.9s resume +
0.8s per recall, `--kill-after=0.1`, ~2.7s worst case inside the 3s watchdog)
with a `$SECONDS`-based remaining-budget guard that skips later calls when the
budget is nearly spent, so `{"continue": true}` always lands in time. New
`tests/session-start.bats` proves the contract against a hanging binary
(first bats suite in the repo simulating a hang, not just a failure);
post-tool-use.bats gains a no-npx-fallback regression test.
