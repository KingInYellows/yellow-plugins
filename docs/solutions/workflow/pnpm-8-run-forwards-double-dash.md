---
title:
  '`pnpm <script> -- --flag` fails with "unknown argument" under the pinned pnpm
  8.15'
date: 2026-10-28
category: workflow
track: bug
problem:
  The repo pins pnpm 8.15, whose `pnpm run` passes a literal `--` through to the
  script, so documented `pnpm smoke:codex -- --plugin …` and `pnpm smoke:install
  -- --dry-run` invocations exit with a usage error instead of running
tags: [pnpm, cli-arguments, smoke-tests, docs, double-dash]
components: [scripts, docs]
---

## Problem

`package.json` pins `"packageManager": "pnpm@8.15.0"`. Under that version,
`pnpm <script> -- <args>` hands the script a literal `--` as its first argument.
The repo's smoke scripts parse their arguments strictly and reject it:

```text
$ pnpm smoke:codex -- --plugin yellow-review --keep-temp
usage error: Unknown argument

$ pnpm smoke:install -- --dry-run
[smoke] usage error: unknown argument: --
```

The npm habit of `npm run x -- --flag` is what makes the `--` form look right,
and several docs used it.

## Fix

Pass the flags directly after the script name. pnpm forwards everything after
the script name to the script:

```bash
pnpm smoke:codex --plugin yellow-review --keep-temp
pnpm smoke:install --dry-run
```

Fixed in `scripts/eval/thermonuclear-fixtures/README.md` and
`docs/runtime-install-smoke.md` (PR #1430, found running CLAUDE-189's cross-host
smoke on a WSL machine).

## Prevention

- When documenting a `pnpm <script>` call with flags, run that exact line once
  under the pinned pnpm before committing.
- Scripts may also skip a leading `--` in their argument parser, but the
  existing ones do not; fix the docs rather than relying on that.
