---
title: "Multi-Document Schema-Rename Drift: Canonical Source Pattern"
date: "2026-05-01"
category: code-quality
track: knowledge
problem: "Renaming a schema field across 3+ coupled docs causes drift when each doc redocuments field names in its own prose"
tags:
  - schema-migration
  - plugin-authoring
  - documentation-drift
  - cross-doc-consistency
  - code-review
  - confidence-rubric
  - yellow-debt
components:
  - plugins/yellow-debt/agents/synthesis/audit-synthesizer.md
  - plugins/yellow-debt/README.md
---

# Multi-Document Schema-Rename Drift: Canonical Source Pattern

Discovered during multi-agent review of PR #316
(`feat(yellow-debt): scanner output schema v2.0 with confidence-rubric
calibration`). A field rename across three coupled documents produced a
heading mismatch that was independently caught by three reviewers and
Greptile's auto-review — all before any human review round concluded.

## Context

When the yellow-debt scanner output schema renamed `suggested_remediation`
to `fix` (v1.0 → v2.0), three documents needed updating:

1. The synthesizer agent's Step 7 mapping table
   (`plugins/yellow-debt/agents/synthesis/audit-synthesizer.md`)
2. The SKILL.md canonical schema definition
3. The README todo template's rendered heading
   (`plugins/yellow-debt/README.md:175`)

The mapping table and the README template drifted: the mapping table retained
`## Suggested Remediation` while the README used the renamed `## Fix`. A
companion drift also appeared — the `confidence:` frontmatter key was
documented in the synthesizer's mapping table as a required write, but was
absent from the README todo template's example frontmatter block (a
write-side-only constraint with no consumer documentation).

## Detection Signal

The `/yellow-review:review:review-pr` pipeline surfaced this as a
cross-reviewer agreement finding: `project-compliance-reviewer`,
`correctness-reviewer`, and `pattern-recognition-specialist` all flagged it
independently. Via the Wave 2 confidence-rubric promotion logic
(`50 → 75 → 100` on cross-reviewer agreement), it was elevated to anchor 100 —
the highest confidence level. Greptile's auto-review flagged the same drift in
the PR body before the agent review ran.

**Rule:** When `/yellow-review:review:review-pr` surfaces a finding flagged by
3+ independent reviewers and promoted to anchor 100 via the confidence rubric,
treat it as a near-certain drift signal, not a false positive. This is exactly
the scenario the rubric is calibrated to elevate.

## Guidance

### One Canonical Source — Everything Else Cross-References

When a schema renames fields, designate **one document as the canonical
source** for all field names. All other documents must cross-reference it
rather than redocument the field names in their own prose.

**Canonical source hierarchy:**

| Role | Canonical for |
|---|---|
| Writing agent's mapping table (e.g., synthesizer Step 7) | Field names an agent writes |
| SKILL.md schema section | Field names exposed to consumers |
| Downstream readers (README templates, downstream agents) | Cross-reference the mapping table — never redocument |

**WRONG:** Three documents each list the field name in their own prose:

```text
synthesizer Step 7: "write `suggested_remediation` heading"
README template:    "## Fix"
SKILL.md:           "`fix` (renamed from v1.0 `suggested_remediation`)"
```

**RIGHT:** One canonical source, two cross-references:

```text
synthesizer Step 7 (canonical): "write `## Fix` heading"
README template: "see synthesizer Step 7 mapping table for heading names"
SKILL.md: "see synthesizer Step 7 for write-side field names"
```

### Comment Block in the Canonical Document

Add an explicit enumeration comment in the canonical mapping table:

```markdown
<!-- SCHEMA AUTHORITY: This table is the single source of truth for all
     field names written by this agent. Documents that reference these
     fields: README.md todo template, debt-fixer.md input schema.
     When renaming any field, update ALL three locations. -->
```

### Build-Time Grep Assertion

After any schema rename, add a grep assertion to CI that fails if the
old field name appears in any post-rename document:

```bash
# In CI or a pre-commit hook — run after schema v2.0 rename
OLD_FIELD="Suggested Remediation"
DOCS_TO_CHECK=(
  "plugins/yellow-debt/agents/synthesis/audit-synthesizer.md"
  "plugins/yellow-debt/README.md"
  "plugins/yellow-debt/skills/debt-conventions/SKILL.md"
)
for doc in "${DOCS_TO_CHECK[@]}"; do
  if grep -qi "$OLD_FIELD" "$doc"; then
    printf 'ERROR: Stale field name "%s" found in %s\n' "$OLD_FIELD" "$doc" >&2
    exit 1
  fi
done
```

## Why This Matters

Schema field renames touch the write side (agents that produce the field),
the schema authority (SKILL.md), and the read side (templates and downstream
agents that consume it). Any of these can silently drift if not updated
atomically. The drift is especially dangerous in heading-level renames
(e.g., `## Suggested Remediation` → `## Fix`) because the rendered output
looks plausible in isolation — only a cross-document comparison reveals the
inconsistency.

This is the same class of drift as CI/manifest schema drift (documented in
`docs/solutions/build-errors/plugin-json-changelog-key-schema-drift-remote-validator.md`),
but applied to plugin-internal documentation rather than CI tooling.

## When to Apply

Apply this pattern before any schema field rename:

1. List all documents that reference the field name (not just define it).
2. Designate one as the canonical source.
3. Replace all other occurrences with cross-references to the canonical source.
4. Add a build-time assertion for the old name.
5. After the PR merges, verify the assertion passes in CI.

## Examples

**Finding from PR #316:**
- `plugins/yellow-debt/agents/synthesis/audit-synthesizer.md` Step 7: `## Suggested Remediation`
- `plugins/yellow-debt/README.md:175`: `## Fix`
- Fix: update synthesizer Step 7 to use `## Fix`; add cross-reference comment

**Companion drift (same PR):**
- `confidence:` written by synthesizer but absent from README template frontmatter
- Fix: add `confidence:` to README template's example frontmatter block with note "written by synthesizer"

---

## Related Documentation

- `docs/solutions/build-errors/plugin-json-changelog-key-schema-drift-remote-validator.md` — Same class of drift in CI/manifest context
- `docs/solutions/code-quality/claude-code-command-authoring-anti-patterns.md` — Anti-patterns in LLM-executed command prose
