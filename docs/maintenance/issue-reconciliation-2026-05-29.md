# Issue Reconciliation — 2026-05-29

Read-only reconciliation of open GitHub issues against `main` @ `ac635c5f`
(plus the changes in branch `agent/fix/validator-frontmatter-and-readonly-contract`).
Produced during the validator/stability pass. **No GitHub state was mutated** —
the close/comment text below is proposed for a human to post.

Verdict legend: **resolved** (close), **resolved-by-this-PR** (close after this
PR merges), **partially-resolved** (close part / open a follow-up),
**still-open** (keep open).

| Issue | Title (abbrev.) | Verdict | Action |
| ----- | --------------- | ------- | ------ |
| #146 | debt: `git status --porcelain` for scope validation | resolved | close |
| #147 | validator: handle YAML flow sequences in `parseList` | resolved-by-this-PR | close after merge |
| #148 | validator: symlink-aware path containment | resolved | close |
| #149 | debt: backfill deferred todos + clear stale severity | partially-resolved | follow-up |
| #211 | yellow-research ast-grep needs `--python 3.13` | resolved | close |
| #267 | check-upstream-pins: harden CLI arg parsing | resolved | close |
| #268 | wire check-upstream-pins into scripts + CI advisory | resolved-by-this-PR | close after merge |
| #269 | morph start-morph.sh canonicalize + race comment | resolved | close |
| #270 | morph setup.md DATA_DIR guard + redact npm output | resolved | close |
| #271 | yellow-devin mark `devin_org_id` sensitive | resolved | close |
| #494 | plan-lifecycle P0/P1 design issues (PR #484) | partially-resolved | close as reduced-scope |
| #496 | plan-lifecycle YAGNI scope reductions (PR #484) | resolved | close |

All issue claims below were verified first-hand against the code at `ac635c5f`.

---

## #146 — debt scope uses `git status --porcelain` — **resolved**

`plugins/yellow-debt/commands/debt/fix.md:69,188` and
`plugins/yellow-debt/agents/remediation/debt-fixer.md:58,109` use
`git status --porcelain | cut -c4-`, which includes untracked files that
`git diff --name-only` would miss.

> Resolved at `ac635c5f`. Both `debt-fixer.md` (lines 58, 109) and `fix.md`
> (lines 69, 188) now enumerate files via `git status --porcelain | cut -c4-`,
> correctly including untracked new files. Closing.

## #147 — `parseList` YAML flow sequences — **resolved-by-this-PR**

The pre-existing hand-rolled `parseList` mishandled empty flow lists (`[]`),
quoted items, and (per the broader audit) inline comments. This PR replaces
`parseScalar`/`parseList` in `scripts/validate-agent-authoring.js` with a real
`yaml.parse`-backed parser that handles block lists, flow lists (incl. empty and
quoted), comma-strings, and inline comments uniformly.

> Addressed in PR (validator frontmatter hardening, `ac635c5f`+). `parseScalar`
> and `parseList` are now backed by the `yaml` parser, so empty flow lists
> (`tools: []`), quoted flow items, and inline comments are parsed correctly
> instead of via brittle regex. Closing once that PR merges.

## #148 — symlink-aware path containment — **resolved**

