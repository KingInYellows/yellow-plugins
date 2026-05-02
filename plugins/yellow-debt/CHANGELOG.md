# Changelog

## 1.4.0

### Minor Changes

- [#316](https://github.com/KingInYellows/yellow-plugins/pull/316)
  [`bc6aa3f`](https://github.com/KingInYellows/yellow-plugins/commit/bc6aa3f7d6a7269d141939615816e9217225a1b1)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - # Scanner
  output schema v2.0 — failure_scenario field, audit-synthesizer

  confidence-rubric gate, dual-read v1.0/v2.0 transition window (W3.13b)

  Bumps `debt-conventions/SKILL.md` from `schema_version: "1.0"` to `"2.0"` and
  restructures the scanner output shape:
  - `affected_files[]` (array) → `file` (single object); multi-file findings
    emit one finding per file instead of packing them into one entry
  - `title` + `description` → flat `finding` string
  - `suggested_remediation` → `fix`
  - new required `failure_scenario` field (string or `null`) —
    one-to-two-sentence concrete production failure: trigger → execution path →
    user-visible or operational outcome. Borrowed from upstream
    `EveryInc/compound-engineering-plugin` `ce-adversarial-reviewer.agent.md` at
    locked SHA `e5b397c9d1883354f03e338dd00f98be3da39f9f`.

  `audit-synthesizer` gains a category-specific confidence-rubric gate (Step 4):
  security-debt/architecture ≥0.80, complexity/duplication ≥0.70, ai-pattern
  ≥0.60. Critical findings survive at ≥0.50 (mirrors the Wave 2 P0-at-anchor-50
  exception). Migrated v1.0 inputs receive a +0.05 threshold bump to compensate
  for the missing `failure_scenario` signal.

  The synthesizer dual-reads `schema_version: "1.0"` and `"2.0"` artifacts
  during the transition window, normalizing v1.0 inputs to the v2.0 in-memory
  shape so existing `.debt/scanner-output/*.json` files do not break re-runs.
  Suppressed findings are preserved in a `suppressed[]` array on the audit
  report (with the gate that suppressed them) rather than silently dropped.

  All 5 scanner agents (`ai-pattern`, `architecture`, `complexity`,
  `duplication`, `security-debt`) updated with category-specific
  `failure_scenario` framing guidance in their Output Requirements sections. The
  yellow-debt README todo template gains a `## Failure Scenario` section so
  triage reviewers see the production-impact framing alongside the debt
  description.

  Schema evolution: scanner output is renamed v1.0 → v2.0 with field renames and
  a new required failure_scenario field. The audit-synthesizer's dual-read
  transition window normalizes v1.0 inputs in-memory, so existing scanner
  outputs continue to work without modification during the transition window.

## 1.3.0

### Minor Changes

- [`dfebc48`](https://github.com/KingInYellows/yellow-plugins/commit/dfebc48f74c6b88cf6c5ccff73e3ad604dca714c)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add ast-grep
  MCP tools to 4 high-value review and debt agents

  Add ast-grep structural code search (find_code, find_code_by_rule) with
  ToolSearch-based graceful degradation to silent-failure-hunter,
  type-design-analyzer, duplication-scanner, and complexity-scanner. Each agent
  includes tailored AST vs Grep routing guidance and falls back to Grep when
  yellow-research is not installed.

All notable changes to this plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## Unreleased

_No unreleased changes yet._

---

## [1.2.0] - 2026-03-10

### Minor Changes

- [`69d84c8`](https://github.com/KingInYellows/yellow-plugins/commit/69d84c8f17a23da89979765c434d4e2c0c683935)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Expand
  marketplace setup coverage with dedicated setup commands, repository-root
  aware setup checks, and stricter setup validation guardrails.

---

## [1.1.0] - 2026-02-25

### Fixed

- Remove unsupported `changelog` key from plugin.json that blocked installation
  via Claude Code's remote validator.

---

## [1.0.0] - 2026-02-18

### Added

- Initial release — technical debt audit and remediation with parallel scanner
  agents for AI-generated code patterns.

---

**Maintained by**: [KingInYellows](https://github.com/KingInYellows)
