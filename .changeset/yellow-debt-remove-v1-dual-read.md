---
"yellow-debt": patch
---

Remove the v1.0 → v2.0 dual-read migration path from the audit-synthesizer.
The synthesizer now warns and skips any artifact with `schema_version` other
than `"2.0"`. The `_migrated_from` stamp, `stats.migrated_from_v1` counter,
and the SKILL.md "Schema Migration" section are removed; the `+0.05`
confidence-gate bump on `failure_scenario == null` (the permanent v2.0
calibration arm) is preserved.

`.debt/scanner-output/` is gitignored and typically overwritten by audit
runs, so no version-controlled artifact is broken. Re-run all scanners
after upgrading to regenerate v2.0 outputs; a full `/debt:audit` overwrites
each scanner's output before synthesis. If you previously ran a partial
audit (e.g., `--category`) or a scanner failed, delete stale
`.debt/scanner-output/*.json` files before re-running so the synthesizer
does not skip them.

Background: `docs/brainstorms/2026-05-07-yellow-debt-dual-read-removal-brainstorm.md`.
