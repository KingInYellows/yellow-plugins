---
title: 'API Migration Stale Documentation Cascade'
date: 2026-03-03
category: 'code-quality'
tags:
  - api-migration
  - stale-documentation
  - permissions-model
  - secondary-documentation
  - review-pattern
pr_url: 'https://github.com/KingInYellows/yellow-plugins/pull/113'
---

# API Migration Stale Documentation Cascade

## Problem

When a PR updates primary API integration patterns (endpoints, permissions
model, version labels, messaging scope), secondary documentation paths retain
stale information that actively contradicts the new patterns. Unlike simple
"dead link" staleness, this creates contradictory guidance where one document
recommends the old pattern while the primary code uses the new one.

Observed in PR #113 (yellow-devin V3 API migration, permissions model update,
org-scoped messaging). The PR correctly updated 3 primary patterns:

1. **Session lookup**: Changed from individual GET endpoint to list endpoint
   with `session_ids` filter
2. **Permissions model**: Changed from 2 permissions (ManageOrgSessions +
   ManageAccountSessions) to 5 permissions (UseDevinSessions,
   ViewOrgSessions, ManageOrgSessions as required; ViewAccountSessions,
   ManageAccountSessions as optional)
3. **Messaging scope**: Changed from enterprise endpoint to org-scoped-first
   with enterprise fallback

But 8 secondary documentation locations across 4 files retained stale
information:

| File | Location | Stale Content | Contradicts |
|------|----------|---------------|-------------|
| api-reference.md:221-222 | Enterprise list notes | Recommended individual GET endpoint | Session Lookup Pattern (use list with filter) |
| setup.md:52 | Migration instructions | Listed old 2-permission model | New 5-permission model |
| setup.md:255-258 | Setup Instructions block | Listed old 2-permission model | New 3 required + 2 optional permissions |
| README.md:95-97 | 403 troubleshooting | ManageOrgSessions as "minimum" | ViewOrgSessions is actually required |
| setup.md:93-94 | Step 3 probe description | "Run two probes" | Only one probe implemented |
| setup.md:162 | Step 4 probe label | ManageAccountSessions confirmed | Only ViewAccountSessions tested |
| setup.md (partial pass) | PARTIAL PASS text | Listed untested capabilities | Only ViewOrgSessions was probed |
| orchestrator.md:81 | Suspended-session handler | "enterprise message endpoint" | Org-scoped messaging with fallback |

The P1 finding (api-reference.md contradicting the session lookup pattern) is
the most dangerous because it provides authoritative-looking guidance that
directly inverts the correct pattern. AI agents copying this recommendation
would use the wrong endpoint.

## Detection

Before merging any PR that changes API patterns, run a systematic sweep of all
documentation files that reference the changed concepts.

### Step 1: Identify what changed

From the PR diff, extract the key concepts that changed:

```bash
# Example: permissions model changed
OLD_PERMS="ManageOrgSessions|ManageAccountSessions"
NEW_PERMS="UseDevinSessions|ViewOrgSessions|ManageOrgSessions"

# Example: endpoint changed
OLD_ENDPOINT="GET /v1/sessions/{id}"
NEW_ENDPOINT="GET /v1/sessions?session_ids="

# Example: version label changed
OLD_LABEL="V3 beta"
NEW_LABEL="V3"
```

### Step 2: Grep for old patterns in all documentation

```bash
# Find all files still referencing old permissions
grep -rn --include='*.md' \
  'ManageOrgSessions\|ManageAccountSessions' \
  plugins/yellow-devin/

# Find all files still referencing old endpoint pattern
grep -rn --include='*.md' \
  'GET.*sessions/\$\|sessions/${SESSION_ID}\|individual.*session' \
  plugins/yellow-devin/

# Find all files still referencing old version label
grep -rn --include='*.md' \
  'V3 beta\|v3 beta\|V3-beta' \
  plugins/yellow-devin/
```

### Step 3: Check secondary documentation paths

These are the paths most commonly missed when primary patterns change:

1. **Setup/migration instructions** -- often written once and forgotten
2. **Troubleshooting sections** -- reference specific permissions or endpoints
3. **API reference notes** -- inline recommendations that predate the change
4. **Orchestrator cross-references** -- "see Step X" or "uses Y endpoint"
5. **Probe/test descriptions** -- describe what they test, not what they do
6. **Partial pass/warning text** -- lists capabilities assumed from tests
7. **Error messages in code** -- hardcoded permission names in shell scripts

