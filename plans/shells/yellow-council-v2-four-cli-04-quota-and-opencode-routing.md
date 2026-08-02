---
spec: plans/specs/yellow-council-v2-four-cli.md
spec-r-ids: [R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R23, R24, R25, R26, R27, R28, R29, R30]
depends_on: [yellow-council-v2-four-cli-02-claude-reviewer-fanout]
---

# Plan: Quota Exhaustion Handling + OpenCode Fourth-Lineage Routing

## Context

Two small orthogonal phases combined into one session. First, slim quota
handling: providers no longer publish numeric caps, so detection is
error-string driven only — each of the 4 reviewers recognizes its provider's
quota-exhaustion signals, distinguishes them from transient errors, and
returns a stub 6-key block with `verdict=QUOTA_EXHAUSTED` and the parsed
reset ETA, which the orchestrator surfaces in the headline (no state file,
no pre-flight headroom math, no quorum gate — all cut by the brainstorm).
Second, OpenCode lineage routing: a `COUNCIL_OPENCODE_MODEL` env var
defaulting to DeepSeek V4 Pro via OpenRouter for genuine non-Big-3 lineage,
plus a best-effort lineage-diversity pre-flight. The exact slug/auth recipe
is unknown (the previously assumed config mechanism is undocumented) and
MUST be resolved by a spike before implementation.

## Produces

- `QUOTA_EXHAUSTED` verdict propagating through all 4 reviewer agents and
  the orchestrator parser as an UNAVAILABLE-class verdict (headline + ETA,
  excluded from synthesis)
- Per-provider quota-error match sets (claude session/weekly/Opus strings;
  codex insufficient_quota/model_cap_exceeded; gemini RESOURCE_EXHAUSTED
  floor; opencode provider passthrough) with transient-vs-cap discrimination
- Stub quota-exhausted return shape (6-key block, /dev/null fenced path,
  empty findings)
- `COUNCIL_OPENCODE_MODEL` env var wiring with spike-verified default slug
  and empty-value V1 fallback
- Model-unavailable graceful degradation (actionable UNAVAILABLE, not
  council failure)
- Lineage-diversity pre-flight with non-blocking same-lineage warning and
  resolved-model report header
- OpenCode routing spike record (slug format, auth mechanism)

## Consumes

- 4 reviewer agent files including claude-reviewer, and the uniform verdict
  parser (from Shell yellow-council-v2-four-cli-02-claude-reviewer-fanout)
- Existing OpenCode invocation block and its PACK_BYTES guard, which must
  not be disturbed (from existing codebase)
- Existing env-var-with-default precedents for model selection (from
  existing codebase)

## Covers Spec Requirements

- R16
- R17
- R18
- R19
- R20
- R21

## Implementation Steps (High-Level)

1. **Extend the verdict enum everywhere** — add QUOTA_EXHAUSTED to all four
   reviewer case-statements and the orchestrator parser; route it to the
   headline/ETA path, excluded from synthesis counts.
2. **Per-provider detection** — implement each reviewer's match set with
   explicit transient exclusions (generic rate-limit text, HTTP 529); parse
   the reset ETA out of the provider error text into the summary line.
3. **Stub return shape** — quota-exhausted reviewers return the full 6-key
   block with stubbed keys so the uniform parser needs no special case.
4. **Routing spike** — enumerate OpenCode's accepted DeepSeek slug and auth
   path empirically; record results in the existing OpenCode spike doc; this
   output is authoritative for the default value.
5. **Wire COUNCIL_OPENCODE_MODEL** — pass the model flag when set, leave V1
   behavior when empty; graceful UNAVAILABLE with actionable guidance when
   the model doesn't resolve.
6. **Lineage pre-flight** — best-effort per-slot lineage detection,
   non-blocking collision warning, resolved models in the report header.
7. **Document and ship** — new env var in both configuration tables; provider
   routing and known limitations documented; minor changeset; CI baseline
   gate.

## Open Questions

- OpenCode → OpenRouter slug/auth recipe: resolves empirically from the
  spike in step 4 (model-listing output is authoritative); the rescinded
  `defaultProvider`-in-config mechanism must not be assumed. Deferred to
  expansion/implementation.
- Gemini-slot quota strings depend on the Phase G Antigravity migration
  (independent bugfix outside this spec): if the `agy` spike surfaced
  Antigravity-specific exhaustion strings, add them to the match set here;
  otherwise ship the RESOURCE_EXHAUSTED floor only. Deferred to expansion.
