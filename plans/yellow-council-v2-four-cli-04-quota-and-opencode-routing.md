# Feature: Quota Exhaustion Handling + OpenCode Fourth-Lineage Routing

## Overview

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
is resolved by a spike (Phase B, Step 9) before the env var is wired.

## Origin

- Spec: `plans/specs/yellow-council-v2-four-cli.md`
- Covers: R16, R17, R18, R19, R20, R21 (plus the cross-cutting slices of
  R26 SKILL.md lockstep, R27 config tables, R28 README/CHANGELOG, R29 manual
  tests, R30 CI gate + changesets that these changes touch)
- Shell: yellow-council-v2-four-cli-04-quota-and-opencode-routing

## Expansion Decisions

- **Default route: OpenRouter (user decision, 2026-10-03).** Default slug is
  the spike-verified `openrouter/deepseek/...` form for DeepSeek V4 Pro, per
  the spec. Expansion-time `opencode models` on this machine listed
  `opencode/deepseek-v4-pro` (OpenCode Zen, already authenticated) but no
  `openrouter/*` models — OpenRouter is not yet authenticated here, so the
  spike needs `opencode auth login --provider openrouter` first (interactive; the user
  runs it via `! opencode auth login --provider openrouter`). Document the Zen slug as a
  verified alternative value for `COUNCIL_OPENCODE_MODEL`, not the default.
- **OpenRouter auth must be checked, not assumed (user request, 2026-10-03).**
  Moving the unset default to OpenRouter turns a working V1 OpenCode slot
  into `UNAVAILABLE` for anyone without OpenRouter auth. The plan covers
  that at four points: the spike proves the credential works from a non-TTY
  Task spawn (Step 9), `/council:setup` checks it (Step 12), the `/council`
  pre-flight warns (Step 13), and the runtime arm returns an actionable
  `UNAVAILABLE` (Step 11). Docs carry an upgrade note (Step 16).
- **Gemini quota strings: `RESOURCE_EXHAUSTED` floor only.** The Phase G
  spike (`docs/spikes/antigravity-cli-headless-2026-08.md:146-148`) recorded
  no Antigravity exhaustion catalog, so the shell's second open question
  resolves to "floor only".
- **claude-reviewer cannot self-detect quota.** It has no Bash and no CLI —
  a quota wall kills the Agent call before it can return. Its R17 match set
  therefore lives in `council.md`'s orchestrator-side classifier (the R17
  sub-bullet); `claude-reviewer.md` gains only the enum + rule text.
- **Parallel work in flight.** `plans/yellow-council-v2-four-cli-03-synthesis-bias-mitigation.md`
  is open (worktree `agent/feat/council-synthesis-bias-mitigation`) and
  rewrites `council.md` Step 5. Expect conflicts in Step 5 / the headline
  template; restack onto whichever lands first. Shell 03 owns R14's
  Pass-B quota annotation — do not implement it here.

## Pattern Survey

Line anchors are from `origin/main` at `0c384957a`; re-grep before editing.

**Verdict enum sites (R16 — all must gain `QUOTA_EXHAUSTED`, or the `*)`
fallback normalizes it to `UNKNOWN`):**
- `plugins/yellow-council/commands/council/council.md`: Step 4 return
  template `:368`; `parse_reviewer_return` (defined `:400`) enum `case`
  `:1060` with fallback `:1069-1071`; exclusion comment `:1049`; Step 4 tail
  partial-result note `:1089-1090`; 5a staging prose `:1289`; 5b exclusion
  `case` `:1770` (`TIMEOUT|ERROR|UNAVAILABLE) excluded=1`); headline template
  `:2245`; Reviewer Status template `:2273`; synthesizer rules 1 `:2285` and
  4 `:2295`; Failure Modes table `:3433-3436`.
