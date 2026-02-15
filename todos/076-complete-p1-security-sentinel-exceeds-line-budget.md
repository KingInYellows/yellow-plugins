---
status: pending
priority: p1
issue_id: "076"
tags: [code-review, quality, agent-length]
dependencies: []
---

# 🔴 P1: Security Sentinel Agent Exceeds Line Budget by 87 Lines

## Problem Statement
The yellow-core/agents/review/security-sentinel.md agent is 207 lines, exceeding the 120-line quality rule by 87 lines (173%). The file contains detailed OWASP checklist, language-specific security patterns, and vulnerability explanations that duplicate well-known security knowledge from LLM training data. Additionally, the agent is missing required `allowed-tools` frontmatter. Ironically, this security-focused agent is also missing prompt injection fencing (tracked separately in todo 069).

## Findings
**Current state:**
- File length: 207 lines
- Over budget: 87 lines (173% of limit)
- Location: `plugins/yellow-core/agents/review/security-sentinel.md`
- Missing: `allowed-tools` frontmatter field
- Missing: Prompt injection fencing (see todo 069)

**Bloat sources:**
1. **Detailed OWASP checklist** (lines 50-120): 70 lines documenting injection attacks, broken authentication, XSS, CSRF, etc. — all well-known OWASP Top 10 items
2. **Language-specific security patterns** (lines 130-180): 50 lines of TypeScript/Python/Rust-specific vulnerability patterns
3. **Vulnerability explanations**: Detailed descriptions of how attacks work — training data duplication
4. **Redundant validation**: Multiple sections repeat "validate input", "sanitize output" in different ways

**Quality impact:**
- 173% of line budget
- Duplicates OWASP security training data
- Violates "don't document what the model already knows" principle
- Missing required `allowed-tools` frontmatter
- Missing prompt injection fencing (ironic for security agent)

## Proposed Solutions

### Solution 1: Condense to Security Checklist + Add Frontmatter (Recommended)
Remove detailed OWASP explanations and language-specific patterns, keep only high-level security categories and output format. Add missing `allowed-tools`.

**Trim:**
- Remove lines 50-120 (OWASP details) → replace with "Review for OWASP Top 10 vulnerabilities" (~1 line)
- Condense lines 130-180 (language-specific patterns) → keep 2-3 bullets per language (~10 lines)
- Remove vulnerability explanations → assume LLM knows attack vectors
- Consolidate validation instructions to single section

**Keep:**
- Agent purpose and trigger clause ("Use when reviewing code for security vulnerabilities")
- High-level security categories (injection, authentication, authorization, data exposure, etc.)
- Output format specification (findings with severity, location, remediation)
- Unique directives (e.g., "prioritize by exploitability and impact")

**Add:**
- `allowed-tools` frontmatter listing all tools used (likely Read, Grep, Glob)
- Note: Prompt injection fencing will be added via todo 069

**Pros:**
- Gets under 120-line limit
- Removes OWASP training data duplication
- Adds required frontmatter
- Focuses on review task, not security education

**Cons:**
- Less explicit about specific vulnerabilities
- Requires trust in LLM's security knowledge

**Effort:** Low (1-2 hours)
**Risk:** Very low (OWASP is fundamental security knowledge)

### Solution 2: Keep Checklist, Split Patterns to Skill
Keep OWASP checklist as reminders, move language-specific patterns to separate skill.

**Pros:**
- Preserves OWASP quick reference
- Separates concerns

**Cons:**
- Still duplicates security training data
- Creates skill maintenance burden
- Doesn't fully solve bloat problem

**Effort:** Medium (3-4 hours)
**Risk:** Low

## Recommended Action
**Implement Solution 1**: Condense to security checklist, add `allowed-tools` frontmatter.

**Execution plan:**
1. Add `allowed-tools: [Read, Grep, Glob]` to frontmatter (verify actual tools used)
2. Remove lines 50-120 (OWASP details) → replace with:
   - "Review for OWASP Top 10 vulnerabilities"
   - List categories only: injection, broken auth, sensitive data, XXE, broken access control, security misconfiguration, XSS, insecure deserialization, vulnerable components, insufficient logging
   (~12 lines as bullets)
3. Condense lines 130-180 (language-specific) → 2-3 bullets per language:
   - "TypeScript: SQL/NoSQL injection, XSS, prototype pollution, regex DoS"
   - "Python: injection, pickle exploits, path traversal, YAML deserialization"
   - "Rust: unsafe blocks, integer overflow, unvalidated input in unsafe contexts"
   (~10 lines)
4. Remove vulnerability explanations (how attacks work)
5. Consolidate validation instructions → "Validate input, sanitize output, apply least privilege" (~5 lines)
6. Ensure output format section clear
7. Target final length: ~110 lines
8. Verify trigger clause: "Use when reviewing code for security vulnerabilities"
9. Note: Prompt injection fencing will be added separately in todo 069

## Technical Details
**Current structure (207 lines):**
```
Lines 1-49: Frontmatter + trigger clause (missing allowed-tools)
Lines 50-120: Detailed OWASP checklist (CONDENSE to category list)
Lines 130-180: Language-specific patterns (CONDENSE to 2-3 bullets each)
Lines 181-207: Output format + validation (KEEP/CONSOLIDATE)
```

**Target structure (~110 lines):**
```
Lines 1-30: Frontmatter (with allowed-tools) + trigger clause
Lines 31-42: OWASP categories (10 bullets)
Lines 43-52: Language-specific bullets (2-3 per language)
Lines 53-62: Validation/defense principles (5 bullets)
Lines 63-110: Output format + severity guidelines + edge cases
```

**Frontmatter to add:**
```yaml
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash  # if used for dependency scanning
```

**Key content to preserve:**
- Trigger: "Use when reviewing code for security vulnerabilities"
- Security categories: OWASP Top 10 (by name, not detailed explanation)
- Output: structured findings with severity, location, vulnerability type, remediation steps
- Unique directives:
  - Prioritize by exploitability and impact
  - Distinguish theoretical vs practical vulnerabilities
  - Flag outdated dependencies with known CVEs
  - Note defense-in-depth opportunities

## Acceptance Criteria
- [ ] File length ≤ 120 lines
- [ ] `allowed-tools` frontmatter added with all tools used
- [ ] OWASP checklist condensed to category names (no detailed explanations)
- [ ] Language-specific patterns condensed to 2-3 bullets per language
- [ ] Vulnerability explanations removed
- [ ] Validation instructions consolidated to single section
- [ ] Trigger clause preserved
- [ ] Output format specification clear
- [ ] Unique directives preserved (prioritize, distinguish, flag CVEs)
- [ ] `pnpm validate:plugins` passes
- [ ] Manual test: agent can perform security review
- [ ] Note: Prompt injection fencing tracked separately in todo 069

## Work Log
**2026-02-15**: Finding identified during comprehensive plugin marketplace review. Agent is 207 lines (87 over budget), contains detailed OWASP checklist and language-specific patterns duplicating LLM security training data, missing `allowed-tools` frontmatter. Also missing prompt injection fencing (tracked in separate todo 069).

## Resources
- Plugin marketplace review session
- Agent file: `plugins/yellow-core/agents/review/security-sentinel.md`
- Quality rule source: PR #8 review
- Frontmatter requirement: `docs/plugin-validation-guide.md`
- Related: todo 069 (prompt injection fencing)
