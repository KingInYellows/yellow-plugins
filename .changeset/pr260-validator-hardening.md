---
'yellow-core': patch
---

Harden `scripts/validate-plugin.js` and add the first integration test
suite for the validator (`tests/integration/validate-plugin.test.ts`):

- Fix array-form `hooks` validation bypass: previously RULE 6/7/8 skipped
  ALL checks when `hooks` was an array; now array elements that are paths
  are validated for existence, plugin-dir containment, shebang, and
  `set -e` anti-pattern, identical to the inline-object form. Object
  elements pass through (mcpServers/lspServers-style inline configs are
  not script paths).
- Add path-existence + plugin-dir-containment check for the string-form
  `hooks` (was previously only checked for the documented anti-pattern).
- Add `SessionStart` to the `DECISION_PROTOCOL_EVENTS` Set — `SessionStart`
  hooks must emit a decision response per documented project memory
  (PR #72 incident).
- Enforce `outputStyles` directory-only at RULE 5b and align the schema
  description in PR-B accordingly (a `.md` file path is rejected).
- Refactor: extract `hasInlineHooks` predicate (was duplicated across
  RULE 6, 7, 8), `addError(errors, msg)` helper (eliminates pervasive
  `errors.push + logError` drift — RULE 1 had drifted), and
  `validateHookScriptPath` (centralizes per-script-path checks).
- Convert `VALID_HOOK_EVENTS` from in-function array (`.includes()`
  scan) to module-scope `Set` for parity with `DECISION_PROTOCOL_EVENTS`.

**Behavior change for downstream consumers:** plugins that ship array-form
`hooks` with raw script paths will previously have passed validation
silently. After this change those plugins receive the standard
script-path checks. No in-repo plugin uses array-form hooks, so
in-repo blast radius is zero.