- `plugins/yellow-council/agents/review/claude-reviewer.md`: contract
  template `:329`, rule text `:363-367` ("TIMEOUT and UNAVAILABLE cannot
  occur in-process").
- `plugins/yellow-council/agents/review/gemini-reviewer.md`: enum `case`
  `:773-776`.
- `plugins/yellow-council/agents/review/opencode-reviewer.md`: enum `case`
  `:781-784`.
- `plugins/yellow-codex/agents/review/codex-reviewer.md`: Step 6 enum `case`
  `:921-924`.
- External consumer: `plugins/yellow-review/commands/review/review-pr.md:797-837`
  parses codex's return (TIMEOUT/ERROR "skipped" bullet at `:801`; `rm -f`
  of the reported `fenced_output_path` at `:833-837`).

**`/dev/null` hazards (R18 mandates `fenced_output_path=/dev/null`; today
no site accepts it):**
- `council.md:~915` claude branch of `parse_reviewer_return` rejects any
  path ≠ `$claude_fenced` → records `ERROR`.
- `council.md:~1779` 5b shape `case` refuses non-`/tmp/council-${r}-fenced-*`
  paths (`why="reported path refused"`).
- `council.md:~2557` Step 7 appendix path `case` → "output withheld: path
  refused".
- Unlink loops `council.md:~3178`, `~3314` and `review-pr.md:833-837` would
  `rm -f /dev/null`.

**Error-classification slots (R17):**
- codex: `codex_api_error` extraction `codex-reviewer.md:364`
  (`jq 'select(.type=="error") | .message'`); arm chain `:369-483`. New
  `insufficient_quota|model_cap_exceeded` `elif` goes before the
  `rate_limit_exceeded` arm (`:434`, stays `ERROR` = transient) and before the
  generic API-error arm `:439`. Full 6-key `UNAVAILABLE` precedent `:185-191`.
- gemini: `case $CLI_EXIT` `*)` arm `gemini-reviewer.md:264-282`, grep
  ladder on `ERR_PEEK`. New `RESOURCE_EXHAUSTED` branch goes first (`:267`),
  ahead of the `rate.?limit|quota|429` → `ERROR_KIND=rate-limit` branch
  `:270` (stays transient).
- opencode: `*)` arm `opencode-reviewer.md:274-291`; `ERROR_MSG` from
  `jq 'select(.type=="error") | .error.data.message // .error.name'` `:277`.
  New quota/model-unavailable classification goes between `:277` and `:278`.
  `ERROR_MSG` reaches `summary=` unredacted and uncapped today — sanitize.
- Orchestrator-side claude: no spawn-failure handler exists; a failed claude
  Task falls to the blank-verdict coercion `council.md:1052-1058` → `ERROR`
  (documented at `:352-354`, Failure Modes `:3436`). Hook point: inside
  `parse_reviewer_return` before `:1052`, with the Agent error text passed as
  `reviewer_output`.

**OpenCode invocation (R19/R20):** `PACK_BYTES` guard
`opencode-reviewer.md:157-168` (untouched); argv `:169-174`
(`opencode run --format json --variant "${COUNCIL_OPENCODE_VARIANT:-high}" "$(cat "$PACK_FILE")"`).
Each bash fence is a separate Bash call — resolve the model inside the
invocation fence. Three-state presence-check precedent:
`plugins/yellow-review/lib/review-ledger.sh:287` (`${RL_CORE_LIB+x}`).
`codex-reviewer.md:353` (`${CODEX_MODEL:+-m}`) is the two-state anti-pattern
R19 forbids.

**Pre-flight / header (R21):** Step 1 `council.md:39-85` (tool checks, no
model logic); report header template `:2228` then advisory `:2230-2238` and
`### Headline` `:2240`. Step 7 reloads only `$STATE_FILE` (`:2506-2513`) —
the resolved-models line must be carried by the model from Step 1 output
into the report text, not persisted. Lineage knowability: claude
`model: inherit` → anthropic; codex `CODEX_MODEL` else `model =` in
`~/.codex/config.toml` → openai; gemini `agy` has no model field → google
(spike `:129-135`); opencode → derived from the resolved slug.

