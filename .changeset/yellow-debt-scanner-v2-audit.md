---
"yellow-debt": patch
---

Audit-only confirmation that all 5 scanner agents (ai-pattern, architecture,
complexity, duplication, security-debt) emit the canonical v2.0 schema per
the `debt-conventions` skill. The full v2.0 finding schema includes
`finding`, `file`, `failure_scenario`, `confidence`, `category`, `severity`,
`effort`, and `fix` (see `plugins/yellow-debt/skills/debt-conventions/SKILL.md`
for the authoritative field list); each scanner's "Output Requirements"
section delegates to that skill rather than enumerating the fields inline.
Closes Wave 3 #7 from the EveryInc merge plan.

Verified by line-grep against each scanner's "## Output Requirements" section
(referencing section heading rather than line number so this audit record
does not go stale on subsequent edits):

- `ai-pattern-scanner.md` "## Output Requirements" → cites `debt-conventions` v2.0 ✓
- `architecture-scanner.md` "## Output Requirements" → cites v2.0 ✓
- `complexity-scanner.md` "## Output Requirements" → cites v2.0 ✓
- `duplication-scanner.md` "## Output Requirements" → cites v2.0 ✓
- `security-debt-scanner.md` "## Output Requirements" → cites v2.0 ✓

The dual-read logic in `audit-synthesizer.md` ("### 1. Read Scanner Outputs"
section) handles v1.0 → v2.0 migration via explicit `schema_version` field
check, so existing `.debt/scanner-output/*.json` files do not break on
re-encounter. No code changes required in this PR.

No body changes to scanner agents; this PR exists to record the audit
completion in the changelog and bump the patch version so downstream
catalog version sync reflects the verified state.
