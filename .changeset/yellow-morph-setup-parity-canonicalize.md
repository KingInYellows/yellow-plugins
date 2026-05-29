---
'yellow-morph': patch
---

fix(yellow-morph): align `/morph:setup` with start-morph.sh and canonicalize plugin paths (#270, #269)

Two safety/UX fixes:

- **`/morph:setup` strict `CLAUDE_PLUGIN_DATA`** (#270): the setup
  command no longer falls back to a default
  `$HOME/.claude/plugins/data/yellow-morph` path when
  `CLAUDE_PLUGIN_DATA` is unset. It now matches `bin/start-morph.sh`'s
  strict `${CLAUDE_PLUGIN_DATA:?}` behaviour, surfacing the unset-var
  failure during setup instead of installing to a path the MCP wrapper
  will refuse to read at runtime. Claude Code always sets this var
  for plugin commands; the previous fallback only existed for ad-hoc
  manual invocation outside Claude Code.

- **`/morph:setup` npm output to stderr** (#270): `yellow_morph_do_install`
  is now invoked with `>&2` (matching the wrapper's pattern) instead of
  `2>&1`. Registry URLs, package metadata, and version chatter stop
  landing in the Claude Code conversation log on successful install;
  failures remain visible because the function's exit code is what the
  caller checks.

- **`yellow_morph_validate_paths` realpath canonicalization** (#269):
  the path-prefix guards in `lib/install-morphmcp.sh` now canonicalize
  `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` via `realpath -m`
  before the prefix-string match. This closes a traversal gap where a
  value like `$HOME/../../etc` would pass the naive `"$HOME/*"` glob
  on its raw form. Uses a capability test (`if canonical=$(realpath -m
  ... 2>/dev/null)`) instead of a presence test so BSD-realpath hosts
  (stock macOS without GNU coreutils) silently fall back to the raw
  prefix check rather than erroring on the unsupported `-m` flag.

New tests: `tests/integration/install-morphmcp.test.ts` covers all
five branches of `yellow_morph_validate_paths` (traversal rejection,
clean pass, unset var, out-of-bounds path, realpath-unavailable
fallback).

Source: PR #259 multi-agent review (security-sentinel L2/L3, code-reviewer P3, comment-analyzer P3).