**Config tables (R27/R28):** `plugins/yellow-council/CLAUDE.md:188-196`
(4-col), `plugins/yellow-council/README.md:126-134` (3-col),
`council.md:3458-3466` `## Configuration` (3-col), bare-`/council` help text
`council.md:123-126`. `COUNCIL_OPENCODE_VARIANT` rows are the template.

**Tests:** `plugins/yellow-council/tests/lib/extract-synthesis-lib.bash`
`extract_synthesis_lib` (marker-pair extractor, `:17-37`) is the pattern for
a new pure-function lib; `synthesis.bats` `run_in` (`:55`) runs helpers under
bash / zsh / zsh+noclobber; excluded-verdict fixture precedent
`synthesis.bats:1301`/`:1310` (`gemini UNAVAILABLE`). Rule R gotcha
(`extract.bats:23-26`): never write redaction marker literals in a `.bats`
file.

**Spike doc:** `docs/spikes/opencode-cli-format-json-2026-05-04.md` — add a
new `##` section between `## Spike Test Environment Observations` (`:103`)
and `## Gotchas to Watch For` (`:120`); error-event table `:44-50`.

## Implementation

### Phase A — QUOTA_EXHAUSTED (R16–R18)

- [x] Step 1: In `council.md`, add a `# >>> council-quota-lib` /
  `# <<< council-quota-lib` marker pair (Step 4, before
  `parse_reviewer_return`) holding pure functions:
  `council_quota_eta <text>` (extracts a reset ETA — `resets <time>`,
  `try again in <dur>`, `retry after <dur>` — else prints
  `reset time not reported`; strips control chars, caps at 200 bytes) and
  `council_classify_claude_quota <text>` (exit 0 + prints ETA when text
  matches `/session limit.*resets/i`, `/weekly limit.*resets/i`,
  `/Opus limit.*resets/i`, or fallback `/usage limit reached.*try again/i`;
  exit 1 otherwise — never on generic rate-limit text or HTTP 529). Must run
  under bash and zsh (no `[[ =~ ]]` captures; use `grep -iE` / `sed`).
- [x] Step 2: In `parse_reviewer_return` (`council.md:~400-1071`): add
  `QUOTA_EXHAUSTED` to the enum `case` (`:1060`) and the exclusion comment
  (`:1049`); before the blank-verdict coercion (`:1052`), when the reviewer
  is `claude` and the return has no `verdict=` line, run
  `council_classify_claude_quota` on the raw text and, on match, synthesize
  the R18 block (`verdict=QUOTA_EXHAUSTED`, `confidence=N/A`,
  `summary=Claude quota exhausted — <ETA>`, `fenced_output_path=/dev/null`,
  empty findings). Update the Step 4 prose at `:352-354` so a claude spawn
  failure is classified first, `ERROR` only when no quota string matches.
- [x] Step 3: Accept `/dev/null` for `QUOTA_EXHAUSTED` only, at
  `council.md:~915` (claude path check), `:~1779` (5b shape `case`, take the
  ETA from `${r}.summary.txt`), and `:~2557` (Step 7 appendix — print
  "no output: quota exhausted" instead of "path refused"). Make the unlink
  loops at `:~3178` and `:~3314` skip `/dev/null` explicitly.
- [x] Step 4: Route `QUOTA_EXHAUSTED` through the excluded-slot paths in
  `council.md`: 5b `case` `:1770` (`TIMEOUT|ERROR|UNAVAILABLE|QUOTA_EXHAUSTED) excluded=1`),
  Step 4 tail `:1089-1090`, 5a prose `:1289`, synthesizer rules `:2285` and
  `:2295`, Reviewer Status template `:2273`, and the headline template
  `:2245` so a quota slot reads `<reviewer> quota exhausted (resets <ETA>)`.
  Update the Step 4 return template `:368`. Add a Failure Modes row
  (`:3433-3436`) for "Reviewer QUOTA_EXHAUSTED".
