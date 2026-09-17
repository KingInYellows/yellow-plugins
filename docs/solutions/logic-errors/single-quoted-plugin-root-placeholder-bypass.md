---
title: 'Blind substitute-then-parse let a single-quoted ${CLAUDE_PLUGIN_ROOT} pass validation for a hook that can never run'
date: 2026-09-16
category: logic-errors
track: bug
problem: 'Substituting a placeholder into the whole hook command before tokenising let checkout-path spacing and quoting change the verdict'
tags: [hook-validation, shell-quoting, tokenize-then-substitute, fail-open-warning, plugin-manifest]
components: [scripts/lib/plugin-rules.js, scripts/lib/plugin-paths.js]
---

# Blind substitute-then-parse let a single-quoted `${CLAUDE_PLUGIN_ROOT}` pass validation for a hook that can never run

## Problem

`plugin-paths.js`'s `resolveHookScriptPath` checked whether a hook's script
path stayed inside the plugin directory by textually substituting
`${CLAUDE_PLUGIN_ROOT}` with the real plugin path across the **entire
command string**, then parsing the result to find the script argument. Two
independent bugs fell out of that ordering:

1. **Single-quoted placeholders validated clean but can never run.** A hook
   command like `bash '${CLAUDE_PLUGIN_ROOT}/hooks/x.sh'` is invoked via
   `sh -c`, and single quotes suppress all shell expansion — the literal
   string `${CLAUDE_PLUGIN_ROOT}` is passed as the path, and the script is
   never found at runtime. But the validator's `replaceAll` substituted the
   real plugin path into the string *before* checking existence, so the
   file-exists check passed. The manifest validated green for a hook that
   fails every time Claude Code invokes it.
2. **The checkout path itself could flip the verdict.** Because
   substitution happened before tokenising, a plugin checked out to a path
   containing a space word-split the *substituted* command differently than
   an unsubstituted one would — CI on one checkout path could pass while
   the same catalog source failed on another. The same substitute-first
   order also mis-resolved the docs-recommended quoting form,
   `bash "${CLAUDE_PLUGIN_ROOT}"/hooks/x.sh` (quotes only around the
   placeholder, unquoted suffix) — substituting first collapsed the
   quoted/unquoted boundary and resolved the whole expression to the
   plugin root directory, which then failed the containment check as an
   "escape" even though the command was well-formed and CLAUDE_PLUGIN_ROOT
   was never the intended script.

A related but separate defect: the unquoted-placeholder check
(`bash ${CLAUDE_PLUGIN_ROOT}/hooks/x.sh`, no quotes at all — word-splits on
a checkout path with a space) was a `logWarning`, not an error. This
validator only ever runs over this repo's own catalog-generated manifests —
there is no third-party manifest it needs to be lenient toward — so a
warning could not stop the fail-open form from regressing under an
otherwise-green CI.

Two smaller defects rode along in the same code path:

- The quoting-detection regex only inspected the character immediately
  before `${CLAUDE_PLUGIN_ROOT}`, so it flagged placeholders that appeared
  mid-string in a longer double-quoted argument, outside the shape RULE 6
  actually parses (the script argument immediately after `bash`/`node` and
  any interpreter flags).
