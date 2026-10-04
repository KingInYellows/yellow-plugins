---
title: 'Even a read-only `opencode models` listing can rewrite ~/.config/opencode in place — snapshot first'
date: 2026-10-03
category: integration-issues
track: knowledge
problem: 'opencode CLI invocation, even read-only model listing, let a plugin migrate and rewrite opencode.json and tui.json with no backup'
tags: [opencode, cli-probe, side-effects, config-mutation, spike, plugin-migration, yellow-council]
components: [plugins/yellow-council/agents/review/opencode-reviewer.md]
---

## Context

While expanding yellow-council V2 shell 04, a spike ran
`opencode models | rg deepseek` to confirm a DeepSeek route exists. It looked
read-only. The user's OpenCode plugin (oh-my-opencode, renamed
oh-my-openagent) auto-migrated at CLI start and rewrote
`~/.config/opencode/opencode.json` and `tui.json` in place. There was no
backup, and the directory is not git-tracked, so nothing could undo it.

The first listing printed nothing. A second call listed
`opencode/deepseek-v4-pro` (OpenCode Zen). The cause of the empty first run
was not established. It coincided with the migration run.

## Guidance

- Treat every `opencode` invocation as a possible config writer, including
  listing commands. Before any spike, snapshot the directory:
  `cp -a ~/.config/opencode "$SCRATCH/opencode.bak"`. Afterwards run
  `diff -r` to see what a plugin changed.
- An empty first listing is not evidence that a model is missing. Re-run it
  once before concluding anything. A quota or availability probe should not
  classify empty output as exhaustion.
- Prefer `--pure` ("run without external plugins", opencode 1.14.33) on
  probe commands; it should skip the plugin load that performed the
  migration. Redirecting `XDG_CONFIG_HOME` to a temp dir may also isolate a
  probe. Both are untested here, so confirm with `diff -r` that the real
  directory is untouched.
- `opencode auth login <arg>` treats the positional as a well-known-auth
  URL, not a provider id: `opencode auth login openrouter` fails with
  "fetch() URL is invalid". Use `opencode auth login --provider openrouter`.

## Why This Matters

Dotfile config outside version control has no undo. A plugin migration is a
silent write that only shows up when something else breaks.

## When to Apply

Any spike, test or CI probe that runs a CLI which loads user plugins at start
(opencode today), especially against a developer's real home directory.
