# Feature: Fix setup-command bugs (research jq exit 4, stale shell-env claim, browser-test web detection)

## Problem Statement

Three defects in plugin setup commands:

1. `/research:setup` treats `jq -e` exit 4 (key absent) as a settings.json parse error.
2. `/research:setup` still says shell-env keys make the MCPs fail. Since 4.1.0 the `bin/start-*.sh` wrappers (via `bin/lib/resolve-mcp-key.sh`) fall back to shell env; `tests/resolve-mcp-key.bats:39` proves it.
3. `/browser-test:setup` Step 2.5 only greps `package.json`, so FastAPI, Rails, Go and Rust apps hit the "no web framework" prompt. `/setup:all` already detects them.

## Current State

- **Bug 1 is already fixed in source** (#949). All 9 `has_userconfig` copies (research 4, devin 2, semgrep 3) carry `1|4) ;;`, `tests/has-userconfig.bats:49` covers it, and the existing changesets (`research-`, `devin-`, `semgrep-setup-userconfig-detection.md`) describe it. The installed cache 4.2.1 predates the fix, so users see the bug until the next release. No code change.
- **Bug 2** stale claims:
  - `plugins/yellow-research/commands/research/setup.md:156` (`check_key` printf)
  - same file, `provider_detail` strings at ~321, ~412, ~506 plus the comment near ~318 (cause "(b)" says the MCP ignores shell env)
  - `plugins/yellow-research/skills/research-patterns/SKILL.md:117-120` and `145-147`
  - README and CLAUDE.md are already correct. No test or validator asserts the old strings.
- **Bug 3**: `plugins/yellow-browser-test/commands/browser-test/setup.md:47-62` and the error row at `:155`. The reference block is `plugins/yellow-core/commands/setup/all.md:256-323`.

## Proposed Solution

- Bug 1: verify only; no edit.
- Bug 2: make the shell-env-only status neutral, drop the false "cause (b)" from the three probe messages, and correct SKILL.md. When a userConfig key is also set, report the shell-key probe as `PRESENT (userConfig takes precedence …)` (Perplexity pending MCP visibility) because the MCP uses the userConfig key.
- Bug 3: copy the `web_signal_*` block from `setup:all` into Step 2.5, with `is_web` true when any signal matches. Use a strict copy so the two stay comparable.

Decisions (from SpecFlow review):

- **`repo_top` outside git:** keep Step 2.5's existing `|| echo "."` fallback and drop the `[ -n "$repo_top" ]` guards from the copy, so a non-git web project still detects.
- **Drift check:** keep-in-sync comment only. A validator is a follow-up, not in scope. `all.md` gets only a one-line reciprocal sync comment (with a yellow-core patch changeset).
- **Known false positives/negatives** (substring match on `pyproject.toml`, root-only files, compose filename variants) are inherited from `setup:all` and left as-is.

## Implementation Plan

### Phase 1: Verify bug 1

- [x] 1.1: Run `rg -c '1\|4\) ;;'` on the three setup.md files and confirm no `has_userconfig` copy lacks it.
- [x] 1.2: Run `bats plugins/yellow-research/tests/has-userconfig.bats` from `plugins/yellow-research`.

### Phase 2: Stale shell-env claim (yellow-research)

- [x] 2.1: `setup.md:156` — change the `elif [ $has_env -eq 1 ]` message to `set (shell env only — MCP reads it via the start-*.sh fallback)`.
- [x] 2.2: Rewrite the three `provider_detail` strings so a 401 on a shell-env key lists only real causes (expired/revoked key, wrong account); delete cause (b) and the "migrate to userConfig" instruction. Update the nearby comments.
<!-- deepen-plan: codebase -->
> **Codebase:** `resolve_mcp_key` makes userConfig win when both are set, but the curl probe runs whenever the shell var is non-empty (setup.md ~285). With both set, a 401 on the shell key says nothing about what the MCP uses. Word the 401 detail as "the shell key was rejected; if a userConfig key is also set, the MCP uses that instead", or gate it on `has_cfg` if it is in scope in those blocks.
<!-- /deepen-plan -->

<!-- deepen-plan: codebase -->
> **Codebase:** one more stale spot not listed above: `setup.md:757-759` ("Fallback for power users… Plugin.json no longer reads the shell *_API_KEY vars directly as of 2.0.0"). Fix it in 2.2 and keep it covered by the 2.4 grep. `SKILL.md:119-120` also says Perplexity hard-fails without a valid userConfig value; reword it to "userConfig or shell env". `setup.md:484-485` (Perplexity userConfig-only) stays accurate.
<!-- /deepen-plan -->

- [x] 2.3: `skills/research-patterns/SKILL.md` — rewrite "API Key Setup" (:117-120) and the power-user paragraph (:145-147) to match README/CLAUDE.md: userConfig first, shell env fallback.
- [x] 2.4: Run `rg -n 'MCP WILL FAIL|reads userConfig, not shell env|NOT shell env|no longer wired into|no longer reads' plugins docs --glob '!docs/solutions/**'` and expect no stale hits.

### Phase 3: browser-test web detection

- [x] 3.1: Replace the Step 2.5 block with the `setup:all` signals (node, rails, python, go, rust, PaaS, docker-compose HTTP port). Print the matched signals and set `is_web=true` when the count is above zero. Add a "keep in sync with yellow-core `commands/setup/all.md` Web App Signals" comment.
<!-- deepen-plan: codebase -->
> **Codebase:** keep `$repo_top/$f` in each test when dropping the `[ -n "$repo_top" ]` guards (the PaaS loop in all.md:303-309 uses it only inside the guard). `is_web` has no other consumer, and `app-discoverer` does its own detection from cwd, so the Step 2.5 gate was the only blocker for non-Node apps.
<!-- /deepen-plan -->

- [x] 3.2: Update the AskUserQuestion text to "No web-app signals found (checked: package.json, Gemfile, Python deps, go.mod, Cargo.toml, PaaS config)" and drop the "Django/Rails/Go won't be detected" caveat.
- [x] 3.3: Update the Error Handling row at `:155` to match.
- [x] 3.4: Fixture check in a scratch dir: FastAPI `requirements.txt`, Rails `Gemfile`, Go `go.mod`, and non-git cwd each give `is_web: true`; an empty dir gives `false`. Run under both bash and zsh.

### Phase 4: Quality

- [x] 4.1: `pnpm validate:agents`, `pnpm lint:plugins`, `pnpm validate:shell-compat`, `pnpm check:shell-parse`, `pnpm validate:schemas`.
- [x] 4.2: Add `.changeset/` files: `yellow-research` patch and `yellow-browser-test` patch. The browser-test text must say Django/FastAPI/Rails/Go/Rust projects no longer see the "no framework" prompt.
<!-- deepen-plan: codebase -->
> **Codebase:** README.md and CLAUDE.md of yellow-browser-test make no detection claims, so 4.3 is likely a no-op. The `:155` error row is the only other stale framing, and no code path triggers it anymore.
<!-- /deepen-plan -->

- [x] 4.3: Check `plugins/yellow-browser-test/CLAUDE.md` and `README.md` for statements about detection, and update them if present.

## Technical Details

- Modify: `plugins/yellow-research/commands/research/setup.md`, `plugins/yellow-research/skills/research-patterns/SKILL.md`, `plugins/yellow-browser-test/commands/browser-test/setup.md`.
- Create: three changesets (yellow-research, yellow-browser-test, yellow-core).
- Shell rules: no variable named `path` or `status`; use `>|` for overwrites; quote all expansions; no bash-only constructs.
- No catalog, manifest or count changes.

## Acceptance Criteria

- All 9 `has_userconfig` copies keep `1|4) ;;` and `has-userconfig.bats` passes.
- The Phase 2.4 grep returns nothing, and `/research:setup` prints no "WILL FAIL" for a shell-env-only key.
- `/browser-test:setup` Step 2.5 reports `is_web: true` for FastAPI, Rails, Go, Rust and PaaS-config repos, including outside a git repo.
- Validators in 4.1 pass; both changesets are present.

## Edge Cases

- `pyproject.toml` mentioning fastapi only as a dev dependency counts as web (inherited; low-harm direction).
- Monorepo roots with apps under `apps/*` stay a false negative; the prompt's "Continue anyway" remains the escape hatch.
<!-- deepen-plan: codebase -->
> **Codebase:** running setup from a subdirectory of a git repo (e.g. `apps/web/`) evaluates signals at the git toplevel, not cwd, while `app-discoverer` works from cwd. This also applies to `setup:all`. Accept it and note it as a known limitation.
<!-- /deepen-plan -->

- Users on cache 4.2.1 keep bug 1 until release; mention in the release notes.

## References

- `docs/solutions/code-quality/setup-classification-probe-coupling.md`
- `docs/solutions/code-quality/stale-env-var-docs-and-prose-count-drift.md`
- `docs/solutions/code-quality/bash-zsh-tiered-shell-contract.md`
- `plugins/yellow-research/bin/lib/resolve-mcp-key.sh`, `plugins/yellow-research/tests/resolve-mcp-key.bats`
- `plugins/yellow-core/commands/setup/all.md:256-323`
- Follow-up (out of scope): a validator that diffs the two `web_signal` blocks, like `ERROR-PROVIDER-006`.
