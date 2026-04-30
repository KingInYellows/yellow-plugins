# Upstream Snapshot Manifest

**Source repo:** `EveryInc/compound-engineering-plugin`
**Locked SHA:** `e5b397c9d1883354f03e338dd00f98be3da39f9f`
**Release tag at SHA:** `compound-engineering-v3.3.2` (released 2026-04-29)
**Fetched:** 2026-04-29 (Wave 1+2); extended 2026-04-30 with Wave 3 references
**Fetched by:** `/yellow-core:workflows:work` Phase 0 for `plans/everyinc-merge.md` backbone (Wave 1 + Wave 2 prep + keystone); extended 2026-04-30 for `plans/everyinc-merge-wave3.md` Phase 0.2.
**Cap policy:** `>500 line` files in this snapshot tree are reference-only; we are not porting them whole. Files exceeding the cap (extract sub-patterns only):

| File | Lines | Extraction policy |
|---|---|---|
| `skills/ce-code-review/SKILL.md` | 891 | Confidence rubric only (W2.3/W2.4) — already extracted in backbone. |
| `skills/ce-compound/SKILL.md` | 546 | Track schema + context-budget precheck only (W2.0a) — already extracted in backbone. |
| `skills/ce-compound-refresh/SKILL.md` | 703 | W3.10 — extract staleness/overlap detection patterns only. |
| `skills/ce-optimize/SKILL.md` | 659 | W3.14 — extract LLM-as-judge pipeline + schema only. |
| `skills/ce-agent-native-architecture/references/mobile-patterns.md` | 871 | W3.5 — reference-only; mobile patterns out of scope for yellow-plugins. |
| `skills/ce-agent-native-architecture/references/shared-workspace-architecture.md` | 680 | W3.5 — extract workspace boundaries pattern only. |
| `skills/ce-agent-native-architecture/references/agent-native-testing.md` | 582 | W3.5 — reference-only; informs but does not drive yellow agent-native reviewers. |
| `skills/ce-agent-native-architecture/references/mcp-tool-design.md` | 506 | W3.5 — extract MCP tool design heuristics only. |

## Snapshot → yellow-plugins task map

