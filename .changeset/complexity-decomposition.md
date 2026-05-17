---
'yellow-ci': patch
---

refactor: decompose god functions in yellow-ci shell libs and scripts/

Decomposes seven flagged complexity hotspots (debt audit findings 005, 018,
020, 027, 028, 030, 031) — pure extraction, no behavior change. Each refactor
is covered by characterization or pre-existing tests run before and after.

- `resolve-runner-targets.sh`: extract `rt_atomic_write()` (deduplicates the
  two tmp+rename cache writes) and `emit_runner_json()` (the JSON-build loop)
  out of the ~213-line `resolve_runner_targets()`. New characterization suite
  `tests/resolve-runner-targets.bats` (8 tests) committed first.
- `validate.sh`: flatten `validate_ssh_host()`'s 4-deep IPv4 nesting into
  `_validate_private_ipv4()`; split `validate_runner_targets_file()` into
  `_rt_check_yaml_syntax()`, `_rt_check_runner_names()`, `_rt_check_target_counts()`.
- `scripts/validate-agent-authoring.js`: decompose the 225-line top-level scan
  into `validateAgentFile()`, `buildTwoToThreeSegmentMap()`,
  `validateSubagentReferences()`, `validateCommandFiles()`, and a `main()`.
- `scripts/lint-plugins.sh`: extract the nested skill-reference block into
  `check_skill_references()`.
- `scripts/backfill-solution-frontmatter.js`: split `processEntry()` into
  `computeAdditions()` + `writeEntry()`; split `fmGetScalar()`'s 3 YAML-form
  branches into `resolveScalarValue()`.

All gates green: yellow-ci Bats (147 tests), `pnpm test:integration` (99),
`pnpm lint`, shellcheck.
