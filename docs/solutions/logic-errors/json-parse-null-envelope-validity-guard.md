---
title: "JSON.parse('null') Succeeds — Guard Envelope Validity Separately From Parse Failure"
date: 2026-07-22
category: logic-errors
track: bug
problem: "A bare JSON null stdin payload parses successfully and crashes a hook policy function on envelope.command"
tags:
  - json-parse
  - typeof-null
  - hook-envelope
  - null-guard
  - node
components:
  - plugins/gt-workflow/hooks/scripts/lib/run-hook.js
---

# JSON.parse('null') Succeeds — Guard Envelope Validity Separately From Parse Failure

## Problem

`plugins/gt-workflow/hooks/scripts/lib/run-hook.js`'s shared hook-dispatch
flow parsed hook stdin with a `try { JSON.parse(raw) } catch { envelope =
undefined }` block, then passed `envelope` straight to a policy function
(`checkGitPush`/`checkCommitMessage`) whenever the parse didn't throw. A
bare `null` stdin payload (syntactically valid JSON) parses to the *value*
`null` without throwing — so it sailed past the catch block and was handed
to a policy function that immediately dereferenced `envelope.command` /
`envelope.toolInput`, crashing the hook.

## Symptoms

A hook receiving `null` as its entire stdin body (rather than malformed
JSON, which the try/catch already handled, or a valid envelope object)
throws a `TypeError: Cannot read properties of null` inside the policy
function, instead of hitting either of the two documented fail-open/
fail-closed paths the malformed-JSON case already had.

## What Didn't Work

```js
let envelope;
try {
  envelope = JSON.parse(raw);
} catch {
  envelope = undefined;
}

// BUG: only catches parse *failure*. JSON.parse('null') succeeds and
// returns the value null, so this never guards against a valid-but-useless
// payload.
const camelEnvelope = snakeToCamelEnvelope(envelope);
const result = policy(camelEnvelope); // crashes: null.command
```

The root cause is two independent JS surprises stacking: (1) `null` is
valid JSON, so `JSON.parse('null')` returns `null` rather than throwing,
and (2) `typeof null === 'object'` — so even a naive `typeof envelope ===
'object'` check without an explicit `null` guard would have let it through
too.

## Solution

```js
let envelope;
try {
  envelope = JSON.parse(raw);
} catch {
  envelope = undefined;
}

if (envelope === null || typeof envelope !== 'object') {
  // route through the same fail-open/fail-closed branch as a parse failure
  if (hookName === 'check-git-push') {
    return; // fail-open, matches check-git-push.sh's original behavior
  }
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
  return;
}

const camelEnvelope = snakeToCamelEnvelope(envelope);
const result = policy(camelEnvelope);
```

Any non-object JSON result (`null`, a bare string, a number, a boolean, an
array) is routed through the *same* branch as a parse failure — both
represent "the hook received something it cannot use as an envelope," so
they should have identical fail-open/fail-closed behavior rather than the
non-object case crashing while the unparseable case degrades gracefully.

## Why This Works

`envelope === null` is checked *before* `typeof envelope !== 'object'`
specifically because `typeof null === 'object'` would otherwise let `null`
through the type check. The combined guard treats "parsed to null,"
"parsed to a non-object primitive," and "failed to parse at all"
identically — which is the correct behavior here, since a policy function
that only knows how to read `.command`/`.toolInput` off an object has no
well-defined behavior for any of those three cases.

## Prevention

- **`JSON.parse` succeeding is not the same as "produced a usable object."**
  Valid JSON includes bare `null`, numbers, strings, booleans, and arrays —
  none of which support property access the way an object does. Any code
  that does `JSON.parse(x).someField` needs an explicit shape check after
  the parse, not just a try/catch around the parse itself.
- **`typeof value === 'object'` needs an explicit `value !== null` guard.**
  This is the same family of gotcha as
  `docs/solutions/logic-errors/json-schema-typeof-array-bypass.md` (where
  `typeof === 'object'` also matches arrays) — `typeof null === 'object'`
  is JavaScript's original `typeof` bug, kept for backwards compatibility.
  Any `typeof x === 'object'` check that will dereference properties on `x`
  needs `&& x !== null` (and, per the linked doc, `&& !Array.isArray(x)` if
  arrays must also be excluded).
- Regression-tested in the same fix via new fixtures + bats coverage in
  `plugins/gt-workflow/tests/hook-parity.bats`; the fix itself is documented
  inline in `run-hook.js`'s own doc comment, which records the review PR
  number.

## Related Documentation

- `docs/solutions/logic-errors/json-schema-typeof-array-bypass.md` — the
  sibling `typeof === 'object'` gotcha (arrays, not `null`), in a JSON
  Schema validator rather than a hook envelope parser
- `docs/solutions/integration-issues/codex-plugin-manifest-and-hook-contract.md`
  — the broader cross-host hook envelope contract this parsing code
  participates in
