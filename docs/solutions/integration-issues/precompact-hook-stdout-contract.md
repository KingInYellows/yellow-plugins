---
title: 'PreCompact hook stdout DOES become custom compact instructions (docs page is wrong)'
date: 2026-09-05
category: integration-issues
track: knowledge
problem: 'Official Claude Code hooks docs say PreCompact stdout only goes to the debug log; the installed 2.1.261 binary contradicts this'
tags: [hooks, claude-code, precompact, compaction, documentation-drift, binary-verification]
components: [yellow-core]
---

# PreCompact hook stdout DOES become custom compact instructions (docs page is wrong)

## Context

While reviewing PR #744 (yellow-core's PreCompact hook, which writes plain-text
stdout intended to become custom compaction instructions), a compound-staging
draft had already been produced claiming the opposite: that PreCompact stdout
is *not* injected into compaction context, and that plain-text stdout
injection is limited to four events (`UserPromptSubmit`, `UserPromptExpansion`,
`SessionStart`, `PostModelSwitch`) per the official Claude Code hooks docs
page. That draft was never committed (it sat in a git stash as an untracked
file, `docs/solutions/integration-issues/precompact-hooks-do-not-add-stdout-to-the-compacti.md`).

Before trusting either the docs page or the stashed draft, the claim was
verified directly against the installed `claude` binary (2.1.261).

## Guidance

**The docs page is wrong for PreCompact.** The binary's own embedded hook
metadata states:

```
PreCompact: Exit code 0 - stdout appended as custom compact instructions
```

And the `executePreCompactHooks` function joins the trimmed stdout of every
succeeded, non-blocked PreCompact hook into `newCustomInstructions`, which
becomes the actual custom compaction instructions for that compaction pass.
So a PreCompact hook's plain-text stdout on exit code 0 **is** live input to
compaction — the stashed draft's premise (and by extension the docs page, as
read for this event) do not hold.

**Caveat — subagent context drops custom instructions.** When the hook runs
inside a subagent context (`agentContext` is set), `executePreCompactHooks`
only returns `blockedBy` — the joined stdout is discarded and no custom
instructions reach that compaction pass. A hook author relying on PreCompact
stdout to shape compaction must account for this: it works for the main
session but silently does nothing inside a subagent.

**General lesson: when a docs page and a bundled binary disagree about a hook
contract, trust the binary and verify by grepping it directly** — the docs
page is a secondary source; the shipped binary is what actually executes.
Reproduction used on 2.1.261:

```bash
BIN="$(readlink -f "$(which claude)")"
grep -ao "PreCompact[^\"]\{0,80\}" "$BIN"          # embedded hook metadata
grep -ao "executePreCompactHooks" "$BIN"           # confirms the function exists
```

From there, locating `executePreCompactHooks` in a deobfuscated/pretty-printed
copy of the bundle (or stepping through with a debugger) shows the
`agentContext` branch and the `newCustomInstructions` join. Do not stop at the
embedded metadata string alone if the exact join/branch behavior matters —
the metadata confirms the *contract*, not the *edge cases*.

## When to Apply

- Any time a hook's documented stdout/exit-code contract needs to be relied
  on precisely (not just "does something happen") — e.g. deciding whether a
  hook can safely carry meaningful content on stdout, or whether an empty
  stdout is expected to be a no-op.
- Before citing a specific Claude Code version in a hook's own header comment
  as "verified against" — note explicitly that the public docs page may
  diverge, so a future contributor consulting only the docs doesn't "fix" a
  hook that is actually correct against the binary.
- Before reviving `docs/solutions/integration-issues/precompact-hooks-do-not-add-stdout-to-the-compacti.md`
  from the stash on branch `agent/feat/yellow-core-precompact-hook` — its
  premise is now falsified by this doc; do not restore it as-is.

## Examples

- yellow-core's `plugins/yellow-core/hooks/scripts/pre-compact.sh` relies on
  this contract (stdout becomes custom compact instructions in the main
  session; no effect in a subagent context) — see PR #744.