`scripts/lib/plugin-paths.js` rejects symlinks via `fs.lstatSync()` +
`isSymbolicLink()` in `validatePathFile` (139-146), `validateSinglePath`
(182-188), `validateHookScriptPath` (324-330), and skips them in
`countMarkdownRecursive` (101). Delivered with the validation-layer hardening
(PR #555 / earlier PR #343).

> Resolved. `scripts/lib/plugin-paths.js` uses `fs.lstatSync()` throughout and
> rejects symlinks with a hard error before following them — stronger than the
> proposed `realpathSync()` approach (lstat+reject blocks symlinks
> unconditionally rather than allowing those that resolve inside the root).
> Closing.

## #149 — debt todo backfill + stale severity — **partially-resolved**

Finding 2 (stale severity filter) is fixed: `commands/debt/audit.md:129-133`
unconditionally `rm -f .debt/severity-filter.txt` and only recreates it when
`--severity` is passed. Finding 1 (general frontmatter backfill for pre-schema
todos) is **not** addressed — `lib/validate.sh:128` only removes the legacy
`defer_reason` field; there is no helper that injects missing required fields.

**Recommended:** keep open, retitle to scope only the backfill helper. Out of
scope for this validator pass (yellow-debt plugin change → separate PR +
changeset).

> Finding 2 (stale severity filter) is resolved — `audit.md` clears
> `.debt/severity-filter.txt` at audit start and only recreates it under
> `--severity`. Finding 1 (backfill of missing required frontmatter fields in
> pre-existing todos) remains open; `validate.sh` only deletes the deprecated
> `defer_reason` field. Keeping open for a focused backfill-helper follow-up.

## #211 — ast-grep `--python 3.13` — **resolved**

`plugins/yellow-research/.claude-plugin/plugin.json:79-85` invokes
`uvx --python 3.13 --from git+…ast-grep-mcp@674272f… ast-grep-server`. Shipped
in commit `b4411645` (PR #219), v3.2.0.

> Fixed at `ac635c5f`. The ast-grep MCP server config passes `--python 3.13` to
> `uvx`, so it resolves a uv-managed Python 3.13 rather than system Python
> (commit `b4411645`, PR #219). Closing. (Cross-environment runtime
> verification on a Python-3.12 host is a separate, lower-priority check.)

## #267 — check-upstream-pins CLI hardening — **resolved**

`scripts/check-upstream-pins.js`: `--threshold` validates the next token is
present and numeric, exiting with a clear message (52-68); `getNpmLatest`
surfaces `e.stderr || e.message` under `--verbose` (132-150); `NPM_NAME_OK` has
no `/i` flag (38, with rationale comment); header documents the weighted score
formula (13-20).

> All four findings resolved at `ac635c5f`: (1) `--threshold` NaN guard; (2)
> `--verbose` surfaces the npm error text; (3) `NPM_NAME_OK` is case-sensitive
> (no `/i`); (4) the header comment documents the weighted drift formula.
> Closing.

## #268 — wire check-upstream-pins into scripts + CI advisory — **resolved-by-this-PR**

Was genuinely unwired (no `check:pins` script, no workflow reference; the
`docs/upstream-pins.md` "checked automatically" claim was inaccurate). This PR
adds `"check:pins": "node scripts/check-upstream-pins.js"` to `package.json`, a
weekly+manual advisory workflow `.github/workflows/upstream-pins-advisory.yml`
(`continue-on-error`, not in `ci-status`), and corrects the docs claim.

> Addressed in PR (`ac635c5f`+): added `pnpm check:pins`, a non-blocking weekly
> advisory workflow (`upstream-pins-advisory.yml`, also manual-dispatchable),
> and corrected `docs/upstream-pins.md`. Deliberately kept out of the blocking
> `validate:schemas`/`ci-status` gate (per-pin `npm view` network calls).
> Closing once merged.

## #269 — morph start-morph.sh canonicalize + race comment — **resolved**

The fix landed in the shared lib, not in `start-morph.sh` directly:
`plugins/yellow-morph/lib/install-morphmcp.sh:28-45` canonicalizes
`CLAUDE_PLUGIN_ROOT`/`DATA` via `realpath -m` (capability-gated for BSD macOS)
*before* the prefix-guard in `yellow_morph_validate_paths()`, which
`start-morph.sh:37` calls. `CHANGELOG.md:27` credits "#269". The race comment
was rewritten — `start-morph.sh:4-11` now describes the symmetric concurrent
`npm ci` serialization ("concurrent `npm ci` cannot corrupt node_modules"); the
old ordered "MCP starts before hook completes" wording is gone.

> Resolved at `ac635c5f`. Path canonicalization (Finding 1) lives in
> `lib/install-morphmcp.sh` (`yellow_morph_validate_paths`, lines 28-45,
> credited to #269 in CHANGELOG), which `start-morph.sh` invokes — the right
> home since the prewarm hook and `/morph:setup` also source it. The race
> comment (Finding 2) was rewritten to the symmetric concurrent-`npm ci` framing
> (`start-morph.sh:4-11`). Closing.

## #270 — morph setup.md DATA_DIR guard + redact npm output — **resolved**

`commands/morph/setup.md:94` uses `${CLAUDE_PLUGIN_DATA:?…}` (strict, matching
`start-morph.sh`); `setup.md:122` runs `yellow_morph_do_install >&2` to keep npm
chatter out of the conversation log.

> Resolved at `ac635c5f`. `setup.md` uses the strict `${CLAUDE_PLUGIN_DATA:?…}`
> guard (line 94) and redirects install output with `yellow_morph_do_install
> >&2` (line 122). Closing.

## #271 — yellow-devin `devin_org_id` sensitive — **resolved**

`plugins/yellow-devin/.claude-plugin/plugin.json:31` sets `"sensitive": true`
on `devin_org_id` (alongside `devin_service_user_token`).

> Resolved at `ac635c5f`. `devin_org_id` is marked `"sensitive": true`, so it is
> keychain-stored and redacted from transcripts. Closing.

## #494 — plan-lifecycle P0/P1 design issues — **partially-resolved (close as reduced-scope)**

The core deliverables shipped: `validate:plans` diff-scoped stray-checkbox gate
(PR #556) and `/plan:status` + `/plan:complete` (PR #557). The original P0/P1
findings targeted a larger design (3-check Gate C, UNCERTAIN audit trail,
frontmatter convention, backfill script) that was deliberately simplified away
by the #496 YAGNI reductions, making those specific findings moot. A
resolution-map comment was already posted (per prior session).

**Recommended:** close as resolved-within-reduced-scope, referencing #496.

> Core deliverables merged (PR #556 `validate:plans`; PR #557 `/plan:status` +
> `/plan:complete`). The P0/P1 findings tied to the original complex design
> (Gate C verdict logic, UNCERTAIN audit trail, fence-delimiter scrub,
> `mergedAt` filter, frontmatter/backfill) were eliminated by the #496 YAGNI
> reductions rather than implemented — the simplified Gate C is a direct `gh`
> lookup. Closing as resolved within the agreed reduced scope; see #496.

## #496 — plan-lifecycle YAGNI scope reductions — **resolved**

All YAGNI proposals were adopted: slug derived from filename (no frontmatter
convention), no backfill script, no `plan-frontmatter.js` library, `validate:plans`
is a separate CI matrix step (not folded into `validate:schemas`), 2-PR stack
instead of 5. The brainstorm was annotated as superseded.

> All YAGNI proposals adopted in PRs #556/#557: filename-derived slugs, no
> frontmatter convention, no backfill script, no dedicated library,
> `validate:plans` wired as its own CI step. The over-engineered infrastructure
> was never built. Closing.

---

## Summary

- **Close now (8):** #146, #148, #211, #267, #269, #270, #271, #496.
- **Close after this PR merges (2):** #147, #268.
- **Close as reduced-scope (1):** #494 (reference #496).
- **Keep open / follow-up (1):** #149 (yellow-debt frontmatter backfill helper).

Two reconciliation findings corrected the discovery subagents (which read only
`start-morph.sh`): **#269 is resolved**, not open — its fix lives in the shared
`lib/install-morphmcp.sh` and is CHANGELOG-credited to #269.
