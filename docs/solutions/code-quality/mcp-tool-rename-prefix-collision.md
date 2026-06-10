---
title: 'MCP Tool Rename Prefix Collision'
date: 2026-06-10
category: code-quality
track: bug
problem: 'Prefix-based MCP tool rename corrupts sibling tools whose names share the same prefix'
tags: [mcp, tool-rename, prefix-collision, allowed-tools, migration]
components:
  - plugins/yellow-debt/commands/sync.md
  - plugins/yellow-ci/commands/report-linear.md
---

# MCP Tool Rename Prefix Collision

## Problem

When migrating MCP tool names using a prefix-based find-replace (e.g. renaming
`mcp__plugin_yellow-linear_linear__create_issue` to `save_issue`), the
replacement target string is a strict prefix of a sibling tool name. The
replace also corrupts `mcp__plugin_yellow-linear_linear__create_issue_label`
(which survives unchanged upstream) in every `allowed-tools` list it touches.

Caught live in PR sweep: `yellow-debt/sync.md` and `yellow-ci/report-linear.md`
both contained `save_issue_label` after the rename pass.

## Symptoms

- A tool like `create_issue_label` appears in `allowed-tools` as `save_issue_label`
  after a rename pass
- The corrupted name is absent from the live MCP registry — calls fail at runtime
  with "unknown tool" errors
- CI and static validation pass because neither checks live MCP registry membership

## What Didn't Work

`\b` word-boundary anchors in sed/regex do not help: `_` is a word character,
so `\bcreate_issue\b` also matches inside `create_issue_label`.

## Solution

After any MCP tool-name migration pass, run a three-step verification:

1. Verify old name absent: `rg 'mcp__...__create_issue[^_]' plugins/` (the
   character-class exclusion prevents matching `create_issue_label`)
2. Verify new name present: `rg 'save_issue[^_l]' plugins/` (adjust exclusion
   per sibling names)
3. Detect prefix bleed: `rg 'save_issue_label' plugins/` — any hit is a
   corruption artifact

## Why This Works

The `[^_]` / `[^_l]` suffix in the grep excludes the `_label` sibling from
matching. This is more reliable than word-boundary anchors when all parts of
the name use `_` as a separator.

## Prevention

- Before any rename pass, list ALL tools in the MCP server that share the
  rename target as a prefix: `rg 'create_issue' plugins/ | sort -u`
- For each sibling, add a grep assertion to the post-rename checklist
- Never use a bare string replace (`sed 's/old/new/g'`) for MCP tool names
  — always scope to exact suffix using anchoring or character exclusion
