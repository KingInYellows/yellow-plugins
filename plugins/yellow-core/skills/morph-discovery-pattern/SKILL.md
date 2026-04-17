---
name: morph-discovery-pattern
description: "Morph discovery + fallback pattern — discover morph edit_file and warpgrep tools at runtime via ToolSearch, prefer them for large edits and intent-based search, silently fall back to built-in Edit/Grep when yellow-morph is not installed. Use when authoring agents that need efficient editing or semantic code search with graceful degradation."
user-invokable: false
---

# Pattern: Morph-Discovery

Discover morph tools at runtime via ToolSearch. Prefer morph when available
for large file edits and intent-based code search. Fall back to built-in
tools silently when morph is not installed.

## For File Editing

```text
1. Call ToolSearch("morph edit")
2. If found AND (file > 200 lines OR change spans 3+ non-contiguous regions):
   prefer morph edit_file over built-in Edit
3. If not found OR file is small with contiguous changes:
   use built-in Edit
4. No warning on fallback. No degradation message.
```

## For Intent-Based Code Search

```text
1. Call ToolSearch("morph warpgrep")
2. If found AND query is intent-based ("what calls this function?",
   "find similar patterns", "blast radius of this change"):
   prefer morph warpgrep_codebase_search
3. If not found OR query is exact-match (specific string, regex):
   use built-in Grep
4. No warning on fallback. No degradation message.
```

## Design Choices

- **Keyword-based ToolSearch** (`"morph edit"`, `"morph warpgrep"`) rather than
  `select:<exact_name>` — resilient to tool renames.
- **Per-command discovery** rather than session-level caching — ToolSearch is
  fast (sub-100ms), avoids coupling to morph package names.
- **No hard dependency** — morph tools are never listed in command
  `allowed-tools`. Discovery happens at runtime.

## Anti-Patterns

- **Do not** add morph tools to command `allowed-tools` — use ToolSearch
  discovery
- **Do not** warn or message the user when morph is not available

## Related

- `memory-recall-pattern` — query past learnings at workflow start.
- `memory-remember-pattern` — store learnings at workflow end.
