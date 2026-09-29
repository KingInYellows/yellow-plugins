# Bash and zsh compatibility for plugin shell code

Date: 2026-09-28
Topic: Make yellow-plugins shell scripts and command code blocks work correctly under both bash and zsh (including zsh `noclobber`), with a way to keep them working.

## What We're Building

A tiered compatibility pass over every plugin (all 19) plus a layered guard that keeps it working. Claude Code's Bash tool runs under the user's login shell, which is zsh on the primary dev machine (WSL2), so fenced bash blocks in command, skill and agent markdown run under zsh as written. `.sh` scripts with a bash shebang run under bash regardless.

Surface (from codebase research; counts are grep line counts, not distinct constructs):

- 47 `.sh` files (28 `#!/usr/bin/env bash`, 16 `#!/bin/bash`, 1 `#!/bin/sh`, 2 `#!/bin/false` lib files), plus extensionless shebang scripts and test mocks.
- 875 fenced bash blocks in plugin markdown; most are in yellow-core (193), gt-workflow (141), yellow-review (76), yellow-devin (72), yellow-ci (59).
- About 60 markdown lines use bash-only constructs (`declare -A`, `mapfile`, `[[ =~ ]]`, `${!var}`, `read -a`, `echo -e`). These are the real zsh risk.
- About 30 lines across 8 plugins still look like the noclobber pattern (plain `>` or `2>` onto a `mktemp` variable), by a name heuristic.
- `.sh` bash-only hits (`BASH_REMATCH`, `local -n`, `BASH_SOURCE`) matter only if the script is sourced from zsh.

The deliverable, by surface:

1. Inline markdown blocks must run in zsh as written: quote every expansion, `>|` where overwrite is intended, `printf` instead of `echo -e`, no `status`/`path`/`argv` variable names, no `read -p`, `BASH_REMATCH` or `BASH_SOURCE`.
2. Blocks that genuinely need bash-only constructs are pinned with a `bash` wrapper (`bash <<'EOF'` or `bash script.sh`), as yellow-ruvector already does. Expected scope is roughly the 60 flagged lines, not all 875 blocks.
3. `.sh` files with a bash shebang stay bash by contract. A lint checks they are never sourced or run as `zsh x.sh`. Bats invokes their entry points from a zsh parent with `noclobber` on, which is the real usage path.
4. Sourced or library scripts (no bash shebang, `#!/bin/false`) are dual-tested under both shells.

Guard layers, in order:

1. Static lint: a new `scripts/*.js` validator wired into `pnpm validate:schemas`, with an allowlist JSON and an integration test. It flags known bad patterns (noclobber-class redirects, `status=`/`path=` assignments, `read -p`, `BASH_REMATCH` and similar in inline blocks, bash-only files missing their contract).
2. Parse checks: extract every fenced bash block and run `bash -n` and `zsh -n`. Needs a reusable fence extractor in `scripts/lib/` (existing fence helpers strip fences rather than return contents).
3. Bats matrix: a separate CI job, with zsh installed via apt. Bats stays bash-only; the matrix means test bodies launch `zsh -o noclobber ...`.

## Why This Approach

The failures already seen are narrow: noclobber, and ruvector blocks that break when pasted into zsh. Rewriting all 47 scripts and 875 blocks to a shell-agnostic subset (Approach A) would touch scripts that always run under bash and gain nothing there. Pinning everything to bash (Approach B) would rewrite most blocks and still leave one-liner blocks exposed to zsh differences such as noclobber.

The tiered approach fixes the direct zsh surface (inline blocks), pins only what needs bash, and tests the scripts through the path they are actually invoked. It matches the earlier user picks: cover everything (Q1), layered checks (Q2), fix real breakage and allowlist only style-level or likely-false-positive hits with reasons (Q3).

Research notes that shaped this:

- ShellCheck does not support zsh (SC1071), so a static lint has to be repo-specific.
- `zsh -n` catches almost only parse errors, so it is a cheap backstop, not a semantic check.
- bats-core needs bash 3.2+ and cannot run `.bats` files under zsh. The established pattern is to launch zsh from bash-run tests. (External research; the CI recipe is inferred, not from a project that uses it exactly.)
- nvm is the closest prior art: sourced code tested across several shells in CI. pyenv sidesteps the problem by always running bash.
- Prior repo learnings: the noclobber sweep doc (`docs/solutions/logic-errors/zsh-noclobber-mktemp-stderr-redirect.md`) says a fix without a sweep leaves old instances behind and prescribes two greps that must return nothing; the subshell-isolation doc says each fenced block is a fresh subprocess, so functions and variables do not carry across blocks.

## Key Decisions

- Scope: all 19 plugins, all surfaces (markdown blocks, `.sh` files, bats suites).
- Enforcement: static lint, then `bash -n`/`zsh -n` on extracted blocks, then a bats matrix as a separate CI job.
- Remediation policy: fix anything that actually breaks (bats failures under zsh, parse errors, noclobber-class patterns). Allowlist only style-level or likely-false-positive lint hits, each with a written reason.
- Approach C (tiered by surface): common subset for inline blocks, `bash` wrapper for bash-only blocks, bash-by-contract for shebang scripts, dual testing for sourced libraries.
- Interpretation of "run every `.sh` and bats suite under both shells": bats remains a bash harness; zsh is exercised by invoking the code under test from zsh with `noclobber`. Bash-only scripts are tested via a zsh parent invoking bash, not as `zsh script.sh`.
- Follow the existing validator pattern: `scripts/*.js` chained into `validate:schemas` with an alias script, allowlist JSON, and a `tests/integration/*.test.ts`.
- Done-criteria for the noclobber class follow the earlier solution doc: the two documented greps return nothing.

## Open Questions

- What marks a script as bash-only by contract: shebang alone, or an explicit marker comment? How does the lint decide which markdown blocks count as "pinned" (wrapper detection)?
- Should the bats matrix job be required in `ci-status` or advisory first? Existing `plugin-shell-tests` is required for a subset and advisory for the rest; `ruvector-shell-tests` is advisory and not in `ci-status`. A new required job needs edits in `needs:`, the `env:` result variables and the `if` chain.
- Which suites go in the zsh matrix: all plugin suites, or only those whose code is sourced or interactive? Runner cost and the 10-minute timeout on `plugin-shell-tests` are the constraint.
- Does the `zsh -n` layer live inside `validate:schemas` (fast, no zsh needed locally for contributors without it) or only in CI? Zsh is present on the primary dev machine but not guaranteed for contributors.
- Do test mocks (`tests/mocks/{gh,git,gt,curl,claude,ssh}`) and extensionless shebang scripts fall under the lint, and with what allowlist rules?
- How should the change be split into a stack: per-plugin fixes first with the lint and CI last, or tooling first with a temporary baseline? (The chosen policy allowlists only style-level hits, so real breakage must be fixed before the checks turn required.)
- Verification gap: the noclobber counts come from a name heuristic and have not been confirmed as real failures. The plan should start with a measurement run under `zsh -o noclobber`.
- Docs and release steps to include in the plan: `CLAUDE.md` command list, `AGENTS.md` Targeted Validation Matrix, `CONTRIBUTING.md` shell testing section, a `docs/solutions/` entry, and changesets for plugin file edits (plugin markdown edits also need `pnpm validate:agents` and `pnpm lint:plugins`).