- [x] Step 5: `plugins/yellow-codex/agents/review/codex-reviewer.md`: add an
  `elif` on `$codex_api_error` matching `insufficient_quota|model_cap_exceeded`
  before the `rate_limit_exceeded` arm (`:434`) that emits the full 6-key
  stub (`verdict=QUOTA_EXHAUSTED`, `confidence=N/A`, ETA summary,
  `fenced_output_path=/dev/null`, empty `findings_block_begin`/`_end` pair);
  leave `rate_limit_exceeded` / 429 as transient `ERROR`. Add
  `QUOTA_EXHAUSTED` to the Step 6 enum `case` (`:921-924`). Inline the ETA
  extraction (the agent cannot source `council.md`); keep the same
  patterns as `council_quota_eta`.
- [x] Step 6: `plugins/yellow-review/commands/review/review-pr.md`: add
  `QUOTA_EXHAUSTED` to the "skipped" bullet at `:801` (so an empty findings
  pair is not read as "Codex found nothing") and guard the `rm -f` at
  `:833-837` against `/dev/null` (only unlink `/tmp/` paths).
- [x] Step 7: `gemini-reviewer.md`: add a first branch to the `ERR_PEEK`
  ladder (`:267`) matching `RESOURCE_EXHAUSTED` → 6-key `QUOTA_EXHAUSTED`
  stub; leave `rate.?limit|quota|429` (`:270`) as transient `ERROR`. Add
  `QUOTA_EXHAUSTED` to the enum `case` (`:773-776`).
- [x] Step 8: `opencode-reviewer.md`: between `:277` and `:278`, classify
  `ERROR_MSG` — provider quota passthrough (`insufficient_quota`,
  `model_cap_exceeded`, `RESOURCE_EXHAUSTED`, `quota exceeded`,
  `usage limit`, OpenRouter's insufficient-credits / 402 text as recorded by
  the Step 9 spike) → 6-key `QUOTA_EXHAUSTED` stub with the provider message
  in `summary=`. Sanitize `ERROR_MSG` before any `summary=` use (strip
  control chars and newlines, cap 300 bytes). Add `QUOTA_EXHAUSTED` to the
  enum `case` (`:781-784`). In `claude-reviewer.md`, add `QUOTA_EXHAUSTED`
  to the template (`:329`) and rewrite the rule at `:363-367`: the agent
  never emits it; the orchestrator synthesizes it on spawn failure.

### Phase B — OpenCode routing + lineage (R19–R21)

