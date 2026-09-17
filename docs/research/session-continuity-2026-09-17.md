# Session continuity — research and evidence ledger

**Adopted:** 2026-09-17 into `docs/research/` from the external
session-continuity packet (RESEARCH.md sha256 `6945ba3a…`). The packet body is
preserved below; the **live reconciliation addendum** at the end records what
this checkout, the installed plugin cache and the Claude Code client actually
reported on the adoption date, labelled with the evidence standard defined in
this document. **Governs:** [PRD](../prds/session-continuity.md) ·
[acceptance tests](../testing/session-continuity-acceptance.md) ·
[build playbook](../development/session-continuity-playbook.md) **Related prior
research in this repo:**
[`rtk-vs-sigmap-context-management-comparison.md`](rtk-vs-sigmap-context-management-comparison.md)
(2026-05-08, command-output compression — a different layer from session
continuity) and `plans/yellow-rtk-plugin.md`.

---

**Checked:** 2026-09-17. This is targeted source inspection, not a benchmark of
Brad's environment. GitHits was attempted, but its initialization returned
`FORBIDDEN: This conversation does not support developer MCPs`. No GitHits
result supports this packet; official documentation, primary research and direct
GitHub reads do.

## What to borrow, and what not to import

| Source                                              | Verified lesson                                                                                                                     | Proposed application                                                                                            |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Anthropic harness engineering                       | Resets helped one earlier-model harness; subsequent model capability made some reset/orchestration scaffolding unnecessary.         | Keep native compaction as a baseline and make reset policy replaceable.                                         |
| Temporal Continue-As-New and its TypeScript example | Logical workflow identity survives a new execution; the sample waits for active handlers before continuing.                         | Stable seat, new generation, explicit state transfer, drain before replacement.                                 |
| LangGraph persistence and graceful drain            | Completed work can be checkpointed independently of failed siblings; draining does not mean immediate cancellation of ongoing work. | Preserve applied-operation receipts; distinguish a drain request from a confirmed stopped writer.               |
| Pi compaction implementation                        | Context policy is separated from session I/O; reserve-based thresholds and structured file-operation records are explicit.          | Pure decision logic, deterministic workspace metadata, safe boundaries, no copied numeric thresholds.           |
| Handoff Debt preprint, revision 2026-08-30          | Context-bearing handoffs reduced rediscovery overhead; completion effects were smaller and model-dependent.                         | Measure takeover efficiency and correctness separately. A structured document is not proof of better reasoning. |

These are architectural patterns, not dependency recommendations. The proposal
adds no Temporal service, LangGraph runtime, Pi fork, or new memory platform. No
upstream source code is vendored in this packet. A future copied implementation
would require a pinned revision and verified license/attribution before
adoption.

## Host-specific implications

Claude's statusline exposes session-bound context observations but may report
null values around startup/compaction, and repeated rendering can interrupt a
previous script. Use it only as a lightweight, cancellation-safe observer.
Validate a separate telemetry surface for headless execution. [SRC06]

Native Claude process management can be reused by an adapter after capability
testing, but a documented respawn resumes history rather than proving a clean
conversation. Native held peer messages are session-local, not an established
durable handoff channel. [SRC07, SRC08]

Fable 5.1 selection and availability depend on the installed client/provider.
Its headless or SDK usage-credit billing does not show the interactive consent
prompt. A live pilot therefore needs an explicit billing-aware budget gate,
independent of the model's willingness to continue. [SRC09]

## Repo-specific consequences

The `yellow-core` handoff skill already produces redacted notes, but its
newest-file resume selection is unsuitable for concurrent automated use. Evolve
it instead of making a competing skill family. [SRC11]

The bridge currently pins engine 0.2.0 and exposes only request operations and
stub execution. An engine README describing real execution does not mean the
bridge can launch it. Automatic replacement must cross an explicitly released
and tested capability boundary. [SRC14, SRC15]

The planning workflow is unusually important here. `/flow:spec` creates only a
spec; `/flow:decompose` requires complete local requirement coverage; the
no-argument picker scans all shell projects. Exact `/flow:expand-shell` paths
avoid selecting another feature's work. Expansion and implementation remain
separate sessions. [SRC12]