### Step 4: Verify consistency

For each grep hit, verify the referenced pattern matches the new primary
pattern. Any mismatch is a stale documentation finding.

## Fix

### For permissions model changes

Update every location that lists required permissions. Use a canonical
permission list defined in one place and cross-reference it:

```markdown
<!-- In the primary location (e.g., CLAUDE.md or setup.md header) -->
## Required Permissions

| Permission | Required | Purpose |
|------------|----------|---------|
| UseDevinSessions | Yes | Create and interact with sessions |
| ViewOrgSessions | Yes | List and read org-level sessions |
| ManageOrgSessions | Yes | Modify org-level sessions |
| ViewAccountSessions | Optional | List enterprise-level sessions |
| ManageAccountSessions | Optional | Modify enterprise-level sessions |
```

Then in secondary locations, reference rather than duplicate:

```markdown
<!-- In troubleshooting, setup instructions, etc. -->
See [Required Permissions](#required-permissions) for the full list.
Run `/devin:setup` to verify your token has the correct permissions.
```

### For endpoint changes

When an endpoint recommendation changes, grep for all variations of the old
recommendation:

```bash
# Catch prose references, not just code
grep -rn --include='*.md' \
  'individual.*endpoint\|single.*session.*lookup\|GET.*sessions/' \
  plugins/yellow-devin/
```

### For messaging scope changes

When messaging changes from one scope to another (e.g., enterprise to
org-scoped with fallback), update all cross-references:

```bash
grep -rn --include='*.md' \
  'enterprise.*message\|enterprise.*endpoint\|message.*enterprise' \
  plugins/yellow-devin/
```

### For probe/test description mismatches

When a probe's implementation changes, update its description to match what
it actually tests, not what it was designed to test:

```markdown
<!-- WRONG: describes intent, not reality -->
Step 3 runs two probes to verify ViewOrgSessions and UseDevinSessions.

<!-- RIGHT: describes what actually happens -->
Step 3 runs one probe (list endpoint) that confirms ViewOrgSessions.
UseDevinSessions is assumed based on successful listing.
```

## Prevention

### 1. Add a documentation sweep step to API migration PRs

Before marking any API migration PR as ready for review, run the detection
grep commands from the Detection section above. Treat any stale reference as
a blocking finding.

### 2. Centralize authoritative definitions

Define permissions, endpoints, and version labels in exactly one canonical
location. All other documentation should cross-reference rather than
duplicate. When the canonical location changes, stale duplicates become
immediately obvious because they don't use cross-references.

### 3. Use a documentation consistency checklist

For any PR that changes API patterns, verify these secondary paths:

- [ ] Setup/installation instructions match new patterns
- [ ] Migration/upgrade instructions match new patterns
- [ ] Troubleshooting sections reference correct permissions/endpoints
- [ ] API reference notes recommend the current approach
- [ ] Orchestrator/agent cross-references point to correct steps
- [ ] Probe/test descriptions match their actual behavior
- [ ] Partial pass/warning text lists only what was actually tested
- [ ] Error messages in shell code reference correct permission names

### 4. Review documentation-only PRs with the same rigor as code PRs

When a PR updates documentation that contains shell code patterns (not
executable code), AI agents copy these patterns directly. Stale references in
secondary documentation paths are functionally equivalent to bugs in code
because they cause agents to use incorrect patterns.

## Related Documentation

- `docs/solutions/code-quality/cross-plugin-documentation-correctness.md` --
  covers wrong command names and credential names across plugins (different
  root cause: inference from convention rather than reading source)
- `docs/solutions/code-quality/public-release-stale-references-and-prettier-formatting.md` --
  covers stale references after archiving operations (different root cause:
  moving files without scanning for references)
- `docs/solutions/code-quality/agent-migration-audit-patterns.md` --
  covers stale invocation sites after code extraction (different root cause:
  not updating all callers when moving logic to a new file)
- `docs/solutions/security-issues/yellow-devin-plugin-security-audit.md` --
  H9 (curl exit codes not checked) relates to the silent 403 fallback finding