| Snapshot file | yellow-plugins task(s) | Use |
|---|---|---|
| `agents/ce-best-practices-researcher.agent.md` | W1.3 | Skills-first phase-1 parity reference for repaired `best-practices-researcher.md`. |
| `agents/ce-repo-research-analyst.agent.md` | W1.3 | Structured technology scan pattern (CE PR #327) for `repo-research-analyst.md`. |
| `agents/ce-git-history-analyzer.agent.md` | W1.3 | Frontmatter parity reference. |
| `agents/ce-spec-flow-analyzer.agent.md` | W1.3 | Frontmatter parity reference (file lives in `agents/workflow/`, not `agents/review/`). |
| `agents/ce-performance-oracle.agent.md` | W1.3 | Oracle-side narrowing reference for the performance split. |
| `agents/ce-performance-reviewer.agent.md` | W1.3 | New file pattern reference (analyzer split). |
| `agents/ce-security-sentinel.agent.md` | W1.3 | Sentinel-side narrowing reference for security split. |
| `agents/ce-security-reviewer.agent.md` | W1.3 | New file pattern reference (reviewer split). |
| `agents/ce-security-lens-reviewer.agent.md` | W1.3 | New file pattern reference (lens split — note: CE upstream uses `ce-security-lens-reviewer`; we adopt as `security-lens.md`). |
| `agents/ce-pr-comment-resolver.agent.md` | W1.4 | CE PR #490 untrusted-input fence pattern; diff against existing fences in `pr-comment-resolver.md`. |
| `agents/ce-correctness-reviewer.agent.md` | W2.2 | Persona authoring reference. |
| `agents/ce-maintainability-reviewer.agent.md` | W2.2 | Persona authoring reference. |
| `agents/ce-reliability-reviewer.agent.md` | W2.2 | Persona authoring reference. |
| `agents/ce-project-standards-reviewer.agent.md` | W2.2 | Persona authoring reference. |
| `agents/ce-adversarial-reviewer.agent.md` | W2.2 | Persona authoring reference; `failure_scenario` framing also informs W3.13b (Wave 3). |
| `agents/ce-learnings-researcher.agent.md` | W2.1 | Authoring reference for new yellow-core `learnings-researcher.md`. |
| `skills/ce-code-review/SKILL.md` | W2.3, W2.4 | Confidence rubric extraction (tier definitions, FP suppression thresholds, intent-verification format, compact-return schema). 891 lines — extract rubric only. |
| `skills/ce-compound/SKILL.md` | W2.0a | Track schema (`track: bug|knowledge`, `tags`, `problem`) + context budget precheck pattern. 546 lines — extract schema/precheck only. |
| `skills/ce-resolve-pr-feedback/SKILL.md` | W1.4 | Resolve-pr fence and resolver-task wiring reference; W3.3 (cluster + actionability) reference for parallel run. |
| `skills/ce-debug/` (4 files) | W3.1 | Authoring reference for `plugins/yellow-core/skills/debugging/SKILL.md`. SKILL + 3 references (anti-patterns, defense-in-depth, investigation-techniques). |
| `skills/ce-doc-review/` (8 files) | W3.2 | Authoring reference for `plugins/yellow-docs/agents/review/{coherence,design-lens,feasibility,product-lens,scope-guardian,security-lens,adversarial-document}-reviewer.md` + new `/docs:review` command. SKILL + 7 references. |
| `agents/ce-coherence-reviewer.agent.md` | W3.2 | Persona authoring reference. |
| `agents/ce-design-lens-reviewer.agent.md` | W3.2 | Persona authoring reference. |
| `agents/ce-feasibility-reviewer.agent.md` | W3.2 | Persona authoring reference. |
| `agents/ce-product-lens-reviewer.agent.md` | W3.2 | Persona authoring reference. |
| `agents/ce-scope-guardian-reviewer.agent.md` | W3.2 | Persona authoring reference. |
| `agents/ce-adversarial-document-reviewer.agent.md` | W3.2 | Persona authoring reference. |
| `agents/ce-cli-readiness-reviewer.agent.md` | W3.5 | Persona authoring reference for `plugins/yellow-review/agents/review/cli-readiness-reviewer.md`. |
| `agents/ce-cli-agent-readiness-reviewer.agent.md` | W3.5 | Persona authoring reference for `plugins/yellow-review/agents/review/agent-cli-readiness-reviewer.md`. |
| `agents/ce-agent-native-reviewer.agent.md` | W3.5 | Persona authoring reference for `plugins/yellow-review/agents/review/agent-native-reviewer.md`. |
| `skills/ce-agent-native-architecture/` (15 files) | W3.5 | Skill authoring reference. SKILL + 14 reference docs. 4 reference docs exceed 500 lines (see cap policy). |
| `skills/ce-agent-native-audit/SKILL.md` | W3.5 | Skill authoring reference for agent-native-audit. |
| `skills/ce-compound-refresh/` (5 files) | W3.10 | Source for `plugins/yellow-core/skills/compound-lifecycle/SKILL.md` (PR #296) — adapted from ce-compound-refresh's 5-outcome classification (Keep / Update / Consolidate / Replace / Delete), scope-routing, and drift-classification framework. yellow-plugins diverges on the Delete rule: archives instead of deleting (`docs/solutions/archived/<category>/`). 703-line upstream SKILL.md (extract policy above) → ~400-line focused implementation. SKILL + 4 helpers (assets/resolution-template, references/{schema.yaml, yaml-schema.md}, scripts/validate-frontmatter.py). |
| `skills/ce-ideate/` (4 files) | W3.11 | Authoring reference for `plugins/yellow-core/skills/ideation/SKILL.md`. SKILL + 3 references (post-ideation-workflow, universal-ideation, web-research-cache). |
| `agents/ce-session-historian.agent.md` | W3.12 | Authoring reference for `plugins/yellow-core/agents/workflow/session-historian.md`. |
| `skills/ce-optimize/` (12 files) | W3.14 | Authoring reference for `plugins/yellow-core/skills/optimize/SKILL.md` + `schema.yaml`. SKILL (659 lines, extract policy above) + README + 7 references + 3 scripts. |
| `agents/ce-api-contract-reviewer.agent.md` | W3.15 | Source for `plugins/yellow-review/agents/review/plugin-contract-reviewer.md` (PR #293, merged 2026-04-30) — adapted from REST-API focus to plugin-contract focus (subagent_type, command/skill/MCP-tool renames, manifest/hook contract changes). Preserves the breaking-change classification framework, drops REST-specific examples. |
| `skills/ce-worktree/` (2 files) | W3.4 reference | Reference for `plugins/yellow-core/skills/git-worktree/SKILL.md` (already shipped via PR #287). SKILL + scripts/worktree-manager.sh. |

## Verification

To verify snapshot integrity against upstream at the locked SHA:

```bash
SHA=e5b397c9d1883354f03e338dd00f98be3da39f9f
# Portable SHA-256: prefer sha256sum (Linux), fall back to shasum -a 256 (macOS).
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 | cut -d' ' -f1; }
else
  echo "ERROR: neither sha256sum nor shasum is available" >&2
  exit 1
fi
for f in $(find . -type f -name '*.md' ! -name MANIFEST.md); do
  rel=${f#./}
  # $rel already matches the GitHub Contents API path (e.g.
  # `plugins/compound-engineering/agents/ce-adversarial-reviewer.agent.md`)
  # — do NOT strip the `plugins/compound-engineering/` prefix; the upstream
  # repo is a monorepo with the CE plugin at that path.
  remote=$(gh api "repos/EveryInc/compound-engineering-plugin/contents/${rel}?ref=$SHA" -H "Accept: application/vnd.github.raw" | sha256)
  local=$(sha256 < "$f")
  [ "$remote" = "$local" ] || echo "DRIFT: $rel"
done
```
