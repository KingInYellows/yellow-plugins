---
status: wont-fix
priority: p3
issue_id: '094'
tags: [code-review, consistency, documentation]
dependencies: []
---

# 🔵 P3: Inconsistent README Presence

## Problem Statement

Only 3 of 9 plugins (yellow-ruvector, yellow-debt, gt-workflow) have README.md
files, while all 9 plugins have comprehensive CLAUDE.md files. This
inconsistency creates uncertainty about documentation expectations.

## Findings

**With README.md** (3 plugins):

- yellow-ruvector (79 lines) — Quick start, installation, troubleshooting table
- yellow-debt (222 lines) — Comprehensive external docs with problem/solution
  architecture
- gt-workflow (86 lines) — Command reference, installation, requirements

**Without README.md** (6 plugins):

- yellow-browser-test
- yellow-core
- yellow-devin
- yellow-linear
- yellow-review
- One other plugin

**All plugins have**:

- Comprehensive CLAUDE.md with usage instructions
- plugin.json with name, description, keywords
- Skills/agents/commands with embedded documentation

## Decision: Won't Fix

After reviewing the three existing README files, they provide **legitimate
value** as GitHub-facing documentation:

1. **Different audiences**: README.md targets external GitHub visitors;
   CLAUDE.md targets Claude's context
2. **Different purposes**: READMEs provide installation, quick-start,
   troubleshooting; CLAUDE.md provides conventions, internal patterns,
   when-to-use-what
3. **Substantive content**: All three READMEs contain well-structured,
   user-friendly documentation with unique value
4. **No duplication**: READMEs don't duplicate CLAUDE.md — they complement it

**README.md is optional but recommended** for plugins that need external-facing
documentation. The inconsistency is acceptable because:

- Not all plugins need external docs (yellow-core is internal, yellow-linear is
  straightforward)
- Forcing all plugins to have READMEs creates unnecessary maintenance burden
- The three plugins with READMEs are the most complex and benefit from external
  documentation

## Policy Documentation

README.md guidelines for yellow-plugins:

- **Optional** — only create if plugin needs external-facing documentation
- **Target audience** — GitHub visitors, not Claude
- **Content focus** — Installation, quick start, troubleshooting, examples
- **Avoid duplication** — Don't copy CLAUDE.md content verbatim
- **Recommended for** — Complex plugins, plugins with setup requirements,
  plugins targeting external users

## Acceptance Criteria

- [x] Reviewed all three README files for substantive content
- [x] Verified no significant duplication with CLAUDE.md
- [x] Documented policy for future plugin development
- [x] Marked as won't-fix with clear rationale

## Work Log

**2026-02-15**: Finding identified during comprehensive plugin marketplace
review. **2026-02-15**: Reviewed all README files. Decision: Keep existing
READMEs, document as optional.

## Resources

- Plugin marketplace review session
- Plugins with README: yellow-ruvector, yellow-debt, gt-workflow
- All plugin CLAUDE.md files