- [x] Step 9: Routing spike (gate for Steps 10–14). Ask the user to run
  `! opencode auth login --provider openrouter`; then record in a new
  `## OpenRouter Routing Spike (<date>)` section of
  `docs/spikes/opencode-cli-format-json-2026-05-04.md` (between `:103` and
  `:120`): `opencode models openrouter | grep -i deepseek` output (exact V4
  Pro slug), a successful `opencode run --format json --model <slug> "reply ok"`,
  the `error` event JSON for (a) an unknown model slug and (b) an
  unauthenticated provider, and — if observable — OpenRouter's
  insufficient-credits error text. Note `opencode/deepseek-v4-pro` (OpenCode
  Zen) as a verified-listed alternative. Note: the positional argument to
  `opencode auth login` is a well-known-auth URL, not a provider id —
  `opencode auth login openrouter` fails with "fetch() URL is invalid"; the
  spec's R20 `opencode auth login <provider>` wording means `--provider`.
  Run spike probes with `--pure` (no external plugins) where the command
  supports it. opencode was upgraded 1.14.33 → 1.18.34 on 2026-10-03 (the
  existing spike doc was written against 1.14), so re-check the
  `--format json` event shape (`error` event fields used at
  `opencode-reviewer.md:277`) and `--variant` on 1.18.34 and note it. Also record (c) a non-interactive
  credential check that works without printing the key — `opencode auth list`
  output naming OpenRouter, and whether `OPENROUTER_API_KEY` in the
  environment is honored as an alternative — and (d) that the credential
  works from a non-TTY Task/Agent-spawned subprocess (spawn a throwaway
  Agent that runs the `opencode run --model <slug>` smoke call), since that
  is where opencode-reviewer runs (see
  `docs/solutions/integration-issues/codex-cli-401-non-tty-task-spawn-degradation.md`
  for the keyring failure mode this rules out). Do not use `defaultProvider`
  in `opencode.json`. Snapshot `~/.config/opencode` before the spike (see
  `docs/solutions/integration-issues/opencode-cli-listing-rewrites-user-config-in-place.md`).
  If OpenRouter cannot be authenticated, stop and ask the user before
  choosing a different default.
  Pre-captured at expansion (opencode 1.18.34, 2026-10-03): OpenRouter
  auth is stored (`auth.json` key `openrouter`, type `api`);
  `openrouter/deepseek/deepseek-v4-pro` is listed (plus dated
  `-0813` and `~deepseek/deepseek-pro-latest` aliases). A low-balance key
  made `opencode run --format json` exit 1 with one `error` event:
  `.error.name == "APIError"`, `.error.data.statusCode == 402`,
  `.error.data.isRetryable == false`, message "This request requires more
  credits, or fewer max_tokens. You requested up to 32000 tokens, but can
  only afford N…" — opencode requests 32000 max_tokens by default, so a
  near-empty balance fails even tiny prompts. Treat 402 / "requires more
  credits" as `QUOTA_EXHAUSTED` in Step 8 (no ETA; remedy is adding
  credits or raising the key's weekly limit). The message embeds an
  account key-management URL — Step 8's sanitizer must strip URLs, and the
  spike doc must not copy them.
- [x] Step 10: Wire `COUNCIL_OPENCODE_MODEL` in `opencode-reviewer.md`'s
  invocation fence (`:169-174`), leaving the `PACK_BYTES` guard
  (`:157-168`) untouched: `${COUNCIL_OPENCODE_MODEL+x}` presence check —
  unset → `--model <spike slug>`; set-but-empty → no `--model` (V1);
  non-empty → `--model "$COUNCIL_OPENCODE_MODEL"` verbatim. Build the argv
  with `set --` (bash/zsh-safe, no arrays). Print the resolved model to
  stderr. Update the invocation description at `:19` and `:66`.
- [x] Step 11: R20 — in the opencode `*)` arm, match the spike-recorded
  model-not-found / unauthenticated error events → `verdict=UNAVAILABLE`
  with an actionable summary (`run "opencode auth login --provider <provider>" or set
  COUNCIL_OPENCODE_MODEL to a model listed by "opencode models"`), never
  `ERROR`.
- [x] Step 12: OpenRouter auth check in `plugins/yellow-council/commands/council/setup.md`
  (Step 3 "Detect OpenCode CLI", `:99-116`): when opencode is installed and
  the resolved model (same three-state logic and default slug as Step 10)
  starts with `openrouter/`, run the Step 9 credential check. Report
  `[yellow-council] opencode OpenRouter auth: ok` or a WARNING naming the
  fixes — `opencode auth login --provider openrouter` (or exporting
  `OPENROUTER_API_KEY` if the spike showed it is honored), or opt out with
  `export COUNCIL_OPENCODE_MODEL=""` (V1) / `opencode/deepseek-v4-pro`
  (Zen). Never prompt for, read, or print the key. Reflect it in the
  summary line (`:187-188`) as `OpenCode=installed (needs OpenRouter auth)`
  and update the limitations note at `:200`, which today says setup does
  not verify OpenCode provider auth.
