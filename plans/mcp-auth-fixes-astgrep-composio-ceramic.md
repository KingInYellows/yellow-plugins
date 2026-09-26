# Feature: MCP auth fixes — ast-grep crash, Composio OAuth on WSL2, Ceramic OAuth-only

## Problem Statement

Three independent MCP problems surfaced during `/setup:all` on a WSL2 host
(Claude Code 2.1.283, WSL NAT networking, `BROWSER=wslview`):

1. **ast-grep MCP crashes at startup.** yellow-research pins
   `ast-grep-mcp@674272f1`, which imports `mcp.server.fastmcp`. Its unbounded
   `mcp[cli]>=1.6.0` dependency now resolves `mcp` 2.x, which removed that
   module → `ModuleNotFoundError`, so Claude Code caches a failed connection and
   `/research:code` / `/research:deep` lose AST search.
2. **Composio OAuth stalls on WSL2.** `plugin:yellow-composio:composio-server`
   shows `! Needs authentication`; the browser flow opens on Windows but never
   calls back. `/composio:setup` offers no WSL path other than a plaintext
   consumer-key fallback.
3. **Ceramic still carries an API key.** The Ceramic MCP is OAuth 2.1 (already
   `✔ Connected` here), but `CERAMIC_API_KEY` survives as a REST live-probe in
   `/research:setup`, a `cer_sk` format check, a `/setup:all` dashboard row, and
   docs — confusing users into thinking a key is required.

## Current State (verified this session)

- **ast-grep:** `catalog/plugins/yellow-research.json:82-90` is the only source.
  Upstream fixed the break (ast-grep/ast-grep-mcp#38, commit `fbae348c`,
  "migrate server to MCP 2"; later commits pin deps). HEAD
  `149e20d47bb7125fb0c1451feea2f48a98742034` starts under
  `uvx --python 3.13 --from git+…@<sha> ast-grep-server` and its `tools/list`
  is **byte-identical** (names, params, required) to the old pin run with
  `--with 'mcp<2'`: `find_code`, `find_code_by_rule`, `dump_syntax_tree`,
  `test_match_code_rule`. No other plugin uses `uvx`.