On the inspected main, `/plan:complete` also contains a Graphite prerequisite
and submission instructions. Reconcile the installed definition with the active
stacked-PR provider before using it in a GitHub-only environment; do not
silently switch providers or fabricate completion markers. [SRC16]

The open-PR scan surfaced hook work #797–#799 and #802, plus active Jules work
#793. These are overlap checks for the build kickoff, not merged prerequisites
or independently verified claims about their fixes. Inspect their current status
and changed paths before selecting a base; do not auto-merge or cherry-pick
them. [SRC17]

## Evidence standard

A source describing an API is `documented`; reading code is `source-inspected`;
a fixture or fake test is `simulated`; a run on the actual supported client is
`host-tested`. Record those labels separately. None of the lifecycle behavior in
this proposal is host-tested by this research session, and no repository tests
or paid agents were run.

Do not infer that a source is the best implementation from stars, marketing, or
the mere presence of a state machine. Evaluate enforceable ownership, recovery
behavior, test evidence, operational complexity and compatibility with the
existing engine.

## Sources

### SRC01 — Anthropic harness research

[Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps),
published 2026-03-24. Historical model-dependent evidence; not a Fable 5.1
benchmark and not evidence for a universal 50% threshold.

### SRC02 — Temporal workflow continuity

[Continue-As-New, TypeScript SDK](https://docs.temporal.io/develop/typescript/workflows/continue-as-new).

[Official safe-message-handlers example](https://github.com/temporalio/samples-typescript/blob/main/message-passing/safe-message-handlers/src/workflows.ts).
Inspected content blob: `a2c59f47256f922d43920a84f4c3c13545ce53fa`.
[Exact blob API](https://api.github.com/repos/temporalio/samples-typescript/git/blobs/a2c59f47256f922d43920a84f4c3c13545ce53fa).
The example waits for handlers before Continue-As-New and carries explicit
state.

### SRC03 — LangGraph recovery and drainage

[JavaScript checkpointers](https://docs.langchain.com/oss/javascript/langgraph/checkpointers)
and
[fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance).
Re-check version support before using a particular API; the proposal borrows
behavior rather than adopting these dependencies.

### SRC04 — Pi compaction

[Compaction documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md).

[Inspected compaction implementation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts),
content blob `12eaa8aef9dcfc982d2b102abcae9423ffc6160d`.
[Exact blob API](https://api.github.com/repos/earendil-works/pi/git/blobs/12eaa8aef9dcfc982d2b102abcae9423ffc6160d).
Old badlogic/pi-mono references redirected to the current earendil-works/pi
repository during research. No numeric defaults are adopted.

### SRC05 — Handoff Debt

Dipesh KC and Anjila Budathoki,
[Handoff Debt: The Rediscovery Cost When Coding Agents Take Over Interrupted Tasks](https://arxiv.org/abs/2606.02875v2),
submitted 2026-06-01, revised 2026-08-30.
[HTML](https://arxiv.org/html/2606.02875v2). Preprint; do not turn its
efficiency result into an unqualified completion-rate or model-specific claim.

### SRC06 — Claude context observations

[Statusline reference](https://code.claude.com/docs/en/statusline). Validate
actual payloads, session identity, nulls, and script interruption behavior on
the supported installed version.

### SRC07 — Claude process/session management

[Agent view](https://code.claude.com/docs/en/agent-view). Fresh creation,
process respawn, and conversation resumption must remain separate adapter
capabilities.

### SRC08 — Claude cross-session messaging

[Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging).
Native message controls are not a verified cross-generation durable inbox
transfer protocol.

### SRC09 — Claude model selection and billing behavior

[Model configuration](https://code.claude.com/docs/en/model-config). Inspect the
actual selected model, provider, client version and billing mode; do not infer
account eligibility from model names in repository documents.

### SRC10 — yellow-plugins revision

[Inspected main commit](https://github.com/KingInYellows/yellow-plugins/commit/05a6ff48450ebbf5d82194a98867febf871f39e4),
dated 2026-09-11. All yellow-plugins paths below use that revision unless
explicitly noted.

### SRC11 — Existing handoff

[session-handoff/SKILL.md](https://github.com/KingInYellows/yellow-plugins/blob/05a6ff48450ebbf5d82194a98867febf871f39e4/plugins/yellow-core/skills/session-handoff/SKILL.md),
blob `58ff52d218ecb1f941b40a0833246fe40a0913db`.

### SRC12 — Planning and execution command contracts

- [flow:spec](https://github.com/KingInYellows/yellow-plugins/blob/05a6ff48450ebbf5d82194a98867febf871f39e4/plugins/yellow-core/commands/flow/spec.md),
  blob `4699b2b7b76f8b13beb63c4b024ee9bc9afd6ebc`.
- [flow:decompose](https://github.com/KingInYellows/yellow-plugins/blob/05a6ff48450ebbf5d82194a98867febf871f39e4/plugins/yellow-core/commands/flow/decompose.md),
  blob `c0f76e165a3f5d4b8326d8eee2cec55ac34030de`.
- [flow:pick-next-shell](https://github.com/KingInYellows/yellow-plugins/blob/05a6ff48450ebbf5d82194a98867febf871f39e4/plugins/yellow-core/commands/flow/pick-next-shell.md),
  blob `45cc1323f5a179cb95b69a091abf2ac3d57cdf22`.
- [flow:expand-shell](https://github.com/KingInYellows/yellow-plugins/blob/05a6ff48450ebbf5d82194a98867febf871f39e4/plugins/yellow-core/commands/flow/expand-shell.md),
  blob `fb746b64c293a3d430e50f85ae854c123b1495d3`.
- [flow:work](https://github.com/KingInYellows/yellow-plugins/blob/05a6ff48450ebbf5d82194a98867febf871f39e4/plugins/yellow-core/commands/flow/work.md),
  blob `8aab50e8c7a1da5bad3482a8e62fdb66b881c8bb`.

### SRC13 — Build and validation entry points

[Root package.json](https://github.com/KingInYellows/yellow-plugins/blob/05a6ff48450ebbf5d82194a98867febf871f39e4/package.json),
blob `db50031eb2f49ca2150491ef065aa57462625767`. These scripts were inspected,
not executed. Discover plugin-specific behavioral suites; a root command can
report no tests without exercising a new plugin feature.

### SRC14 — Existing engine bridge

[yellow-goal plugin README](https://github.com/KingInYellows/yellow-plugins/blob/05a6ff48450ebbf5d82194a98867febf871f39e4/plugins/yellow-goal/README.md),
blob `9ff5eeb1a0c20a8c35448cd2bdb91f9cf851b030`.

### SRC15 — Engine implementation overview

[yellow-goal/goal-gen/README.md](https://github.com/KingInYellows/yellow-goal/blob/main/goal-gen/README.md),
inspected blob `58d034b53c4a9ede1bef9614b15112f62405cb97`.
[Exact blob API](https://api.github.com/repos/KingInYellows/yellow-goal/git/blobs/58d034b53c4a9ede1bef9614b15112f62405cb97).
Full engine implementation and all active ADRs were not audited for this packet;
the engine kickoff explicitly requires that inspection.

### SRC16 — Completion gate

[plan:complete](https://github.com/KingInYellows/yellow-plugins/blob/05a6ff48450ebbf5d82194a98867febf871f39e4/plugins/yellow-core/commands/plan/complete.md),
blob `6f11738be5b2facb04e5551a5d422b8671480644`. Header, input and prerequisite
sections inspected, including merged-PR evidence gate and Graphite prerequisite.

### SRC17 — Active-work overlap checks

PR metadata observed during the open-PR query:
[#797](https://github.com/KingInYellows/yellow-plugins/pull/797),
[#798](https://github.com/KingInYellows/yellow-plugins/pull/798),
[#799](https://github.com/KingInYellows/yellow-plugins/pull/799),
[#802](https://github.com/KingInYellows/yellow-plugins/pull/802), and
[#793](https://github.com/KingInYellows/yellow-plugins/pull/793). Status and
diffs must be rechecked at implementation time; descriptions alone are not proof
that a fix works.

---

## Live reconciliation addendum (2026-09-17, this checkout)

Evidence labels follow the standard above. Nothing in this addendum is
`host-tested`; no repository tests, hooks or paid agents were run during the
readiness pass.

### Revisions and installed versions (`source-inspected`)

| Item                                       | Value                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yellow-plugins` `main`                    | `3812fc66` (`fix(hooks): remove hooks/hooks.json mirrors auto-loaded by Claude Code (#797)`), clean, one commit after SRC10's `05a6ff48`                                                                                                                                                                                                                                                                                |
| Claude Code marketplace clone of this repo | `~/.claude/plugins/marketplaces/yellow-plugins` at `3812fc6`, `autoUpdate: true`, refreshed 2026-09-17                                                                                                                                                                                                                                                                                                                  |
| Installed `yellow-core`                    | `yellow-core@yellow-plugins` 2.3.1, user scope, `~/.claude/plugins/cache/yellow-plugins/yellow-core/2.3.1`, `gitCommitSha` `4192ea57` (`chore: version packages (#756)`, ancestor of `main`), `lastUpdated` 2026-09-05; `diff -rq` against `plugins/yellow-core/` is empty. An orphan `2.3.0` cache directory remains on disk and is not referenced by `installed_plugins.json`. No local or duplicate copy was enabled |
| Claude Code client                         | `claude --version` → 2.1.274                                                                                                                                                                                                                                                                                                                                                                                            |
| `yellow-goal` engine                       | sibling clone `main` `09bcd16`, `goal-gen/package.json` 0.2.0, one open unrelated PR (#24). Bridge pin `plugins/yellow-goal/src/pin.ts`: version 0.2.0, tag `v0.2.0`, commit `09bcd16cd25e…`, asset `goal-gen-0.2.0.tgz` sha256 `7ad266b2…`                                                                                                                                                                             |
| Node / package manager                     | Node 22.22.3 via fnm; `packageManager` `pnpm@8.15.0`; `engines` `>=22.22.0 <25.0.0`                                                                                                                                                                                                                                                                                                                                     |

### Existing handoff surface (`source-inspected`, SRC11 re-read at `main`)

- `plugins/yellow-core/skills/session-handoff/SKILL.md` —
  `user-invocable: true`; writes `plans/handoff/<YYYY-MM-DD>-<slug>.md`; six
  fields (current task, workflow status, active artifact, open decisions,
  in-flight changes as filenames only, next concrete action); slug validated
  against `^[a-z0-9]+(-[a-z0-9]+)*$`; explicit paths must resolve inside
  `plans/handoff/`; collision handling appends `-2`, `-3`; body is piped through
  `cs_redact_secrets` from a single-quoted heredoc so no unredacted draft is
  written. **Resume selection is `ls -t plans/handoff/*.md | head -n 1`** — the
  newest-file rule the PRD's R2 replaces. There is no CI gate on
  `plans/handoff/` and no bats suite for the skill.
- Legacy artifacts:
  `plans/handoff/2026-07-28-pr666-667-deferred-review-followups.md` and
  `plans/handoff/2026-07-29-sweep-all-670-672-close-out.md` (free-form, with
  `##` sections and an EXECUTED postscript). These are the R1 "old fixtures
  still load" inputs.
- `plugins/yellow-core/lib/compound-staging.sh` exposes
  `cs_derive_project_slug`, `cs_staging_dir_for_slug`, `cs_atomic_jsonl_write`
  (write-to-sibling-temp then rename), `cs_redact_secrets` (vendor token
  prefixes, `password=`/`token=` assignments, Bearer/basic auth, PEM blocks),
  drain-budget helpers and `cs_detect_auth_route`. `lib/validate-fs.sh` provides
  the canonical `validate_file_path`.
- `CLAUDE.md` "Compact instructions" and the `PreCompact` hook
  (`hooks/scripts/pre-compact.sh`) already tell native compaction what to
  preserve verbatim; native compaction stays on (PRD R1).

### Hook and observation surface (`source-inspected`)

- Catalog source `catalog/plugins/yellow-core.json` → generated
  `plugins/yellow-core/.claude-plugin/plugin.json`: `Stop` →
  `hooks/scripts/stop.sh` (timeout 5), `SessionStart` →
  `hooks/scripts/session-start.sh` (timeout 3), `PreCompact` →
  `hooks/scripts/pre-compact.sh` (timeout 3). Only the PreCompact command is
  double-quoted on `main`; #799 quotes the rest. No `hooks/hooks.json` exists in
  yellow-core (#797 removed the mirrors elsewhere).
  `targets.codex.includeHooks: false`.
- `PreCompact` stdout becomes custom compaction instructions on exit 0
  (binary-verified on 2.1.261 in
  `docs/solutions/integration-issues/precompact-hook-stdout-contract.md`; the
  public docs page was wrong at the time). Subagent compactions (`agentContext`
  set) discard it. Tests: `plugins/yellow-core/tests/pre-compact-hook.bats`.
- `SessionStart` reads `cwd` from the hook JSON and spawns a disowned
  `claude -p … --permission-mode bypassPermissions` drain when the
  compound-staging thresholds are met; it is the only place yellow-core launches
  a model, and it is unrelated to continuity. The foundation must not add a
  second launcher (PRD R1, R8).
- Statusline: `~/.claude/settings.json` `statusLine.command` =
  `python3 /home/<user>/.claude/yellow-statusline.py`, generated 2026-06-02 by
  `/statusline:setup` (`STATUSLINE_VERSION = "1.0.0"`). `segment_context` reads
  `context_window.used_percentage`; `None` renders `ctx:--` with alert level 0;
  the value is clamped to 0–100; warn at 70, critical at 90. The script persists
  only a git cache (`~/.claude/yellow-sl-git`, 5 s TTL) and an error log; it
  does not record `session_id`, a timestamp or the raw payload. Its baked-in
  `DETECTED_PLUGINS` still lists `yellow-chatprd` and `yellow-mempalace` (the
  latter removed in #784), so the script is already stale relative to the
  marketplace. Consequence for PRD R7/R8: a session-bound observation record is
  new work; regenerating the statusline rewrites the user's script and must
  remain an explicit setup choice.
- Hook inputs (SRC06/SRC07 to be re-verified on 2.1.274 — see the
  host-documentation section below): `session_id`, `transcript_path`, `cwd`,
  `hook_event_name`; `PreCompact` adds `trigger` (`manual`|`auto`) and
  `custom_instructions`. No hook input carries context-window numbers on the
  inspected sources.

### Host documentation re-check for Claude Code 2.1.274 (`documented`, retrieved 2026-09-17)

Official pages at `code.claude.com/docs` were re-read on the adoption date. This
is the SRC06–SRC09 refresh the packet asked for; it is still `documented`, not
`host-tested`.

- **Statusline payload** (`/docs/en/statusline`): always present `session_id`,
  `transcript_path`, `cwd`, `workspace`, `model`, `cost`. `context_window`
  carries `context_window_size`, `total_input_tokens`, `total_output_tokens`,
  `used_percentage`, `remaining_percentage`, `current_usage` (`input_tokens`,
  `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) and
  `exceeds_200k_tokens`. `current_usage` is null before the first API call and
  again after `/compact` until the next call; `used_percentage` /
  `remaining_percentage` may be null early in a session. Optional fields
  (`session_name`, `prompt_id`, `workspace.git_worktree`, `workspace.repo`,
  `agent`, `worktree`, `rate_limits`, `prompt_cache`, …) may be absent. The
  script runs on session start, resume, each new assistant message and after
  `/compact`, with an optional `refreshInterval` (minimum 1 s). Script
  interruption when a newer update arrives and any debounce interval are **not
  documented**; PRD R8's cancellation-safety requirement must be `host-tested`.
- **Hook inputs** (`/docs/en/hooks`): every hook receives `session_id`,
  `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`,
  `hook_event_name`, plus `agent_id` / `agent_type` inside subagents.
  `SessionStart` carries `source` ∈ {`startup`, `resume`, `clear`, `compact`,
  `fork`}; `PreCompact` is matched on `manual` | `auto`; `PostCompact` and
  `SessionEnd` (matchers `clear`, `resume`, `logout`, `prompt_input_exit`,
  `other`) exist. **No hook receives context-window numbers**, and no
  environment variable, OpenTelemetry metric or `/context` programmatic surface
  is documented. The statusline payload is therefore the only supported
  observation input for PRD R7, and headless (`claude -p`) runs have no
  documented equivalent — exactly the "statusline availability does not imply
  headless availability" caveat.
- **Compaction** (`/docs/en/how-claude-code-works`): `/compact <focus>` accepts
  custom instructions; settings `autoCompactEnabled` (default true) and
  `autoCompactWindow` (default 85, a percentage) control automatic compaction.
  The docs still describe re-injecting context through `SessionStart` with the
  `compact` matcher and do not document `PreCompact` stdout; this repository's
  binary-verified finding
  (`docs/solutions/integration-issues/precompact-hook-stdout-contract.md`)
  remains the operative contract. PRD R1 keeps both settings untouched.
- **Sessions** (`/docs/en/agent-view`, `/docs/en/how-claude-code-works`):
  `--resume <id>` / `--continue` append to the same session; `--fork-session` or
  `/branch` copy history into a new session id; `/dispatch` and `claude --bg`
  start fresh independent sessions. The dedicated cross-session-messaging page
  could not be fetched, so message durability stays **not documented** (SRC08
  unchanged). These distinctions are engine-stage (R13) concerns and out of the
  foundation.

### Planning and validation surface (`source-inspected`, SRC12/SRC13/SRC16 re-read at `main`)

- Commands present under `plugins/yellow-core/commands/`:
  `flow/{brainstorm,compound,decompose,expand-shell,pick-next-shell,plan,review,spec,work}`,
  `plan/{complete,status}`, `setup/{all,claude-web}`, `stack/{select,status}`,
  `statusline/setup`, `worktree/cleanup`, `compound/review-staged`.
- `/flow:decompose` bails out to `/flow:plan` on a single shell.
  `/flow:pick-next-shell` reads every `plans/shells/*.md` with no feature
  filter; `plans/shells/` currently holds `yellow-jules-integration-01…05` and
  `yellow-council-v2-four-cli-03…05`, and `plans/specs/` holds
  `claude-code-codex-plugin-pilot`, `yellow-council-v2-four-cli` and
  `yellow-jules-integration`.
- `/plan:complete` line 60: `command -v gt >/dev/null 2>&1 || { … exit 1; }`
  before the `/stack:status` routing (`READY_GRAPHITE` / `READY_GITHUB`).
  Graphite is the enabled provider on this workstation
  (`gt-workflow@yellow-plugins: true`, `github-workflow` absent from
  `enabledPlugins`), so the prerequisite holds here; it remains a blocker for a
  GitHub-only environment exactly as SRC16 warned.
- Root `package.json` scripts confirmed: `validate:schemas` (marketplace,
  plugin, setup-all, agent-authoring, error-codes, snippets, solutions,
  generated, provider-groups, codex, cursor, flow-namespace, provider-neutral,
  council-roster, doc-counts), `validate:generated`, `validate:versions`,
  `validate:doc-counts`, `validate:plans`, `validate:agents`, `build`,
  `typecheck`, `lint`, `lint:plugins`, `test:unit` (Vitest on `packages/` plus
  `yellow-cursor` and `yellow-goal` package tests), `test:integration`,
  `format:check` (Prettier; not wired into CI workflows), `release:check`.
  yellow-core's own `package.json` test script is
  `bats skills/git-worktree/tests/ tests/`; the `tests/` suite has nine bats
  files (`compound-session-start-hook`, `compound-staging`,
  `compound-stop-hook`, `credential-status`, `plan-commands`,
  `plan-status-parity`, `pre-compact-hook`, `repo-profile`, `validate-fs`).
- Decision records: no ADR directory exists in yellow-plugins (only
  `docs/ADR_template.md`); design history lives in `docs/brainstorms/`,
  `plans/specs/`, `docs/solutions/`. Numbered ADRs exist in
  `yellow-goal/goal-gen` and are the engine's concern (PRD stage E).
- Distribution: manifests are generated from `catalog/`
  (`pnpm generate:manifests`, drift-gated by `pnpm validate:generated` and
  `tests/integration/generate-manifests-characterization.test.ts`); Codex/Cursor
  skill copies come from `plugins/<name>/skills/`. Changing a plugin file
  requires a changeset.

### Engine bridge (`source-inspected`, SRC14/SRC15 re-read at `main`)

`plugins/yellow-goal/` exposes `/goal:setup`, `/goal:request`, `/goal:run-stub`;
`src/` holds `cli.ts`, `spawn.ts`, `provider-process.ts`,
`provider-protocol.ts`, `runtime.ts`, `errors.ts`, `pin.ts`. It spawns
`version --json`, `capabilities --json`, `request create|validate` and
`run --executor stub --protocol v1` only, never `analyze` or `claude -p`, and
never imports engine source. CI's blocking `Released Goal Engine Compatibility`
job downloads the public v0.2.0 asset, checks its SHA-256 and runs read-only and
`run-stub` smokes. No lifecycle, checkpoint or rotation capability exists in the
pinned engine or the bridge; PRD stages E/P/B remain future work gated on a
released engine capability.

### Open-PR overlap (`documented` from `gh pr view`, 2026-09-17)

| PR                       | State on 2026-09-17                                                                             | Changed paths that matter here                                                                                                                                                                                        | Overlap                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| #797                     | Closed; queue-merged as `main` `3812fc66`                                                       | six `plugins/*/hooks/hooks.json` deletions, RULE 7, docs                                                                                                                                                              | Baseline; nothing to reconcile                                                                 |
| #798                     | Open, `mergeStateStatus: BLOCKED`; failing checks are Codacy and `claude-review`                | `scripts/lib/plugin-rules.js`, `scripts/validate-plugin.js`, `scripts/generate-manifests.js`, docs, characterization snapshot                                                                                         | Policy only; foundation adds no `hooks/hooks.json`                                             |
| #799                     | Open, `BLOCKED`; same two failing checks                                                        | `catalog/plugins/yellow-core.json`, `plugins/yellow-core/.claude-plugin/plugin.json`, eight other catalog sources and manifests, `generate-manifests-characterization` snapshot, `plugin-paths.js`, `plugin-rules.js` | **File-level collision** with any foundation edit to yellow-core's hooks block or the snapshot |
| #802                     | Open, `UNSTABLE`; same two failing checks                                                       | `plugins/gt-workflow/hooks/scripts/lib/policy-check-git-push.js`, github-workflow sibling, bats fixtures with real host envelopes                                                                                     | No path overlap; reference pattern for PRD R20 (`tool_input.*` field paths, real envelopes)    |
| #793                     | Open; checks passing except `claude-review` skipped                                             | `plans/specs/yellow-jules-integration.md`, `plans/shells/yellow-jules-integration-0{1,2,3,4}-*.md`, `plans/yellow-jules-integration-01-*.md`, `docs/CONCEPTS.md`, eleven solution docs                                | Shared `plans/shells/` namespace (T30); `docs/CONCEPTS.md` if glossary terms are added         |
| #750 (not in the packet) | Open; worktree `worktrees/yellow-plugins/agent-docs-claude-md-currency` has one unpushed commit | `docs/CLAUDE.md` and every `plugins/*/CLAUDE.md`                                                                                                                                                                      | Collides with foundation edits to `plugins/yellow-core/CLAUDE.md`                              |

`Codacy` is a non-required, login-gated check and `claude-review` needs
`CLAUDE_CODE_OAUTH_TOKEN`; neither failure was inspected for content and neither
is evidence about the PRs' fixes.

### Workspace state that affects kickoff (`source-inspected`)

- `workspace-meta/check-workspace.sh` fails on one invariant: the packet
  directory `session-continuity-packet/` sits at the harness root and is not in
  `ALLOWED`. It is reported here, not moved (another session may own it). The
  extracted packet also carries Windows `:Zone.Identifier` alternate-stream
  files; do not import those.
- yellow-plugins worktrees on this machine: `agent-docs-claude-md-currency`
  (#750), `agent-feat-yellow-goal-bridge`, `agent-fix-astra-bridge` — none
  belong to this feature. yellow-goal worktrees are unrelated and preserved.
- `docs/security.md` still lists a `context7` MCP server for yellow-core
  although the plugin README says it bundles none; unrelated drift, noted for
  the eventual security-doc update PRD R20 requires.