- `validateHookScriptPath`'s interpreter gate was `if (interpreter !==
  'bash') return`, which skipped all content checks not just for `node`
  entrypoints (intentional — node scripts have no shebang/`set -e`
  contract) but for *any* other interpreter value reaching that function.
  `validateHookScriptPath` only runs once `resolveHookScriptPath` has
  already resolved a script path, so `interpreter` there is always
  `"bash"` or `"node"` — the gate change only affects commands that
  already resolved. An omitted script argument (a bare `bash`) never gets
  this far: `HOOK_SCRIPT_INTERPRETER_RE` requires trailing whitespace
  after the interpreter, so `resolveHookScriptPath` returns `null` and the
  RULE 6 caller's fallback has no `else` branch for that case — it still
  silently passes. That stays a known gap (see the "Known gap" comment
  above `HOOK_SCRIPT_INTERPRETER_RE` in `plugin-paths.js`), not something
  this change fixes.
- `resolveHookScriptPath` matched `bash`/`node` directly against the script
  argument, rejecting `node --enable-source-maps "${CLAUDE_PLUGIN_ROOT}"/x.js`
  because it parsed `--enable-source-maps` as the script and reported
  "Hook script not found: …/--enable-source-maps".

## Symptoms

- `pnpm validate:schemas` (RULE 6 / RULE 8 hook checks) passed for a
  `plugin.json` whose hook used single-quoted `${CLAUDE_PLUGIN_ROOT}` —
  the hook silently no-ops in production.
- The same catalog source could pass or fail RULE 6 depending on whether
  the working-copy checkout path contained a space.
- A correctly quoted, docs-literal hook command
  (`bash "${CLAUDE_PLUGIN_ROOT}"/hooks/x.sh`) was rejected with "Hook
  script path escapes plugin directory" — a false positive on valid input.
- `node --enable-source-maps "${CLAUDE_PLUGIN_ROOT}"/hooks/x.js` failed with
  "Hook script not found for <event>: …/--enable-source-maps".
- The unquoted-placeholder form was reachable and green under CI because it
  only produced a warning.

## What Didn't Work

Treating placeholder substitution as a pure string-replace step applied to
the raw command before any parsing. It is tempting because it is the
simplest possible implementation — one `replaceAll` covers every hook
command uniformly — but it conflates two different operations that must
happen in a specific order: **identifying which substring of the command is
the script argument** (a shell-word-splitting problem) and **resolving what
that substring points to on disk** (a string-substitution problem).
Collapsing them into "substitute the whole string, then find the
argument" makes the parse step operate on already-mutated text, so the
parse result depends on incidental properties of the substituted value
(whether the real plugin path happens to contain a space) rather than on
the command's own quoting.

## Solution

Tokenise before substituting, and reject unrunnable forms before resolving
anything:

```js
// scripts/lib/plugin-paths.js — resolveHookScriptPath, corrected order
const prefix = command.match(HOOK_SCRIPT_INTERPRETER_RE);   // bash|node
if (!prefix) return null;
const rest = command.slice(prefix[0].length);
const flags = rest.match(HOOK_INTERPRETER_FLAGS_RE)[0];      // skip -x, --enable-source-maps, etc.
const word = firstShellWord(rest.slice(flags.length));       // ONE shell word: quotes stripped, no split
if (!word) return null;
const scriptPath = word.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginDir); // substitute AFTER tokenising
const normalized = path.resolve(pluginDir, scriptPath);
```

`firstShellWord` walks the string once, treating adjacent quoted and
unquoted runs up to the first unquoted whitespace as a single word with
quote characters stripped — so `"${CLAUDE_PLUGIN_ROOT}"/hooks/x.sh` and
`${CLAUDE_PLUGIN_ROOT}/hooks/x.sh` both yield one clean path token
regardless of what the real plugin directory looks like.

Ahead of tokenising, the two quoting checks now run against the *shape RULE
6 actually parses* (`^(?:bash|node)\s+(?:-\S+\s+)*` — interpreter plus any
leading flags, applied to the raw, unsubstituted command) and both are
errors, with the single-quoted check winning and short-circuiting the
resolver on a hit:

```js
if (UNQUOTED_PLUGIN_ROOT_RE.test(hook.command)) {
  addError(errors, `... unquoted \${CLAUDE_PLUGIN_ROOT} — word-splits ...`);
  continue; // do not also resolve — resolver output would be misleading
}
if (SINGLE_QUOTED_PLUGIN_ROOT_RE.test(hook.command)) {
  addError(errors, `... single-quotes \${CLAUDE_PLUGIN_ROOT} — sh -c never expands it ...`);
  continue; // never reaches resolveHookScriptPath / the stale existence check
}
```

The interpreter-flag skip (`HOOK_INTERPRETER_FLAGS_RE = /^(?:-\S+\s+)*/`)
is shared between the quoting-prefix regex and the resolver, so
`node --enable-source-maps "${CLAUDE_PLUGIN_ROOT}"/x.js` is parsed
correctly by both.

The content-check gate in `validateHookScriptPath` changed from
"only run for bash" to "skip only for node":

```js
// before: if (interpreter !== 'bash') return;   — fails open for any
//         non-bash, non-node interpreter value, including "omitted"
// after:
if (interpreter === 'node') return;   // node has no shebang/set -e contract
// existence / symlink / regular-file checks above already ran unconditionally
```

## Why This Works

Tokenising first means the parser only ever sees the command's own quoting
and word boundaries — never the incidental shape of whatever string gets
substituted in later. That makes the checkout path (and, by extension, any
other property of `pluginDir`) unable to change which substring is treated
as the script argument, which is what let a spaced checkout path flip a
"does this escape the plugin directory" verdict. It also means the
single-quoted case is caught as a quoting problem before the resolver ever
gets a chance to substitute a working path into a string the shell will
never expand — checking "will this ever run" before checking "does this
path exist" avoids validating a script the shell can never reach.

Promoting the unquoted-placeholder warning to an error follows from the
validator's actual scope: this is not a linter over third-party or
user-authored plugins where an unfamiliar third-party pattern deserves a
warning before a hard failure. It runs only over this repository's own
generated catalog, so a form of the exact fail-open bug the validator
exists to catch has no legitimate reason to survive as a warning that CI
treats as green.

## Prevention

- When a validator both substitutes a placeholder and parses shell-command
  structure, tokenise first, substitute second. If you find yourself
  writing `command.replaceAll(placeholder, realValue)` before any parsing
  step, ask whether the parse result should be able to depend on what
  `realValue` looks like — if not, reorder.
- When a check's whole purpose is to prevent a specific regression, and the
  validator runs only over sources you control (no third-party leniency to
  preserve), promote it to an error. A warning cannot stop CI from going
  green on the regression.
- Quoting/shape regexes that are meant to gate a specific grammar (here:
  "the script argument right after the interpreter and its flags") should
  match that exact shape, not "any occurrence of the placeholder" — anchor
  on the same prefix the resolver itself uses so the two can never drift
  apart.
- An interpreter allowlist gate (`if (interpreter === X) return`) should
  skip only the interpreter it names. Inverting it (`if (interpreter !==
  Y) return`) silently widens the skip to every other value, including
  "argument omitted" or "unrecognized interpreter" — those should usually
  fail strict, not pass through.

See also `docs/solutions/logic-errors/zsh-noclobber-mktemp-stderr-redirect.md`
(shell quoting/expansion assumptions breaking silently) and
`docs/solutions/build-errors/ci-schema-drift-hooks-inline-vs-string.md`
(a different hooks-validation gap, in schema shape rather than command
parsing) for adjacent but distinct hook-validation pitfalls in this repo.