- **Composio:** `claude mcp list` → `plugin:yellow-composio:composio-server …
  ! Needs authentication`. On the same host `plugin:yellow-linear:linear`,
  `plugin:yellow-research:parallel` and `plugin:yellow-research:ceramic` are
  `✔ Connected` — so the WSL localhost callback is not universally broken;
  the Composio flow specifically does not complete. `claude mcp login <name>
  --no-browser` exists in 2.1.283 (prints the authorize URL; user pastes the
  full redirect URL back — no inbound loopback needed). It requires a TTY
  (anthropics/claude-code#90906), so it cannot run through the Bash tool.
  The claude.ai Composio connector (`mcp__claude_ai_composio__*`) is healthy
  and is what `/composio:setup` currently reports on.
- **Ceramic:** `CERAMIC_API_KEY` is live in `research/setup.md` (Step 1 row
  ~147-153, Step 2 `cer_sk` check ~205-221, Step 3 REST probe ~679-720,
  redaction sed ~538, report row ~687/706-710, Step 5 export ~761-763),
  `setup/all.md` (~119 env row, ~534-540 classification note), yellow-research
  `README.md` ~54-60, `CLAUDE.md` ~69-73/178-179, `skills/research-patterns/
  SKILL.md` ~145-152, `yellow-core/skills/multi-host-fleet/SKILL.md` ~58/191,
  and `tests/integration/ceramic.test.ts` (whole file gated on
  `RUN_LIVE=1 && CERAMIC_API_KEY`).

## Proposed Solution

Three disjoint branches, stacked via the enabled provider (Graphite):

- **A — bump the ast-grep-mcp SHA** to upstream HEAD instead of adding
  `--with 'mcp<2'` (keeps us on the maintained MCP 2 code path; the cap would
  freeze us on removed APIs).
- **B — WSL-aware OFFLINE remediation for Composio**, docs/setup-flow only
  (no manifest change). The guidance only appears inside the existing
  OFFLINE branch, so users whose tools already work never see it.
- **C — remove `CERAMIC_API_KEY` as a configured credential**; Ceramic
  health stays ToolSearch-only ("OAuth state not verified").

<!-- deepen-plan: codebase -->
> **Codebase:** PR #845 (`dabe4954`) is what moved yellow-composio *to* bundled
> browser OAuth: it removed the stdio proxy, the consumer-key `userConfig` and the
> SessionStart hook ("a proxy that injects a key never starts OAuth"). Its test
> plan says "No live OAuth login" — the bundled OAuth path was never exercised
> end-to-end. Branch B must not reintroduce the proxy/`userConfig`; the
> consumer-key path stays a user-level `claude mcp add` only.
<!-- /deepen-plan -->
Decisions made (change if you disagree):
- `CERAMIC_API_KEY` **stays** in the defensive never-commit / redaction lists
  (`AGENTS.md`, `yellow-linear/skills/linear-workflows/SKILL.md:253`) —
  costs nothing and still catches a stray key. A leftover exported value is
  silently ignored; the changeset notes it is no longer read.
- WSL guidance for Linear/Parallel/Ceramic is **out of scope** (they connect
  on this host). Generic headless-Linux/SSH guidance is a follow-up.
- CHANGELOGs, `plans/complete/`, `docs/brainstorms/`, `RESEARCH/` are
  historical and stay untouched.

<!-- deepen-plan: external -->
> **Research:** Upstream `ast-grep-mcp` at `149e20d4` pins `mcp[cli]==2.1.0`
> exactly (`pyproject.toml`, `requires-python >=3.13`), so the SHA bump also
> freezes the transitive dependency that broke — no `--with`/`--exclude-newer`
> needed. `uvx --exclude-newer` only filters registry packages (git SHA exempt);
> it would be the right tool only if upstream stopped pinning.
> See: https://docs.astral.sh/uv/concepts/resolution/
<!-- /deepen-plan -->
## Implementation Plan

### Phase 1 (branch A): ast-grep-mcp SHA bump — yellow-research patch

- [x] 1.1: In `catalog/plugins/yellow-research.json`, replace `674272f1adb56fd1fe48a546952c7ffbe72c09e6`
      with the verified SHA (re-check upstream HEAD at implementation time;
      if newer, re-run the `tools/list` diff below before using it).

<!-- deepen-plan: codebase -->
> **Codebase:** CONFIRMED — `catalog/plugins/yellow-research.json:81` opens
> `"ast-grep"`, the SHA is on line 87; `uvx` is used by no other catalog plugin.
<!-- /deepen-plan -->- [x] 1.2: `pnpm generate:manifests`; confirm the only diff in
      `plugins/yellow-research/.claude-plugin/plugin.json` is the SHA.
- [x] 1.3: `pnpm vitest run tests/integration/generate-manifests-characterization.test.ts -u`;
      hand-diff the `.snap` — only SHA lines may change.
- [x] 1.4: Update the ast-grep-mcp row in `docs/upstream-pins.md` (short SHA,
      date, "tools/list verified identical; migrated to MCP 2 upstream (#38)").
- [x] 1.5: `pnpm changeset` — yellow-research **patch**; note users must
      restart Claude Code (the failed connection is cached for ~15 min).

<!-- deepen-plan: codebase -->
> **Codebase:** CORRECTED — `docs/upstream-pins.md` Bump Checklist (~84-101)
> step 4 says pin bumps are **minor** for behavior-preserving bumps. Use
> `"yellow-research": minor`. Its step 5 (manual CHANGELOG edit) is stale —
> CHANGELOGs here are changesets-generated; don't hand-edit, mention in the PR.
<!-- /deepen-plan -->- [x] 1.6: Verify on a **cold** uv cache:
      `UV_CACHE_DIR=$(mktemp -d) uvx --python 3.13 --from git+…@<sha> ast-grep-server`
      answers `initialize` + `tools/list`; then after reinstalling the plugin
      locally, ToolSearch finds `mcp__plugin_yellow-research_ast-grep__find_code`
      and a `find_code` call on this repo returns structured output.
      _Done 2026-09-26: cold-cache start + `tools/list` + a stdio `find_code` call
      on `scripts/` all pass; the in-session ToolSearch check needs a restart
      after the release reaches the plugin cache._

### Phase 2 (branch B): Composio WSL remediation — yellow-composio + yellow-core patch

- [ ] 2.1: Diagnose before writing docs: in a separate interactive WSL
      terminal run `claude mcp login plugin:yellow-composio:composio-server --no-browser`,
      complete the login, paste the redirect URL, confirm `claude mcp list` shows
      `✔ Connected`. Record whether it succeeded; if the redirect URL paste fails
      too, the root cause is on Composio's side (cf. ComposioHQ/composio#3485) —
      stop and re-plan B around the consumer-key fallback only.

<!-- deepen-plan: external -->
> **Research:** `claude mcp login` (added 2.1.186) needs a TTY — without one it
> aborts with "stdin isn't a terminal" (anthropics/claude-code#90906). The same
> issue reports each attempt revokes the stored credential first, so a failed
> retry can cost a working token (harmless here: Composio has none yet). No
> source confirms `plugin:<plugin>:<server>` names are accepted — 2.1 is the
> verification. Composio's OAuth is multi-step (Composio login → org select →
> consent) before the localhost redirect; WSL2 random-port callbacks hitting
> `ERR_CONNECTION_REFUSED` under broken localhost forwarding is a known Claude
> Code issue (#35740; configurable callback host requested in #69326).
> See: https://github.com/anthropics/claude-code/issues/90906,
> https://github.com/anthropics/claude-code/issues/35740,
> https://docs.composio.dev/kb/guide/consumer-project-boundaries-and-auth-selection
<!-- /deepen-plan -->- [ ] 2.2: `plugins/yellow-composio/commands/composio/setup.md` Step 2
      OFFLINE branch: add a small WSL probe (`/proc/sys/fs/binfmt_misc/WSLInterop`
      or `uname -r` ∋ `microsoft`; `wslinfo --networking-mode` when present) and,
      only when OFFLINE, print remediation in order:
      (1) run `claude mcp login plugin:yellow-composio:composio-server --no-browser`
      in a separate terminal (needs a TTY), then re-run `/composio:setup`;
      (2) if on NAT, `networkingMode=mirrored` in `%UserProfile%\.wslconfig`
      + `wsl --shutdown`; (3) the existing consumer-key fallback (unchanged).
      Outside WSL, show (1) as the headless/SSH hint and keep (3).
      Keep each bash block self-contained (fresh subshell per block).

<!-- deepen-plan: codebase -->
> **Codebase:** CONFIRMED — OFFLINE text + consumer-key fallback live at
> `composio/setup.md:58-86` ("Stop here if no tools found." is line 86); the
> subshell rule is `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`
> (already cited at `research/setup.md:526-531`).
<!-- /deepen-plan -->
<!-- deepen-plan: external -->
> **Research:** Detect WSL2 vs WSL1 with `uname -r` (`*microsoft-standard*` →
> WSL2; `*-Microsoft` → WSL1). `WSL_DISTRO_NAME` / `WSLInterop` only prove "WSL",
> not the version (newer builds also add `WSLInterop-late`). Networking mode:
> `command -v wslinfo && wslinfo --networking-mode` (`nat` | `mirrored` |
> `virtioproxy` | `none`); when `wslinfo` is absent report "unknown", not "nat".
> See: https://learn.microsoft.com/en-us/windows/wsl/networking
<!-- /deepen-plan -->- [ ] 2.3: Step 3/6: when the only visible prefix is `mcp__claude_ai_composio__*`,
      report HEALTHY with a note that the bundled server is unauthenticated and
      how to authenticate it — today this state is reported as plain HEALTHY.

<!-- deepen-plan: codebase -->
> **Codebase:** CONFIRMED — Step 6 report line `composio/setup.md:219` prints
> `MCP Health: [HEALTHY|DEGRADED|OFFLINE]` with no prefix distinction.
<!-- /deepen-plan -->- [ ] 2.4: `commands/composio/status.md` (~142) OFFLINE detail → point at
      `--no-browser` login.

<!-- deepen-plan: codebase -->
> **Codebase:** CONFIRMED — `status.md:141-143`; `/composio:status` Step 4
> (~130-144) decides OFFLINE via `ToolSearch("COMPOSIO_REMOTE_WORKBENCH")`.
<!-- /deepen-plan -->- [ ] 2.5: Mirror briefly in `plugins/yellow-composio/{README.md,CLAUDE.md}`
      and `skills/composio-patterns/SKILL.md` (~34, 49, 287-290).

<!-- deepen-plan: codebase -->
> **Codebase:** CORRECTED — in `composio-patterns/SKILL.md` line 49 is an
> unrelated `COMPOSIO_MANAGE_CONNECTIONS` table row; target lines ~34 and
> 287-290 only. yellow-composio has no `tests/` dir and no bats test asserts
> its OFFLINE text.
<!-- /deepen-plan -->- [ ] 2.6: `plugins/yellow-core/commands/setup/all.md` yellow-composio block
      (~616-641, inside the `setup-all-classification` markers): replace the
      "Authenticate in /mcp" NEEDS SETUP detail with the `--no-browser` command
      — net ≤ +3 lines (file is already over the RULE 21 ceiling).

<!-- deepen-plan: codebase -->
> **Codebase:** CONFIRMED — `setup-all-classification` markers at
> `setup/all.md:407` / `:676`. `scripts/validate-setup-all.js` checks structure,
> not strings (no `composio`/`CERAMIC` literals), but every `mcp__plugin_*` name
> inside the markers must still appear in the Step 1.5 probe list — don't add a
> new plugin tool name in the composio block.
<!-- /deepen-plan -->- [ ] 2.7: `pnpm changeset` — yellow-composio **patch**, yellow-core **patch**.

### Phase 3 (branch C): Ceramic OAuth-only — yellow-research minor, yellow-core patch

- [ ] 3.1: `research/setup.md`: delete the Step 1 `CERAMIC_API_KEY` row, the
      Step 2 `cer_sk` block, the Step 3 Ceramic REST-probe block, the
      `cer_sk` term in the redaction `sed`, the "Ceramic REST" report-table row
      and footnote, and the Step 5 `export CERAMIC_API_KEY` line. Ceramic stays
      in Step 3.5 as `ACTIVE (ToolSearch only — OAuth state not verified)`;
      Step 5 Ceramic hint becomes "authenticate via `/mcp` or
      `claude mcp login plugin:yellow-research:ceramic`".

<!-- deepen-plan: codebase -->
> **Codebase:** CORRECTED line map for `research/setup.md`: Step 1 row 147-152;
> `cer_sk` check 207-218; **REST-probe code 480-524** (not ~679-720); redaction
> `sed` 538; report-table row 682 + note 706-710; Step 5 export 762.
<!-- /deepen-plan -->- [ ] 3.2: `yellow-core/commands/setup/all.md`: remove the `CERAMIC_API_KEY`
      dashboard row (~119) and trim the classification note (~534-540) to
      "Ceramic counts when `ceramic_search` is visible (OAuth)".
- [ ] 3.3: yellow-research `README.md`, `CLAUDE.md`, `skills/research-patterns/SKILL.md`:
      drop the "one remaining shell-env key" wording; Exa/Tavily/Perplexity are
      the only keys.
- [ ] 3.4: `yellow-core/skills/multi-host-fleet/SKILL.md`: remove the
      yellow-research/`CERAMIC_API_KEY` env-contract row (~58) and export line (~191).
- [ ] 3.5: Delete `tests/integration/ceramic.test.ts`.

<!-- deepen-plan: codebase -->
> **Codebase:** CONFIRMED safe — only picked up by the generic
> `vitest run --dir tests/integration`; no workflow in `.github/workflows/`
> sets `CERAMIC_API_KEY` or `RUN_LIVE`.
<!-- /deepen-plan -->- [ ] 3.6: `rg -n 'CERAMIC_API_KEY|cer_sk|api\.ceramic\.ai'` excluding CHANGELOGs,
      `plans/complete/`, `docs/brainstorms/`, `RESEARCH/` → only the two kept
      redaction/never-commit entries remain.
- [ ] 3.7: `pnpm changeset` — yellow-research **minor** (removes a documented
      setup input), yellow-core **patch**.

### Phase 4: Quality gates (each branch)

- [ ] 4.1: `pnpm validate:schemas && pnpm test:unit && pnpm test:integration && pnpm lint && pnpm typecheck`
- [ ] 4.2: A: `pnpm validate:generated`, `pnpm validate:versions`.
      B & C: `pnpm validate:agents`, `pnpm lint:plugins`, `pnpm validate:setup-all`.

<!-- deepen-plan: codebase -->
> **Codebase:** CONFIRMED all exist in `package.json`: `validate:generated`
> (`generate-manifests.js --check`), `validate:setup-all`, `lint:plugins`
> (`scripts/lint-plugins.sh`), `validate:agents`.
<!-- /deepen-plan -->- [ ] 4.3: Submit as a 3-branch stack (A → B → C, independent) via `/smart-submit`
      / `gt`; B and C both touch `setup/all.md` in different blocks — restack
      after A/B merge.

<!-- deepen-plan: codebase -->
> **Codebase:** `.graphite.yml` sets `branch.prefix: "agent/"` and
> `submit.restack_before: true`; `CONTRIBUTING.md:47-51` still documents
> `feat/`/`fix/` names — follow the tooling (`agent/`).
<!-- /deepen-plan -->
## Technical Details

- Files modified: see phases; no new runtime files. No schema change needed —
  `mcpServers` is pass-through in `schemas/catalog-plugin.schema.json`.
- New dependency surface: none (A changes only a git SHA).
- Command files are over the 500-line RULE 21 ceiling; C is net-negative,
  B must stay near-neutral.

## Acceptance Criteria

1. Fresh install of yellow-research: `claude mcp list` shows
   `plugin:yellow-research:ast-grep … ✔ Connected` after restart, on an empty
   uv cache; `/research:setup` reports ast-grep ACTIVE via a real `find_code` call.
2. If the bumped SHA fails 1.6, the branch is not merged; fallback is the old
   SHA + `"--with", "mcp<2"` (already verified to start), documented in
   `docs/upstream-pins.md`.
3. On WSL2 with the bundled Composio server unauthenticated, `/composio:setup`
   prints the exact `claude mcp login plugin:yellow-composio:composio-server
   --no-browser` command; following it yields `✔ Connected` (verified by 2.1).
4. With Composio tools already visible (any prefix), no WSL guidance is printed.
5. `/research:setup` and `/setup:all` never mention `CERAMIC_API_KEY`;
   Ceramic availability is decided solely by `ceramic_search` visibility; an
   exported `CERAMIC_API_KEY` has no effect.
6. All validators in Phase 4 pass; each branch carries its changeset.

## Edge Cases

- User already added a user-level `composio-server` (header key): Claude Code
  prefers it; setup keeps the existing "remove it once OAuth works" advice.
- WSL1 / mirrored networking: step (2) is skipped when `wslinfo` reports
  mirrored or the probe shows WSL1; step (1) still applies.
- `claude mcp login` run via `!` or the Bash tool fails (no TTY) — docs must say
  "separate terminal".
- Claude Desktop app WSL sessions don't support connectors at all — out of scope.
- ast-grep binary missing: unchanged (Step 0 install flow); the MCP server
  starts without it and fails at call time.

<!-- deepen-plan: external -->
> **Research:** Other edge cases:
> - `claude mcp login` can misdetect the TTY in some real terminals (#82894,
>   Windows Terminal + PowerShell) — tell users to run it from the WSL shell
>   itself.
> - Composio `ck_` consumer keys regenerated in the dashboard can return 401
>   (ComposioHQ/composio#3485), so the header fallback has its own failure mode.
>   Keep the "remove the user-level server once OAuth works" advice.
> See: https://github.com/ComposioHQ/composio/issues/3485
<!-- /deepen-plan -->
## References

- `catalog/plugins/yellow-research.json:82-90`, `docs/upstream-pins.md:36`
- `tests/integration/__snapshots__/generate-manifests-characterization.test.ts.snap`
- `plugins/yellow-composio/commands/composio/setup.md:37-84`, `status.md:142`
- `plugins/yellow-core/commands/setup/all.md:119, 534-540, 616-641`
- `plugins/yellow-research/commands/research/setup.md` (Steps 1-5)
- `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`
- `docs/solutions/build-errors/userconfig-required-fires-at-startup-not-install.md`
- ast-grep/ast-grep-mcp#38; anthropics/claude-code#64986, #90906, #64587;
  ComposioHQ/composio#3485; https://code.claude.com/docs/en/mcp

<!-- deepen-plan: external -->
> **Research:** Additional sources:
> - https://github.com/ast-grep/ast-grep-mcp/issues/38
> - https://docs.astral.sh/uv/reference/cli/
> - https://learn.microsoft.com/en-us/windows/wsl/wsl-config
> - https://code.claude.com/docs/en/authentication (Linux token store:
>   `~/.claude/.credentials.json`, under `mcpOAuth`)
<!-- /deepen-plan -->
## Follow-ups (not in this plan)

- `/setup:all` `for path in …` clobbers `$PATH` under zsh.
- `/setup:all` yellow-goal row points at `yellow-core/…/dist/cli.js`.
- yellow-goal `setup.md:37` / `run-stub.md:62` use
  `${CLAUDE_PLUGIN_ROOT}/../yellow-core`, which breaks in the versioned cache.
- `/research:setup` `has_userconfig` treats jq exit 4 as a parse error; stale
  "MCP WILL FAIL" wording; Context7 probe only checks `mcp__context7__*`.
- setup:all counts a stale yellow-devin cache dir as installed.
