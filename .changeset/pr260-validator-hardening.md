---
"yellow-core": patch
---

# Validator Hardening

Harden `scripts/validate-plugin.js` and add the first integration test
suite for the validator (`tests/integration/validate-plugin.test.ts`):

- Fix array-form `hooks` path-validation bypass: array entries that are
  string paths now receive the same path-existence + plugin-dir
  containment checks as the string-form `hooks` field. Inline event-keyed
  objects mixed inside the array form flow through `collectInlineHooks`
  and now get RULES 6/7/8 (script existence, hooks.json drift, shebang /
  decision-output / `set -e` content checks) — previously skipped because
  the inline-object loop short-circuited on `!Array.isArray(manifest.hooks)`.
- Add path-existence + plugin-dir-containment check for the string-form
  `hooks` (was previously only checked for the documented anti-pattern).
- Add `SessionStart` to the `DECISION_PROTOCOL_EVENTS` Set — `SessionStart`
  hooks must emit a decision response per documented project memory
  (PR #72 incident: missing JSON output blocks session startup).
- Enforce `outputStyles` directory-only via a new `directoryOnly`
  parameter on `validatePathOrPathsDir`: a `.md` file path is rejected
  for `outputStyles` even though Anthropic's `relativePath` schema
  allows single-file paths for `commands`/`agents`/`skills`. (Schema
  description alignment lands in PR-B.)
- Refactor: extract `addError(errors, msg)` helper to eliminate the
  pervasive `errors.push + logError` drift (RULE 1 / RULE 3 messages
  had silently drifted between the two paths) and
  `validateHookScriptPath(scriptPath, eventName, pluginDir, errors)`
  helper that centralizes per-script-path RULE 6 + RULE 8 checks
  (existence, readability, executable mode, shebang, decision output,
  `set -e`). RULE 6 and RULE 8 now share a single iteration pass over
  the inline hooks instead of two duplicate loops.
- Hoist `VALID_HOOK_EVENTS` and `DECISION_PROTOCOL_EVENTS` from
  in-function declarations to module-scope `Set`s — `.has()` is O(1)
  vs `.includes()` linear scan, and the membership tests are now
  reused across all rules instead of re-allocated per `validatePlugin`
  call.

**Behavior change for downstream consumers:** plugins that ship
array-form `hooks` with raw script paths will previously have passed
validation silently. After this change those plugins receive the
standard path-existence + containment check. Plugins shipping inline
event-keyed objects inside an array form now also get RULES 6/7/8.
Plugins shipping `outputStyles` as a `.md` file path will newly fail
validation (must be a directory). No in-repo plugin uses any of these
patterns, so in-repo blast radius is zero.
