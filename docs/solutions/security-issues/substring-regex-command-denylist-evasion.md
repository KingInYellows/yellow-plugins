---
title: 'Substring-regex command denylist is evadable by shell construct variation'
date: 2026-07-22
category: 'security-issues'
track: knowledge
problem: 'A regex denylist matching raw command text (git push blocker) is bypassable via ${IFS}, quote-splitting, eval, or path-qualified invocation'
tags:
  - command-injection
  - denylist
  - regex-evasion
  - shell-parsing
components:
  - plugins/gt-workflow/hooks/scripts/lib/policy-check-git-push.js
---

# Substring-regex command denylist is evadable by shell construct variation

## Problem

`policy-check-git-push.js` blocks raw `git push` via a regex against the
raw command string (mirrored from the original bash `check-git-push.sh`):
`/(^|[;&()|$\`]|\s)git\s+push/m`. A regex denylist matching literal token
boundaries is evadable by any shell construct that changes the string's
surface form without changing what the shell executes: `${IFS}`
substitution for the space (`git${IFS}push`), quote or backslash splitting
(`g"i"t push`, `git pu\sh`), intervening flags (`git -c foo push`),
path-qualified invocation (`/usr/bin/git push`), or `eval`-based indirection
that constructs the string at runtime after the hook's static check. This is
empirically verified against the current regex — pre-existing behavior
carried into the Node port, not introduced by the port itself.

Companion finding: the fixture set testing this regex covers 3
metacharacter shapes (space, semicolon, pipe) — passing those creates false
confidence, since none of the actual evasion techniques above are
represented.

## Detection

Any hook blocking a command family (not a specific literal string) via
regex against raw command text, rather than tokenizing and checking parsed
argv, is presumptively evadable. Check whether the fixture/test suite
includes `${IFS}`, quote-splitting, `eval`, and path-prefix cases, not just
whitespace/metacharacter variants of the already-blocked shape.

## Fix or Guidance

Prefer tokenizing the command (shell-lexer semantics) and checking the
parsed argv's first token(s) against the denylist, rather than regexing the
raw string. Where tokenizing isn't practical, invert to an allowlist of
safe commands/subcommands — an allowlist fails closed on anything
unrecognized, a denylist fails open on anything unanticipated. If a
denylist regex is kept as defense-in-depth (not the sole control), document
that explicitly so reviewers don't treat it as sufficient alone.

## Related Documentation

- [bash-to-node-port-drops-fail-closed-and-bounds.md](./bash-to-node-port-drops-fail-closed-and-bounds.md) —
  same file's other pre-existing/dropped safety gaps
