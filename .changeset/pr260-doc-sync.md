---
'yellow-core': patch
'yellow-review': patch
---

# Documentation Sync

Doc sync against PR #260 review findings — refresh stale references and
add Subagent Failure Convention scope clarification.

`plugins/yellow-core/skills/security-fencing/SKILL.md`:

- **Refresh consumer count** from "25 agents" (stale) to **34** (current
  enumeration as of this commit). The 7 Wave-2 yellow-review personas
  (correctness-reviewer, maintainability-reviewer,
  project-compliance-reviewer, project-standards-reviewer,
  reliability-reviewer, adversarial-reviewer, plugin-contract-reviewer)
  added since the original count plus 3 yellow-core additions
  (security-lens, security-reviewer, performance-reviewer) — 10 net
  additions — minus 1 for the `code-reviewer.md` Wave-2 deprecation
  stub now excluded from the count, account for the **9-file delta**.
- **Add machine-verifiable count one-liner** (`rg -l 'CRITICAL SECURITY
  RULES' plugins/ --type md | grep -v 'security-fencing/SKILL.md' |
  grep -v 'CLAUDE.md' | wc -l`) so future drift is self-correcting.
  The hand-maintained list now carries per-directory counts that sum
  to the verifiable total. Flagged by comment-analyzer (P2).
- **Note `code-reviewer.md` deprecation stub** in the yellow-review/
  agents/review/ entry — the file is the Wave-2 rename stub and does
  not contain the canonical block, so it is excluded from the count
  by design. Pointer to `project-compliance-reviewer` migration.

`plugins/yellow-core/skills/create-agent-skills/SKILL.md`:

- **Add §Subagent Failure Convention "When the convention applies"
  scope clarification** (NEW subsection at top of the section). The
  convention is for prose-emitting orchestrators (`/workflows:work`
  Phase 3). Compact-return-JSON orchestrators (`/review:pr` Step 5)
  do not need it — structured returns already give the orchestrator
  a deterministic failure signal independent of TaskOutput. This
  closes the cross-reviewer-flagged gap on review-pr.md (4 reviewers
  on PR #260 flagged the missing convention; the gap is intentional
  architectural divergence and now has a documented scope rationale
  to prevent re-flagging in future reviews).

`plugins/yellow-review/commands/review/review-pr.md` Step 5:

- **Add architectural-choice comment block** at the top of Step 5
  explaining why this orchestrator uses TaskOutput-only collection.
  Forward-references the SKILL.md scope clarification. Makes the
  intentional design decision discoverable in the file that gets
  reviewed.

`plugins/yellow-core/skills/create-agent-skills/references/
quick-reference.md`:

- **Fix `yellow-browser-test` reference** at line 79. The original
  reference cited fields (`devServer.command`, `auth.credentials`)
  and env vars (`$BROWSER_TEST_EMAIL`, `$BROWSER_TEST_PASSWORD`)
  that don't exist in that plugin (it uses
  `.claude/browser-test-auth.json`, not the `.local.md` pattern).
  Replaced with a pointer to the `yellow-core:local-config` skill
  which documents the cross-plugin schema generically. Flagged by
  comment-analyzer (P2).

No code changes — all edits are markdown documentation.

`pnpm validate:plugins` and `pnpm test:integration` green. The
pre-existing `pnpm validate:agents` failure on session-historian.md
is out of scope (predates PR #260).
