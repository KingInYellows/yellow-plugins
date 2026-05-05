---
'yellow-core': patch
---

Tighten `schemas/plugin.schema.json` against PR #260 review findings; add
`semverRange` AJV custom keyword; rebuild
`examples/plugin-extended.example.json` to satisfy the tightened schema;
add fixture-based test (`tests/integration/example-files-schema.test.ts`)
that AJV-validates every plugin example against the schema after every
schema edit (closes the silent-orphan gap on the example file).

Schema changes:

- **`pathPathsOrInline`** — array-element bare `{type:object}` and the
  bare-object branch both now require `minProperties: 1`. Adds
  `$comment` documenting that the multi-purpose def serves
  mcpServers/hooks/lspServers — deeper shape ownership lives in
  Claude Code's runtime validator. Flagged by adversarial (P1).
- **`userConfig`** — extracts a new `userConfigEntry` `$def` with
  `additionalProperties: false` (rejects typos like `sensitiv` that
  would silently disable keychain protection) and nested `if/then/else`
  enforcing type-conditional `default` (string type → string default,
  number type → number default, boolean type → boolean default). Uses
  nested if/then/else NOT `oneOf` per AJV docs (the documented
  "default breaks oneOf" hazard). `channels[].userConfig` now
  references the same `$def` so per-channel overrides receive the same
  validation. Flagged by adversarial + silent-failure-hunter +
  polyglot (P2, multi-reviewer agreement).
- **`monitors`** — relax inline-array element `additionalProperties:
  false` → `true`. Same anti-pattern that caused historic `repository`
  object-form rejection grief; closes off forward-compat for fields
  Claude Code may add. Required-field checks remain. Flagged by
  architecture (P2).
- **`dependencies[].version`** — adds `pattern: ^[~^>=<*xX0-9]`
  lightweight structural gate + new `semverRange: true` AJV custom
  keyword that calls `semver.validRange()` for full semantic check.
  Two-layer approach per industry convention (npm CLI uses the same
  shape: pattern for type, library for semantic). Flagged by
  architecture + polyglot (P2 cross-reviewer agreement).
- **`outputStyles`** description — wording aligned with RULE 5b
  enforcement ("directories containing .md files", not "files/
  directories"). Flagged by correctness (P3).
- **`channels[].server`** description clarifies cross-field constraint
  is not enforced by schema — runtime owns referential integrity.
  Flagged by architecture (P3).

Implementation:

- New file `packages/infrastructure/src/validation/keywords/semverRange.ts`
  exports `semverRangeKeyword` for AJV registration. Type-string keyword
  with boolean schema; delegates to `semver.validRange()`. Tested in
  `example-files-schema.test.ts` with 8 cases covering accepted ranges
  (`^1.0.0`, `~2.1.0`, `>=3.0.0`, `1.2.3`, `*`) and rejected non-semver
  (`banana`, `1.banana.0`, empty).
- `AjvValidatorFactory` constructor now registers the keyword before
  any schema compilation so all loaded schemas can use `semverRange:
  true`.
- `examples/plugin-extended.example.json` `hooks` field replaced from
  `"./hooks/hooks.json"` (the validator's documented anti-pattern) with
  inline-object form demonstrating the preferred PreToolUse pattern.

CI test coverage:

`tests/integration/example-files-schema.test.ts` AJV-validates every
`examples/plugin*.json` against the tightened plugin schema. The
custom keyword surface is exercised in isolation against an
in-memory test schema. `examples/marketplace.example.json` is
intentionally skipped (pre-existing drift between the upstream
fixture and this repo's local marketplace schema, out of scope for
this PR).

**Behavior change for downstream consumers:** plugins that ship
`userConfig` entries with unknown fields (e.g., typo `sensitiv: true`
instead of `sensitive: true`) will now fail validation. This is
intentional hardening — the typo previously caused silent
plaintext-credential exposure. No in-repo plugin uses `userConfig` in
its `plugin.json` manifest (verified by repo research) so in-repo
blast radius is zero.