- [x] Step 13: Lineage pre-flight in `council.md`: add
  `council_resolve_lineage` to the `council-quota-lib` marker pair (maps a
  model string to `anthropic|openai|google|deepseek|<provider>|unknown` by
  slug prefix/family), and at the end of Step 1 (`:~85`) a block that
  resolves each slot — claude `inherit` → anthropic; codex `CODEX_MODEL`
  else best-effort `model =` from `~/.codex/config.toml`, lineage openai;
  gemini `agy default` → google; opencode via the same three-state logic as
  Step 10 (same default slug literal) — prints one
  `COUNCIL_MODELS: claude=… codex=… gemini=… opencode=…` line, and a
  non-blocking `[council] Warning: <a> and <b> both resolve to <lineage>`
  on collision. When the opencode slot resolves to `openrouter/` and the
  Step 9 credential check fails, also print a non-blocking warning pointing
  at `/council:setup` (the slot will return `UNAVAILABLE`). Never exits
  non-zero.
- [x] Step 14: Add a `**Models:** <COUNCIL_MODELS line from Step 1>` row to
  the report header template (`council.md:2228`, before the advisory
  blockquote) and a sentence telling the model to copy it verbatim from
  Step 1 output (Step 7's subprocess does not persist it).

### Phase C — Tests, docs, ship (R26–R30 slices)

- [ ] Step 15: Add `extract_quota_lib` (or generalize `extract_synthesis_lib`
  to take a marker name) in `plugins/yellow-council/tests/lib/extract-synthesis-lib.bash`,
  and a new `plugins/yellow-council/tests/quota-lineage.bats` using the
  `run_in` profiles: claude quota strings match (session / weekly / Opus /
  usage-limit fallback) with ETA extracted; generic rate-limit and `529` do
  not match; `council_quota_eta` fallback and 200-byte cap;
  `council_resolve_lineage` mappings and collision detection; a contract
  test that every verdict `case` in the 4 reviewer files and `council.md`
  lists `QUOTA_EXHAUSTED`; a drift test that the opencode default slug
  literal is identical in `opencode-reviewer.md`, `council.md` and
  `setup.md`. Add a
  `QUOTA_EXHAUSTED` excluded-slot fixture to `synthesis.bats` following
  `:1301`/`:1310`.
- [ ] Step 16: Docs — `COUNCIL_OPENCODE_MODEL` row (three states, default
  slug, Zen alternative) in `plugins/yellow-council/CLAUDE.md:188-196`,
  `README.md:126-134`, `council.md:3458-3466`, and help text
  `council.md:123-126`; update the CLAUDE.md opencode-reviewer entry
  (`:157-159`) and the README lineage map (opencode → DeepSeek via
  OpenRouter) plus a known-limitations note (lineage detection is
  best-effort; gemini quota detection is `RESOURCE_EXHAUSTED`-floor only).
  Add an upgrade note to the README and the changeset text: the unset
  default now needs OpenRouter auth (`opencode auth login --provider openrouter`);
  without it the OpenCode slot returns `UNAVAILABLE` where V1 ran, so set
  `COUNCIL_OPENCODE_MODEL=""` to keep V1 or `opencode/deepseek-v4-pro` for
  Zen.
- [ ] Step 17: `plugins/yellow-council/skills/council-patterns/SKILL.md`
  lockstep: opencode invocation block (`:1000-1008`) with `--model`, the
  exit-code / verdict table (`:618-621`), claude-slot degradation prose
  (`:934-936`), and the Reviewer Output Schema (`:85-143`) gain
  `QUOTA_EXHAUSTED`. Update `plugins/yellow-codex/skills/codex-patterns/SKILL.md`
  near `:198` for the codex quota arm.
- [ ] Step 18: `docs/testing/yellow-council-manual-tests.md`: add R29
  scenarios — one reviewer `QUOTA_EXHAUSTED` with ETA matching the provider
  error; lineage-collision warning (e.g. `COUNCIL_OPENCODE_MODEL=openai/gpt-5.4`);
  OpenCode resolved slug in the report header; `COUNCIL_OPENCODE_MODEL=""`
  V1 path; unknown slug → actionable `UNAVAILABLE`; OpenRouter
  unauthenticated with the default → `/council:setup` warns and the slot
  returns `UNAVAILABLE` with the `opencode auth login --provider openrouter` fix.
- [ ] Step 19: Changesets — `yellow-council` minor, `yellow-codex` minor
  (additive verdict), `yellow-review` patch; CHANGELOG entries come from
  `pnpm apply:changesets`. Run the verification gate below.

## Verification

- `pnpm validate:agents && pnpm lint:plugins` -> expected: pass (agent and
  command markdown changed).
- `pnpm validate:shell-compat && pnpm check:shell-parse` -> expected: pass
  (new fenced shell in 4 agents + council.md must parse under bash and zsh).
- `pnpm validate:schemas` -> expected: pass, including council-roster
  (Rule R/S) and doc-counts.
- `cd plugins/yellow-council && bats tests/` -> expected: all green,
  including `quota-lineage.bats` under bash, zsh, zsh+noclobber.
- `cd plugins/yellow-codex && bats tests/` and
  `cd plugins/yellow-review && bats tests/` -> expected: pass.
- `pnpm test:unit && pnpm test:integration && pnpm lint && pnpm typecheck`
  -> expected: pass (R30 baseline).
- `rg -n 'UNAVAILABLE\)' plugins/yellow-council/agents plugins/yellow-codex/agents/review plugins/yellow-council/commands`
  -> expected: every verdict `case` line also contains `QUOTA_EXHAUSTED`.
- `/council:setup` with OpenRouter authenticated -> expected:
  `opencode OpenRouter auth: ok`; with `COUNCIL_OPENCODE_MODEL` unset and no
  OpenRouter credential (e.g. `XDG_DATA_HOME` pointed at an empty dir, if
  the spike shows that isolates `auth.json`) -> expected: WARNING naming
  `opencode auth login --provider openrouter`, and no key material in output.
- Manual: `env -u COUNCIL_OPENCODE_MODEL /council review` shows the
  OpenRouter DeepSeek slug in the report header; `COUNCIL_OPENCODE_MODEL=""`
  omits `--model`; `COUNCIL_OPENCODE_MODEL=bogus/model` yields `UNAVAILABLE`
  with the `opencode auth login` / `opencode models` guidance and the
  council still completes.

## Context Files

- `plans/specs/yellow-council-v2-four-cli.md` — R16–R21 text, R26–R30
  cross-cutting obligations, R0 decision rule.
- `plugins/yellow-council/commands/council/council.md` — parser, exclusion
  sets, headline/header templates, pre-flight, config table, unlink loops.
- `plugins/yellow-council/agents/review/{claude,gemini,opencode}-reviewer.md`
  — verdict enums and error-classification arms.
- `plugins/yellow-codex/agents/review/codex-reviewer.md` — codex error arm
  chain and enum (cross-plugin; needs its own changeset).
- `plugins/yellow-review/commands/review/review-pr.md:797-837` — external
  consumer of codex's verdict and fenced path.
- `docs/spikes/opencode-cli-format-json-2026-05-04.md` — spike record home.
- `plugins/yellow-council/commands/council/setup.md` — OpenCode detection
  (Step 3) and summary line where the OpenRouter auth check lands.
- `docs/spikes/antigravity-cli-headless-2026-08.md:146-148` — gemini quota
  floor rationale.
- `plugins/yellow-review/lib/review-ledger.sh:287` — `${VAR+x}` precedent.
- `plugins/yellow-council/tests/lib/extract-synthesis-lib.bash`,
  `tests/synthesis.bats` — marker-pair extraction and shell-profile harness.
- `plans/complete/yellow-council-v2-four-cli-02-claude-reviewer-fanout.md` —
  upstream shell that produced claude-reviewer and the 4-slot parser.
