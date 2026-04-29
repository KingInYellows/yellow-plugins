# Upstream Snapshot Manifest

**Source repo:** `EveryInc/compound-engineering-plugin`
**Locked SHA:** `e5b397c9d1883354f03e338dd00f98be3da39f9f`
**Release tag at SHA:** `compound-engineering-v3.3.2` (released 2026-04-29)
**Fetched:** 2026-04-29
**Fetched by:** `/yellow-core:workflows:work` Phase 0 for `plans/everyinc-merge.md` backbone (Wave 1 + Wave 2 prep + keystone)
**Cap policy:** `>500 line` files in this snapshot tree are reference-only; we are not porting them whole. Two files exceed: `skills/ce-code-review/SKILL.md` (891) and `skills/ce-compound/SKILL.md` (546). For both, only specific sub-patterns are extracted.

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

## Wave 3 fetches not in this manifest

The following CE files inform Wave 3 tasks (W3.1, W3.2, W3.5, W3.10, W3.11, W3.12, W3.14, W3.15) and will be fetched into `RESEARCH/upstream-snapshots/<sha>/` during Wave 3's separate Phase 0 (committed in the first PR of `plans/everyinc-merge-wave3.md`):

- `skills/ce-debug/` (W3.1)
- `skills/ce-doc-review/SKILL.md` + `agents/ce-coherence-reviewer.agent.md`, `ce-design-lens-reviewer.agent.md`, `ce-feasibility-reviewer.agent.md`, `ce-product-lens-reviewer.agent.md`, `ce-scope-guardian-reviewer.agent.md`, `ce-adversarial-document-reviewer.agent.md` (W3.2)
- `agents/ce-cli-readiness-reviewer.agent.md`, `ce-cli-agent-readiness-reviewer.agent.md`, `ce-agent-native-reviewer.agent.md`, `skills/ce-agent-native-architecture/`, `skills/ce-agent-native-audit/` (W3.5)
- `skills/ce-compound-refresh/` (W3.10)
- `skills/ce-ideate/` (W3.11)
- `agents/ce-session-historian.agent.md` (W3.12)
- `skills/ce-optimize/` incl. `schema.yaml` and `README.md` (W3.14)
- `agents/ce-api-contract-reviewer.agent.md` (W3.15 — adapted to plugin-contract focus)
- `skills/ce-worktree/` (W3.4 reference)

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
  remote=$(gh api "repos/EveryInc/compound-engineering-plugin/contents/${rel#plugins/compound-engineering/}?ref=$SHA" -H "Accept: application/vnd.github.raw" | sha256)
  local=$(sha256 < "$f")
  [ "$remote" = "$local" ] || echo "DRIFT: $rel"
done
```
