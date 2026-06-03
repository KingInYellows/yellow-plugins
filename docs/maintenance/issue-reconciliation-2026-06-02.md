# Issue reconciliation — 2026-06-02

Read-only reconciliation of the issues named in the runtime-acceptance pass
against landed work. **No GitHub state was mutated.** Proposed close/comment
text is provided for a human to apply.

Verified via `gh issue view <n>` (read) + `git log` correlation on HEAD
`db9c2d8f` (PR #562). Complements the prior pass in
`issue-reconciliation-2026-05-29.md`.

## Summary

- **10 CONFIRMED-CLOSED** — already closed (`stateReason=COMPLETED`), code verified present.
- **1 STALE-SHOULD-CLOSE** — `#494`, fully addressed by merged PRs; open only pending a human close.
- **1 KEEP-OPEN** — `#149`, partially resolved; one half of the original scope remains unimplemented.

## Table

| Issue | Title (short) | State | Resolved by | Classification |
|---|---|---|---|---|
| #146 | debt: `git status --porcelain` scope | CLOSED | #555 + batch reconciliation (2026-05-29) | CONFIRMED-CLOSED |
| #147 | validator: YAML flow seqs in parseList | CLOSED | #562 (yaml-backed parser) | CONFIRMED-CLOSED |
| #148 | validator: symlink-aware containment | CLOSED | #555 (`lstatSync` reject) | CONFIRMED-CLOSED |
| #149 | debt: backfill todos + clear stale severity | **OPEN** | severity half done; backfill half NOT | **KEEP-OPEN** |
| #211 | yellow-research: ast-grep `--python 3.13` | CLOSED | #219 (`--python 3.13` in plugin.json) | CONFIRMED-CLOSED |
| #267 | check-upstream-pins: harden CLI args | CLOSED | #555 | CONFIRMED-CLOSED |
| #268 | wire check-upstream-pins into scripts + CI | CLOSED | #562 (`check:pins` + advisory workflow) | CONFIRMED-CLOSED |
| #269 | morph: canonicalize paths + race comment | CLOSED | #555 | CONFIRMED-CLOSED |
| #270 | morph setup.md: DATA_DIR guard + npm output | CLOSED | #555 | CONFIRMED-CLOSED |
| #271 | yellow-devin: `devin_org_id` sensitive | CLOSED | #555 | CONFIRMED-CLOSED |
| #494 | plan-lifecycle P0/P1 design issues | **OPEN** | #556 + #557 + #496 (YAGNI) | **STALE-SHOULD-CLOSE** |
| #496 | plan-lifecycle YAGNI scope reductions | CLOSED | #556 + #557 | CONFIRMED-CLOSED |

## #211 — ast-grep `--python 3.13` (CONFIRMED-CLOSED)

The runtime-acceptance pass re-verified this is fully shipped and not a valid
open item:
`plugins/yellow-research/.claude-plugin/plugin.json` invokes
`uvx --python 3.13 --from git+…@674272f… ast-grep-server`;
`CLAUDE.md` documents that `uv` manages Python 3.13 independent of system
Python; `scripts/install-ast-grep.sh` pre-warms `uv python install 3.13`. No
host-dependent verification risk remains. **No action.**

## Items needing a human action (no mutation performed)

### #494 — STALE-SHOULD-CLOSE → close as completed

The core deliverables merged and a resolution-map comment is already posted on
the issue. Proposed closing comment:

> Core deliverables merged: PR #556 ships `validate:plans` (the PR-diff-scoped
> stray-checkbox CI gate); PR #557 ships `/plan:status` and `/plan:complete`.
> The P0/P1 findings that targeted the larger design (Gate C 3-check agent,
> UNCERTAIN audit trail, fence-delimiter scrub, `mergedAt` filter, frontmatter/
> backfill infrastructure) were eliminated by the #496 YAGNI reductions — the
> simplified Gate C is a direct `gh pr list` lookup. Every surviving acceptance
> criterion is met. Closing as resolved within the agreed reduced scope; see
> #496 for the decision record.

### #149 — KEEP-OPEN → retitle to the remaining half

Finding 2 (stale `.debt/severity-filter.txt`) **is** resolved —
`commands/debt/audit.md` unconditionally clears the file at audit start. Finding
1 (a backfill helper that injects missing required frontmatter fields into
pre-schema todos) is **not**: `lib/validate.sh` only removes the deprecated
`defer_reason` field. Proposed comment + retitle:

> Finding 2 (stale `severity-filter.txt`) was resolved in a prior PR — `audit.md`
> now clears the file at audit start. Finding 1 (backfill helper for pre-schema
> todos missing required frontmatter fields) remains open; `validate.sh` only
> deletes the deprecated `defer_reason` field. Retitling to scope this issue to
> the remaining work.

Suggested title:
`fix(debt): backfill helper for missing required frontmatter fields in pre-schema todos`

## Cross-check note (not an issue)

`check:pins` previously did not scan `plugins/*/bin/*.sh`, so yellow-research's
three wrapper-launched npm pins were invisible to drift reporting. This pass
extends the scanner to cover `bin/*.sh`; it now surfaces drift on
`@perplexity-ai/mcp-server`, `tavily-mcp`, and `exa-mcp-server`. Those bumps are
advisory (verify the MCP `tools/list` surface before pinning) and are tracked by
the weekly `upstream-pins-advisory.yml` workflow, not by an issue.
