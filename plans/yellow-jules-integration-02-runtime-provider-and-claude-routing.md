# Feature: Runtime, Provider Registration, and Complete Claude Routing (PR2)

## Overview

This shell ships the plugin as one atomic release boundary: the typed runtime
behind the adapter chosen by shell 01, the four read-only v0 commands
(`setup`, `list`, `status`, `collect`; `delegate`, `reply`, and `approve`
moved to shell 03 per the Open Question 6 decision, 2026-09-10), the
provider-local journal, artifact staging, and every consumer that must
recognize a third remote-agent provider (catalog, provider router, setup
coverage, Linear delegate route, root script filters, CI drift gates,
fixtures, changesets). The spec forbids shipping `READY_JULES` while any
consumer lacks handling for it, so this work lands and reverts as one PR even
though it will take more than one session; plan for continuity on a single
branch.

The human-authorized R53 smoke moved to after shell 03 (Open Question 6
decision, 2026-09-10); shell 03 produces its procedure and result template,
and this shell produces only the fake-server test layers.

## Origin

- Spec: `plans/specs/yellow-jules-integration.md`
- Covers: R1, R2, R4, R5, R7, R9-R23, R25-R27, R35-R37, R40, R42, R50, R51;
  partial: R3 (adapter-implementation), R6 (build-configuration), R8
  (v0-commands), R24 (stub-dispatch-branch), R28
  (pr2-changesets-counts-docs), R49 (test-layers), R52
  (pr2-read-only-scenarios-and-zero-mutating-request-test)
- Shell: yellow-jules-integration-02-runtime-provider-and-claude-routing
- Upstream: `plans/complete/yellow-jules-integration-01-contract-and-sdk-investigation.md`
  (its five docs under `docs/yellow-jules/` are the binding inputs)

## Decisions Carried Into This Plan

- **Transport: SDK adapter** (`docs/yellow-jules/contract-v1.md` "Transport
  verdict"; all four R3 criteria `packed-artifact-tested` pass). The shell's
  Open Question 2 therefore resolves to its SDK branch: the packed-SDK suite,
  the `packed-artifact-tested` label, R50's two cache fixtures, and R52's
  SDK-module-loading and installed-cache-execution scenarios all apply as
  written. No REST adapter ships.
- **Module strategy: CJS `module: node16` with a dynamic-import boundary**
  (contract "Module-strategy verdict"). No `"type": "module"`; no
  marketplace-wide module change.
- **Session-overload (shell Open Question 1), owner decision at expansion
  2026-09-29:** one branch, one commit per checkpoint, submitted as a **draft
  PR after Checkpoint 1** so CI runs on every push; marked ready only when all
  five checkpoints and the enumeration-site checklist are done. Intermediate
  draft CI may be red on manifest/provider checks until Checkpoint 4; only the
  final head must be green. Never split into a stack: the PR lands and reverts
  as one (R25).
- **R50 without a mutating runtime path.** PR2 compiles no vendor-mutating
  runtime operation (R52 PR2 negative test), yet R50 requires create, 429/5xx,
  lost-2xx, and cache fixtures. Resolution: `src/sdk-adapter.ts` exports the
  pure builders `buildClientOptions()` and `buildCreateSessionConfig()` plus
  the error classifier `classifyAdapterError(err, phase)`; the packed-SDK
  transport suite drives the pinned SDK **directly from test code** with those
  builders against the fake server. The shipped runtime never calls
  `session(config)`, `send()`, or `approve()` in PR2; shell 03 wires them. The
  runtime-level zero-mutating-request test (R52) runs every shipped subcommand
  and asserts the fake server saw no `POST`/`PATCH`/`PUT`/`DELETE`.
- **External sessions.** Every session PR2 can observe was created outside
  yellow (no `delegate` yet). `status`/`collect` on a `sessions/{id}` absent
  from the journal mint a local id and write an operation record with
  `origin: "external"`; R13's `policy-deviation` applies only to records whose
  create requested `autoPr: false` (reachable in PR2 only through
  test-planted create records). This is recorded as an additive note in
  `contract-v1.md` (the contract permits PR2 revisions with a note).

## Pattern Survey

Surveyed at `main` `f6ee1ffa` (2026-09-29). Line numbers are current
re-anchors; the brainstorm locators at `6a0bcc87` are stale.

**yellow-cursor is the template** (`plugins/yellow-cursor/`, CJS, committed
`dist/`, no per-plugin vitest config, `"test": "vitest run --dir tests"`,
`engines.node ">=22.22.0 <25.0.0"`, `tsconfig.json` extends
`../../tsconfig.base.json` with `module`/`moduleResolution: node16`,
`rootDir: src`, `outDir: dist`, no declarations or maps).

- `src/config.ts` — `hasEnvApiKey` :18, `resolveDataDir` :46
  (`YELLOW_CURSOR_DATA_DIR` > `XDG_DATA_HOME/yellow-cursor` > platform
  default, `path.win32` on win32), `resolveRuntimeDir` :75,
  `resolveStateFilePath` :79, `resolveStateDir` :83.
- `src/errors.ts` — `AdapterErrorKind` :10, `AdapterError` :27,
  `AppErrorCode` :48, private `CODE_TABLE` ~:88, `makeAppError` :155,
  `AppErrorException` :175, `throwAppError` :185, private `KIND_TO_CODE`
  ~:197, `mapAdapterError` :207, `toAppError` :216.
- `src/redact.ts` — `redact` :28, `assertNoSecretShapedValues` :67,
  `redactDeep` :96; `liveApiKeyPatterns()` hardwires `CURSOR_API_KEY`;
  `PREFIXED_SECRET_RE` is `(sk|pk|key|tok|cursor)[-_]…`; `SECRET_FIELD_NAMES`
  includes `prompt`.
- `src/validate.ts` — `validateRef` :65, `validateIdempotencyKey` :156,
  `validateCursor` :350 (page-token shape precedent).
- `src/types.ts` — `CapabilityResult<T>` :79, `SdkAdapter` :117, `Clock` :144.
- `src/state.ts` — `readIndex` :98 (corrupt file renamed `.corrupt-<ts>` and
  **continues empty** — Jules must diverge: R37 blocks instead),
  `writeIndex` :140 (temp `.agents.json.tmp-<pid>-<uuid>` mode 0600 + rename
  + chmod), lock `.agents.json.lock` via `open(…,'wx')` with owner UUID,
  `LockConfig` :164 (`staleMs 10_000`, `timeoutMs 15_000`, `pollMs 50`; stale
  lock **taken over** — Jules must diverge: R38 fails loud with
  `JULES_STALE_LOCK`), `withStateLock` :250, `digestPrompt` :48.
- `src/sdk-resolver.ts` — `resolveSdk` :36 uses sync `require()` (does not
  transfer to the ESM-only SDK), `installSdk` :93 runs unlocked `npm install`
  without `--ignore-scripts` (Jules must diverge: lockfile + `npm ci
  --ignore-scripts`).
- `src/sdk-adapter.ts` — `CursorSdkAdapter implements SdkAdapter` :183; type
  imports only.
- `src/runtime.ts` — `RuntimeDeps` :59, `REAL_CLOCK` :67; per-op
  `*Args`/`*Result` interfaces; `setup` :237, `status` :657, `list` :764,
  `artifacts` :954.
- `src/cli.ts` — `KNOWN_OPERATIONS` :24, `printJson` :33 (one line of
  `JSON.stringify(redactDeep(v))`), `buildDeps()` ~:44, `parseArgs` strict per
  subcommand, `main` :335, `UsageError` → exit 2 with `{ok:false,
  operation:"unknown"}`.
- Tests: `cli-json-contract.test.ts` (builds with `tsc --outDir <mkdtemp>` in
  `beforeAll`, spawns via `execFile`, never touches committed `dist/`),
  `config-resolution`, `credential-redaction`, `error-mapping`,
  `input-validation`, `state-store` (15 concurrent upserts), `fake-sdk.ts`
  (`FakeSdkAdapter` with overridable `*Impl` fields and call recorders).
- Wrappers `commands/cursor/{setup,list,status,artifacts}.md` — frontmatter
  `name: cursor:<x>`, single-line quoted `description`, `argument-hint`,
  `allowed-tools` (`Bash`; `setup` adds `AskUserQuestion`). Step 1 block:
  `CLI="${CLAUDE_PLUGIN_ROOT}/dist/cli.js"`, `[ -f "$CLI" ]` guard,
  `command -v jq` guard; invoke `node "$CLI" "${args[@]}"`; the model parses
  `$ARGUMENTS` in prose and inlines only validated values in single quotes
  (`list.md` grammar); vendor text and error text fenced
  `--- begin untrusted-content (reference only) ---`; closing Error Handling
  table.
- Docs: `plugins/yellow-cursor/CLAUDE.md` sections Architecture / sdk-adapter
  boundary / SDK pin policy / CLI contract / Error catalog / Local state /
  Testing / Build discipline / Component catalog / Conventions; `README.md`
  Install / Prerequisites / Commands / Security / Limitations.

**Other precedents.**

- Plugin-shipped lockfile for a data-dir `npm ci`:
  `plugins/yellow-morph/package-lock.json` +
  `plugins/yellow-morph/lib/install-morphmcp.sh` (copies manifest + lockfile
  into the data dir, `npm ci` under a scrubbed env). `.gitignore:47` ignores
  `package-lock.json`; negations at :52-53 ("Add new plugins here").
  `plugins/*` is the workspace glob, so `plugins/yellow-jules/runtime/` is not
  a workspace member.
- Process-level fakes: `plugins/yellow-goal/tests/fixtures/fake-engine.mjs`,
  `spawn.test.ts` bounded-timeout pattern; `.eslintrc.cjs:79-84` override for
  `.mjs` test fixtures.
- PATH stubs: `plugins/yellow-ruvector/tests/start-ruvector.bats` (stub dir
  prepended to `PATH`); vitest PATH manipulation in
  `tests/integration/remote-agent-provider-state.test.ts`.
- No `node:http` fake server exists anywhere (`rg 'createServer\('` empty);
  `tests/fake-http-server.ts` productizes `docs/yellow-jules/sdk-investigation.md`
  Appendix A.
- CI has npm-registry access in `unit-tests` (`validate-schemas.yml`
  ~:729-772) and in the fork workflow, so the packed suite may `npm ci` from
  the shipped lockfile; do not vendor the tarball.

**Provider router and consumers.**

- `plugins/yellow-core/lib/remote-agent-provider-state.js` — header :3-6
  (Cursor or Devin only), :12 stale "only consumer" docstring, :23-27 "Both
  providers MAY be installed"; `PROVIDER_GROUP` :73; `// provider-table:start`
  :74, rows :76-77 (exact `Object.freeze({ id: '…', plugin: '…' })` form the
  validator's `ROUTER_ENTRY_RE` requires), `:end` :79;
  `PREFERRED_PROVIDER_ID` :85; `STATES` :91 ("six states"),
  `READY_STATE_BY_ID` :101; `classifyRemoteAgentState` :178 (CONFLICT detail
  :224, UNSELECTED :238/:241, PARTIAL_TOOLING :253); `parseToolingFlag` :312;
  `main` :322 reading `--tooling-cursor`/`--tooling-devin` :355-356; usage
  :39-41; exports :369. Importers: `linear/delegate.md:81,152,180`,
  `setup/all.md:812`, `scripts/validate-provider-groups.js:102`, two
  integration tests.
- `plugins/yellow-core/commands/setup/all.md` — credential probes :153-181
  (`CURSOR_API_KEY` :161-166); dashboard plugin loop markers
  `setup-all-dashboard-plugin-loop` :342-350 (list at :343); "Remote-Agent
  Provider Tooling" probe :388-418 (filter
  `row.id === "yellow-cursor@yellow-plugins"` :406, `cursor_cli_resolved`
  :414-418); `setup-all-classification` :477-747 (`**yellow-cursor:**`
  :539-557, `**yellow-devin:**` :559); `setup-all-dashboard-example` :751-780
  (rows :762-763); Step 2.5 :785, `setup-all-provider-groups` :792-799
  (`remote-agent` :796-798); acceptable-state text :822-823;
  `PARTIAL_TOOLING` mapping :836; `setup-all-delegated-commands` :892-912
  (:896-897); `setup-all-plugin-command-map` :918-938 (:923-924). The last
  three marker blocks are **not** on shell 01's checklist but
  `validate-setup-all.js` enforces them.
- `plugins/yellow-linear/commands/linear/delegate.md` — description :3,
  `argument-hint` :4, provider prose :20-34, `--provider` validator :40-41,
  tooling probes :160-166, inline-Node classifier :169-180 (`argv[3]` cursor,
  `argv[4]` devin; jules becomes `argv[5]`), READY mapping :202-203,
  CONFLICT override :204-206, packet display :288-301,
  `PROVIDER="cursor"` :388, dispatch :311/:551/:566-573, report :613-628,
  error table :655-666. `plugins/yellow-linear/tests/delegate.bats` pins
  text: the Step 3 heading, `resolve_plugin_root`, `--idempotency-key`/`--yes`
  in the cursor block, `devin:delegate` (:43), "overriding only the CONFLICT
  state" (:199), absence of `api.devin.ai`/`curl`/`../yellow-cursor`. Keep
  those phrases.
- `scripts/validate-provider-groups.js` — stale header :4-7 ("currently only
  `stacked-pr`"); `ROUTER_TABLES` :91; `validateSetupAllSection` :455;
  `validateOneRouterTable` :570; `MIN_GROUP_MEMBERS = 2`;
  `ERROR-PROVIDER-001..007` assembled by concatenation (`'ERROR-' +
  'PROVIDER'`) to satisfy `scripts/lint-error-codes.js`; codes registered in
  `packages/domain/src/validation/errorCatalog.ts` (~:459 category array).
  Tests: `tests/integration/validate-provider-groups.test.ts`
  (`VALIDATE_PROVIDER_GROUPS_ROOT`, `REMOTE_AGENT_PROVIDERS`, remote-agent
  describe :371-443).
- `tests/integration/remote-agent-provider-state.test.ts` — :65-78 hardcode
  the two-provider table; "six states" title :80; fixtures under
  `tests/integration/fixtures/remote-agent-provider/` (six JSON + README; flat
  arrays of `{id, version, scope, enabled, installPath, installedAt,
  lastUpdated}`).

**Wiring and release.**

- Root `package.json` — `typecheck` :16 and `test:unit` :18 chain
  `pnpm --filter yellow-cursor …` and `pnpm --filter yellow-goal …`;
  `validate:schemas` :20; `build` :14 is `pnpm -r run build` (automatic).
- `.github/workflows/validate-schemas.yml` — build job drift checks
  :1179-1189 (use the yellow-goal form
  `test -z "$(git status --porcelain --untracked-files=all -- …/dist)"`, not
  cursor's `git diff --exit-code`, which misses untracked files);
  `validate-schemas-fork.yml` matrix :76-87, timeout special-case :68,
  `yellow-goal)` arm :234-239. `.gitignore` dist negations :58-61 (after the
  `**/dist/` ignores at :56-57).
- `catalog/catalog.json` `pluginOrder` :10-32 (`yellow-cursor` :17,
  `yellow-devin` :18). Characterization snapshot
  `tests/integration/__snapshots__/generate-manifests-characterization.test.ts.snap`
  changes in three places (marketplace bytes, inventory, new per-plugin
  block).
- Counts: marketplace has 19 plugins today; claims to move to 20 at
  `CLAUDE.md:10`, `README.md:3`, `docs/architecture-overview.md:3,60`
  (`scripts/validate-doc-counts.js`, run by `release:check`); unvalidated but
  stale: `README.md:33-35` table and ~:272 tree,
  `docs/architecture-overview.md:70,106,139,249`, `AGENTS.md:20-21`,
  `plugins/yellow-core/CLAUDE.md:294-296`, `plugins/yellow-linear/CLAUDE.md:~97-101`.
- `docs/upstream-pins.md` — Cursor has a prose section (:39-66), not a table
  row; add an `@google/jules-sdk` section in the same form carrying the pinned
  tree. `scripts/check-upstream-pins.js` picks up exact plugin pins
  (advisory).
- Changesets: new plugin is `minor` (precedent `cursor-initial-release.md`
  in `575f8cd8`, `yellow-goal-bridge.md` in `c9733b8c`, which also carried
  `core-remote-agent-group.md` and `linear-provider-neutral-delegate.md`).
- `pnpm lint:plugins` does not inspect command markdown;
  `pnpm validate:agents` applies to commands (RULE 21 500-line warning,
  `allowed-tools` must match use); command `description:` single-line is a
  review-only rule; fenced blocks must pass `pnpm validate:shell-compat` and
  `pnpm check:shell-parse` (bash + zsh with `noclobber`).
- `pnpm-lock.yaml` must be regenerated (CI installs `--frozen-lockfile`).

**Learnings that constrain this plan** (spec "Prior learnings" plus survey):
`docs/solutions/code-quality/golden-fixture-parity-vs-contract-correctness.md`
(packed tests prove request shape/count/side effects, not response
compatibility), `unhandled-outcome-defaults-to-success-bucket.md` (unknown
states → `needs-inspection`; unknown after-dispatch errors →
`JULES_UNKNOWN_OUTCOME`), `security-issues/bash-to-node-port-drops-fail-closed-and-bounds.md`
and `shell-binary-downloader-security-patterns.md` (install path),
`code-quality/bash-block-subshell-isolation-in-command-files.md` (wrappers),
`logic-errors/manifest-generator-value-shape-validation.md` (catalog shapes).

## Implementation

### Checkpoint 0 — Branch and worktree

- [x] Step 0.1: Run `/stack:status`; proceed only on `READY_GRAPHITE` or
  `READY_GITHUB`. Create branch `agent/feat/yellow-jules-pr2-runtime` through
  that provider's own commands in worktree
  `../worktrees/yellow-plugins/agent-feat-yellow-jules-pr2-runtime/`
  (workspace layout rule: one worktree per active PR, `agent/` prefix, never
  inside the clone). Check `git -C <clone> worktree list` first so no other
  session already owns the slug. All later steps run in that worktree.

### Checkpoint 1 — Package scaffold, config, errors, redaction, validation, journal

- [x] Step 1.1: Scaffold `plugins/yellow-jules/package.json`
  (`"name": "yellow-jules"`, `"version": "0.1.0"`, `"private": true`, no
  `"type"`, scripts `build`/`typecheck`/`test` identical to yellow-cursor,
  `"dependencies": { "@google/jules-sdk": "0.2.0" }` exact,
  devDependencies matching yellow-cursor, `"engines": { "node": ">=22.22.0 <25.0.0" }`)
  and `plugins/yellow-jules/tsconfig.json` (copy of yellow-cursor's:
  `module`/`moduleResolution: node16`, `rootDir: src`, `outDir: dist`). Run
  `pnpm install` to update `pnpm-lock.yaml`.
- [x] Step 1.2: Add the data-dir install manifest
  `plugins/yellow-jules/runtime/package.json` (private, single exact
  dependency `@google/jules-sdk: 0.2.0`) and generate
  `plugins/yellow-jules/runtime/package-lock.json` with
  `npm install --package-lock-only --ignore-scripts` inside that directory so
  every package (`yaml`, `zod`, transitive) carries an `integrity` hash. Add
  `!plugins/yellow-jules/runtime/package-lock.json` after `.gitignore:53`
  (morph/ruvector lockfile negations) and `!plugins/yellow-jules/dist/`
  after `.gitignore:61`.
- [x] Step 1.3: `src/config.ts` — copy yellow-cursor's `resolveDataDir`
  precedence with `YELLOW_JULES_DATA_DIR` > `$XDG_DATA_HOME/yellow-jules` >
  platform default (R35); `hasEnvApiKey()` reading `JULES_API_KEY`;
  `resolveRuntimeDir`, `resolveStateDir` (`<dataDir>/state`),
  `resolveJournalPath` (`state/journal.json`), `resolveLockPath`
  (`state/.lock`), `resolveArtifactsDir` (`<dataDir>/artifacts`),
  `resolveSdkScratchDir` (`<dataDir>/sdk-scratch`); and
  `assertOwnerOnlyDir(path)` enforcing `0700` dirs / `0600` files, owner ==
  `process.getuid()`, refusing group/world-writable or non-owned paths and
  symlinks with `JULES_DATA_DIR` — called on the data dir, `state/`,
  `sdk-scratch/`, and `runtime/` by **every** invocation that reads state or
  resolves the SDK (contract "Local state"). Refuse a data dir that resolves
  under the plugin root or a git work tree containing the cwd (R15).
- [x] Step 1.4: `src/errors.ts` — `AppErrorCode` union and module-private
  `CODE_TABLE` holding exactly the 22 `JULES_*` codes and default
  `recoveryAction` strings from contract-v1 "Error catalog"; `AppError`,
  `makeAppError` (call-site `recoveryAction` override), `AppErrorException`,
  `throwAppError`, `toAppError`; a transport-neutral `AdapterErrorKind`
  union (`auth`, `rate-limited`, `source-not-found`, `not-found`,
  `invalid-request`, `server-error`, `network`, `invalid-state`, `timeout`,
  `malformed`) with `AdapterError` and `KIND_TO_CODE` for the pre-dispatch
  column, plus `mapAdapterError(err, phase: 'pre-dispatch' | 'read' | 'after-dispatch')`
  applying the after-dispatch column and the default rule (anything not a
  clear rejection after dispatch → `JULES_UNKNOWN_OUTCOME`, R16) (integration
  plan "PR2 checklist additions": the port and error-kind union).
- [x] Step 1.5: `src/redact.ts` — copy of yellow-cursor's `redact`,
  `redactDeep`, `assertNoSecretShapedValues`, with `liveApiKeyPatterns()`
  reading `JULES_API_KEY`, an `X-Goog-Api-Key` header layer, `AIza` added to
  the prefixed-secret shapes (`cursor` dropped), `SECRET_FIELD_NAMES`
  including `prompt`, and `truncateRedacted(text, 512)` for vendor error text
  (contract "Redaction" layers 1-6). Add `scanSecretShapes(buffer)` (layers
  1-4, returns boolean) for staged artifacts (layer 8) and
  `fenceUntrusted(text)` with delimiter-forgery escaping copied from
  `plugins/yellow-core/skills/security-fencing/SKILL.md` (layer 7).
- [x] Step 1.6: `src/validate.ts` — copies of `validateRef` and
  `validateIdempotencyKey`; anchored validators for every row of contract
  "Identifier allowlist": `validateSessionId`, `validateSessionResource`,
  `validateActivityId`, `validateActivityResource`, `validatePlanId`,
  `validateSourceResource`, `validateRepoInput`, `validateBaseCommitId`,
  `validatePullRequestUrl(url, sourceResource)` (parse-then-compare),
  `validateSessionDisplayUrl` (https-only, display-only),
  `validatePageToken`, `validateLocalId` (`^jl-[0-9a-f]{32}$`),
  `mintLocalId()` (`jl-` + 16 random bytes hex), `extractTitleTag`
  (`^\[yellow:(jl-[0-9a-f]{32})\](?: |$)`), `validateTaskRef`/request id
  (`^[A-Za-z0-9._:-]{1,200}$`, rejecting `__proto__`, `constructor`,
  `prototype`). Input failures → `JULES_INVALID_INPUT`; API-returned failures
  → `JULES_MALFORMED_RESPONSE` (R7).
- [x] Step 1.7: `src/types.ts` — `CapabilityResult<T>`, `Clock`, the
  transport-neutral `SdkAdapter` port with **read-only** methods for PR2
  (`getSession(id)`, `listSessions({pageSize, pageToken, filter})`,
  `listActivities(id, {pageSize, pageToken, filter})`, `getSource(owner, repo)`,
  `listSources({pageSize, pageToken})`, `close()`), and the journal record
  types from spec "Data model": `OperationRecord` (R35 fields plus
  `origin: "yellow" | "external"`, read-state `lastActivityCreateTime`,
  `lastActivityId`, `resumePageToken?`, `recentActivityIds`,
  `activityCount`, `pendingPlan?`, `artifactResumePageToken?`,
  `resumeRestartCount`), `ArtifactRecord` (`verification` initialized
  `"unverified"`, never optional), `DeviationRecord` (`policy-deviation` with
  external PR reference, R13). No mutating method appears on the PR2 port.
- [x] Step 1.8: `src/state.ts` — journal store under `state/`: `readJournal()`
  (maps built with `Object.create(null)`; any parse or shape failure throws
  `JULES_JOURNAL_CORRUPT` and **never** renames or replaces the file, R37),
  `writeJournal()` (temp file `journal.json.tmp-<pid>-<uuid>` mode 0600,
  fsync, rename, chmod; every record passes `assertNoSecretShapedValues`
  first; `promptDigest` only), `withJournalLock(fn)` (`open(lockPath,'wx')`
  with owner UUID + pid + hostname + start time; bounded wait of
  `timeoutMs`; a lock whose holder pid is dead on this host or older than
  `staleMs` fails loud with `JULES_STALE_LOCK` and is **never** taken over,
  R38 contract "Local state"), `reserveOperation()` (reservation-first write,
  R36), `findUnresolvedOperations({repository, requestedBranch, taskRef?})`
  (`reserved` or `unknown-outcome`, R36 — used by PR3 `delegate`, unit-tested
  here), `markOperation(localRequestId, status)`, `upsertReadState()`
  (callable only from the `status` path), `upsertArtifactResumeToken()`
  (callable only from `collect`), `recordDeviation()`, and retention that
  drops the dedup ring and both resume tokens once a record is terminal.
  `state/grants.json` is never read in PR2.
- [x] Step 1.9: Tests for Checkpoint 1 under `plugins/yellow-jules/tests/`:
  `config-resolution.test.ts` (precedence, platform defaults, owner-only
  refusal incl. `YELLOW_JULES_DATA_DIR` override, symlink refusal, refusal
  under plugin root), `credential-redaction.test.ts` (all eight layers,
  512-byte truncation, `X-Goog-Api-Key`, `AIza…`, artifact scan),
  `input-validation.test.ts` (every allowlist row incl. `..`, `.github`,
  prototype keys, title-tag anchoring, PR-URL owner/repo mismatch),
  `error-mapping.test.ts` (every SDK-class row by phase, the default rule,
  most-derived-first), `state-store.test.ts` (round-trip, concurrent
  `withJournalLock` writers, corrupt journal blocks writes and is left
  byte-identical, stale lock fails loud and is left in place, reservation
  lookup, retention). Run `pnpm --filter yellow-jules test` and
  `pnpm --filter yellow-jules typecheck`.
- [x] Step 1.10: Commit (`feat(yellow-jules): scaffold package, config, errors, redaction, validation, journal`)
  and submit as a **draft PR** through the active stack provider. The PR body
  starts with the literal enumeration-site checklist from
  `docs/yellow-jules/integration-plan.md` "PR2 enumeration-site checklist",
  extended with the three `setup/all.md` marker blocks the survey found
  (`setup-all-dashboard-example`, `setup-all-delegated-commands`,
  `setup-all-plugin-command-map`) and the checkpoint list; note that draft CI
  is expected red on manifest/provider checks until Checkpoint 4.

### Checkpoint 2 — SDK resolver, adapter, runtime, CLI

- [x] Step 2.1: `src/sdk-resolver.ts` — `resolveSdk(deps)`: run
  `assertOwnerOnlyDir` first; resolve `@google/jules-sdk/package.json`
  through the workspace (`createRequire(__filename)`) then
  `<dataDir>/runtime/node_modules` (`createRequire` rooted there); read
  `exports["."].import`; for the data-dir branch verify the entry file's
  sha256 against `runtime/pin.json` `sdkEntrySha256` and every installed
  package's version against `pin.json`'s recorded tree (mismatch →
  `JULES_SDK_INTEGRITY`); load with
  `await import(pathToFileURL(entry).href)` (never `require.resolve` or a bare
  specifier); none found → `JULES_SDK_MISSING`. `probeSdkResolution()` for
  `setup`. `installSdk(deps)`: only on explicit `--install-sdk`; copy
  `runtime/package.json` and `runtime/package-lock.json` from the plugin root
  (`path.join(__dirname, '..', 'runtime')`) into `<dataDir>/runtime/`; run
  `npm ci --ignore-scripts --no-audit --no-fund` with `shell: false`, a
  scrubbed env (no `JULES_API_KEY`, no `NODE_OPTIONS`), cwd
  `<dataDir>/runtime`, and a bounded timeout; on any failure remove
  `<dataDir>/runtime/node_modules` entirely before returning (EINTEGRITY is
  post-stream); on success write `runtime/pin.json` with `sdkVersion`,
  `sdkIntegrity` (from the lockfile), `sdkEntrySha256`, and the verified tree
  (R4, contract `setup`). Never installs per task.
- [x] Step 2.2: `src/fetch-guard.ts` — `installFetchGuard({ allowedOrigins, readTimeoutMs, onPostDispatch })`
  wrapping `globalThis.fetch` exactly once (second install throws): refuse any
  origin other than `https://jules.googleapis.com` (plus loopback origins
  wired only by the test seam), refuse non-`https:` except that loopback,
  force `redirect: "manual"` and **throw** on any 3xx, race a 30 000 ms
  `AbortController` on non-POST requests, and record POST dispatch time
  (contract "Network guard").
- [x] Step 2.3: `src/test-seam.ts` — the only path to a loopback `baseUrl`:
  an exported `__setTestTransport({ baseUrl, allowedOrigins })` that the CLI
  consults, called only by `tests/support/loopback-preload.cjs` (loaded with
  `node --require`) or in-process tests. It is never read from config, env,
  or argv; `baseUrl` must parse as `http(s)://127.0.0.1:<port>`.
- [x] Step 2.4: `src/sdk-adapter.ts` — the only file that touches the SDK API
  (type imports from `@google/jules-sdk` plus the module namespace handed in
  by the resolver, R2). Export `buildClientOptions({ apiKey, baseUrl? })`
  returning exactly the contract `connect()` shape (`config.requestTimeoutMs:
  60000`, nested `rateLimitRetry: { maxRetryTimeMs: 0 }`, `storageFactory`
  recording every `MemoryStorage`/`MemorySessionStorage` it creates);
  `buildCreateSessionConfig({ prompt, source, baseBranch, title })` returning
  `{ requireApproval: true, autoPr: false, … }` (pure builder for the
  transport suite; **not called by the runtime in PR2**, R12); and
  `classifyAdapterError(err, phase)` using `instanceof` most-derived first.
  `JulesSdkAdapter implements SdkAdapter`: create `<dataDir>/sdk-scratch`
  (`0700`) and prove it writable before `connect()`, set `JULES_HOME` for
  this process only, assert after `connect()` that `client.storage` is the
  injected session storage and on first per-session use that activity storage
  came from the factory (mismatch → `JULES_SDK_INTEGRITY`), assert
  `sdk-scratch/` is empty after `connect()` and in `close()`; `getSession`
  = at most one `session(id).info()` per session per process (R15 fresh read);
  `listSessions` = one awaited `jules.sessions({ pageSize, pageToken, filter, persist: false })`
  page; `listActivities` = `session.activities.list({ pageSize, pageToken, filter })`;
  `getSource`/`listSources` via `jules.sources()`/`sources.get()`. Validate
  every returned id before returning it (R7); carry the raw REST state when it
  differs from `unspecified` (R10). Never call `run`, `all`, `result`, `ask`,
  `waitFor`, `stream`, `updates`, `history`, `hydrate`, or `sync` (R9).
- [x] Step 2.5: `src/activity-walk.ts` — the single walk unit from contract
  "Activity walk": parameters `pageSize` (50 / 10 for collect), start point
  (watermark filter, resume token, or session start), `writeReadState`
  capability (true only for `status`), page cap 20, deadline; stops on page
  cap, page failure, deadline, or unmappable activity with
  `partialPagination: true` (+ `unmappedActivity: true`), never a manufactured
  end (R18); dedup ring (5-minute overlap window, 1000 cap,
  `dedupWindowExceeded`); watermark advances only on a complete walk; resume
  token recorded on a partial walk and discarded on 400/404 or no progress
  with `JULES_NO_PROGRESS` on the second consecutive no-progress restart;
  `pendingPlan` rule (newest `planGenerated` replaces, `planApproved`
  clears); filtered-request `400` retried once unfiltered.
- [x] Step 2.6: `src/runtime.ts` — `RuntimeDeps` (`adapterFactory`, `clock`,
  `env`, `dataDir`), bounded read retry helper (2 retries, 500 ms exponential
  backoff with jitter, 5xx/network only, never on 429, inside the absolute
  deadline, R14), and the four read operations:
  - `setup({ installSdk })` → contract `setup` shape; credential presence
    only (value never read into output), `probeSdkResolution`, optional
    `installSdk`, one sources page (`pageSize` 20, `truncated`), non-GitHub
    source degrades to `{ supported: false, reason }`.
  - `list({ limit, pageToken })` → one `listSessions` page, page-scoped
    `journalOnly`, `title` with the tag stripped and surfaced as `localId`.
  - `status({ session?, reconcile })` → one `getSession`, the activity walk
    from the watermark with read-state writes under `withJournalLock`,
    `vendorState` + normalized `condition` per contract "Status results"
    (unknown → `needs-inspection`, R10), `outputs`, and R13: a
    `pullRequest` output on a record whose create requested `autoPr: false`
    records a `policy-deviation` and sets `policyDeviation: true`; an
    external session is minted a local id on first sight (`origin:
    "external"`). `--reconcile` returns `reconciled: []` in PR2 (no
    reservations are reachable). `status`/`list` on a corrupt journal return
    `JULES_JOURNAL_CORRUPT` (R37).
  - `collect({ session })` → one `getSession` (`outputs[]`,
    `generatedFiles`) plus the activity walk (`pageSize` 10, from
    `artifactResumePageToken` or session start); stage under
    `<dataDir>/artifacts/<local-id>/` only (`patch.diff`,
    `generated/<nn>-<sha256[0:12]>`, `manifest.json` recording vendor paths
    as data); `baseCommit` validated and recorded separately from the
    requested branch (R20); `pr-ref` artifacts for vendor PRs as external
    references only (R42); `secretShapedContent` from `scanSecretShapes`;
    100 MiB aggregate cap → `skipped` + `partialStaging`;
    `noSupportedArtifact: true` only when both partial flags are false (R19);
    artifacts on a session with an unreconciled deviation are marked;
    never touches a checkout (R40).
  - Unsupported capabilities (`cancel`, `pause`, `resume`, cost,
    exactly-once) return `JULES_UNSUPPORTED_CAPABILITY` via a
    `CapabilityResult` reason (R11).
  Every result sets `requiresAttention`/`attention` per contract "Output
  envelope".
- [x] Step 2.7: `src/cli.ts` — `#!/usr/bin/env node`; `KNOWN_OPERATIONS =
  ['setup','list','status','collect']`; per-subcommand strict `parseArgs`
  (no positionals; `--deadline-ms` everywhere, defaults 120 000 for reads and
  180 000 for `collect`); `printJson` = one line of
  `JSON.stringify(redactDeep(v))`; stderr for diagnostics only; exit 0 / 1 /
  2 with a valid `{ok:false, operation:"<name>|unknown", error:{…}}` on usage
  errors (R7); install the fetch guard before building the adapter; any other
  subcommand name (including `delegate`, `reply`, `approve`) is a usage error
  in PR2.
- [x] Step 2.8: `tests/fake-sdk.ts` (`FakeSdkAdapter implements SdkAdapter`
  with overridable `*Impl` fields and call recorders, mirroring
  `plugins/yellow-cursor/tests/fake-sdk.ts`) and fake-adapter suites:
  `runtime-status.test.ts` (condition mapping incl. unknown states, activity
  paging, duplicate activities, partial pagination at page failure / cap /
  deadline / unmappable, watermark and resume-token rules, `JULES_NO_PROGRESS`,
  dedup-window overflow, `pendingPlan`, policy deviation on a planted create
  record, external-session minting, `--reconcile` empty),
  `runtime-list.test.ts` (page-scoped `journalOnly`, tag stripping, offline
  list), `runtime-collect.test.ts` (all artifact kinds, base recording,
  no-supported-artifact vs truncated, aggregate cap, secret-shaped content,
  staging path from local id only, nothing written outside the data dir),
  `runtime-setup.test.ts` (credential absence, SDK missing/workspace/data-dir,
  sources probe truncated and non-GitHub degrade, inaccessible source),
  `unsupported-capability.test.ts`. Build (`pnpm --filter yellow-jules build`),
  commit `dist/`, and commit the checkpoint (`feat(yellow-jules): SDK resolver, adapter, read-only runtime, and CLI`).

### Checkpoint 3 — Fake HTTP server, packed-SDK transport suite, offline coverage, wrappers

- [x] Step 3.1: `tests/fake-http-server.ts` — productized
  `docs/yellow-jules/sdk-investigation.md` Appendix A with its hardening list:
  `node:http` on `127.0.0.1:0` only (refuse any other bind), optional HTTPS
  mode with a self-signed certificate trusted only inside the test, request
  log `{method, path, apiKeyPresent, body}` (presence only, never the value
  or its length), routes for `GET/POST sessions`, `GET sessions/{id}`,
  `GET sessions/{id}/activities` (paged, one duplicate id across pages),
  `GET sources`, `GET sources/github/{owner}/{repo}`, `:sendMessage`,
  `:approvePlan`; scripted modes for 429/500/502/503/504, lost or invalid
  2xx, 302 cross-origin, 302 HTTPS→HTTP downgrade, 400 on filtered lists,
  404/403 sources; response bodies are illustrative shapes from
  `types.d.ts`. Plus `tests/support/loopback-preload.cjs` (calls the test
  seam) and `tests/support/path-traps.ts` (prepends a temp dir whose
  `claude`, `codex`, `gh`, `gt`, `jules`, `curl` stubs log argv and exit 97;
  every suite asserts the trap log is empty, R51).
- [x] Step 3.2: `tests/packed-sdk-transport.test.ts` — `beforeAll` installs
  the real pinned artifact once into a `mkdtemp` data dir by running the
  shipped `installSdk` path (`npm ci --ignore-scripts` from
  `runtime/package-lock.json`; this also exercises the install and `pin.json`
  verification), with an explicit suite timeout; `NODE_DISABLE_COMPILE_CACHE=1`
  and isolated `HOME`/`XDG_*`/`TMPDIR`/cwd. Scenarios (R50), each asserting
  the exact ordered server-side request sequence and distinguishing
  pre-dispatch failures from possibly-accepted writes via
  `classifyAdapterError`: explicit create flags through
  `buildCreateSessionConfig` (body has `requirePlanApproval: true`,
  `automationMode: "AUTOMATION_MODE_UNSPECIFIED"`, R12); POST
  429/500/502/503/504 with no replay (R14); lost and invalid 2xx; post-create
  cache failure; fresh GET after stale cache (`getSession` issues a network
  read); paginated and duplicate activities; changed pending plan; terminal
  output with patch / no-patch / PR / unknown artifact; cross-origin and
  downgrade redirects never forward `X-Goog-Api-Key`; filtered `400` retried
  once unfiltered; no writes under checkout, cache, `HOME`, `XDG_*`,
  `TMPDIR`, or the data dir's `sdk-scratch/` (`find -newer marker`); every
  contacted origin is loopback. Label these rows `packed-artifact-tested` in
  `docs/yellow-jules/capability-matrix.md` (R49).
- [x] Step 3.3: `tests/cli-json-contract.test.ts` and
  `tests/offline-coverage.test.ts` — build with `tsc --outDir <mkdtemp>` in
  `beforeAll` (never touching committed `dist/`), then spawn the CLI with the
  loopback preload. Cover the R52 PR2 set by name: credential absence;
  inaccessible source; invalid inputs; SDK module loading (workspace branch
  and data-dir branch; entry-sha mismatch → `JULES_SDK_INTEGRITY`; storage
  binding assertion); installed-cache execution (copy `dist/`,
  `package.json`, `runtime/` into a temp "plugin cache" with no
  `node_modules` and run with the SDK only in the data dir; none installed →
  `JULES_SDK_MISSING`); stdout/stderr/exit contract (exactly one stdout line,
  0/1/2); unknown states; duplicate activities; pagination; partial
  pagination; corrupt journal (reads); and the **negative test**: run every
  shipped subcommand (`setup`, `setup --install-sdk`, `list`, `status`,
  `status --reconcile`, `collect`) against the fake server and assert zero
  `POST`/`PATCH`/`PUT`/`DELETE` requests. (Generated manifest drift and
  provider conflicts/scope filtering are covered in Checkpoint 4.)
- [x] Step 3.4: Command wrappers `plugins/yellow-jules/commands/jules/setup.md`,
  `list.md`, `status.md`, `collect.md` modeled on
  `plugins/yellow-cursor/commands/cursor/{setup,list,status,artifacts}.md`:
  frontmatter `name: jules:<cmd>`, single-line quoted `description` with "Use
  when", `argument-hint`, `allowed-tools: [Bash]` (`setup` adds
  `AskUserQuestion` for install consent only); Step 1 CLI + `jq` guards; the
  model validates `$ARGUMENTS` in prose and inlines only allowlisted values
  (local id, `sessions/{id}`, page token, `--limit`, `--deadline-ms`) in
  single quotes; `node "$CLI" "${args[@]}"`; every vendor-writable string
  (title, plan steps, activity text, PR title/description, vendor paths,
  `error.message`) rendered inside the untrusted-content fence (contract
  "Redaction" layer 7); `requiresAttention` surfaced; closing Error Handling
  table. No API logic (R8). Run `pnpm validate:agents`, `pnpm lint:plugins`,
  `pnpm validate:shell-compat`, `pnpm check:shell-parse`.
- [x] Step 3.5: Drift check over the units copied from yellow-cursor
  (contract "Redaction" and integration-plan "PR2 checklist additions"): wrap
  each copied unit in `// replica:<unit>:start` / `// replica:<unit>:end` in
  both `plugins/yellow-cursor/src/{redact,validate,config,errors}.ts` and the
  yellow-jules copies (units: `validateRef`, `validateIdempotencyKey`,
  `assertNoSecretShapedValues`, `redactDeep`, the `resolveDataDir` body,
  the `AppError` shape); intentionally divergent lines (env var names,
  secret patterns) stay outside the markers or are normalized by a declared
  substitution map (`CURSOR`→`JULES`, `yellow-cursor`→`yellow-jules`). Add
  `scripts/validate-jules.js` (CRLF-normalized marker-slice comparison,
  missing-marker failure, `VALIDATE_JULES_ROOT` override, codes
  `ERROR-JULES-001..` assembled by concatenation and registered in
  `packages/domain/src/validation/errorCatalog.ts`), a `validate:jules`
  script, and chain it into root `validate:schemas`; tests in
  `tests/integration/validate-jules.test.ts`. Rebuild
  `plugins/yellow-cursor/dist` if its output changes. Commit the checkpoint
  (`test(yellow-jules): fake server, packed-SDK transport, offline coverage; feat: command wrappers and replica drift check`).

### Checkpoint 4 — Provider registration and every consumer

- [ ] Step 4.1: `catalog/plugins/yellow-jules.json` mirroring
  `catalog/plugins/yellow-cursor.json` with `capabilityProvider: { group:
  "remote-agent", id: "jules" }`, `lifecycle: { status: "experimental",
  installPolicy: "manual" }`, `targets: { claude: true, codex: { enabled:
  false } }`, no `cursor` target (R1, R21); add `yellow-jules` to
  `catalog/catalog.json` `pluginOrder` after `yellow-devin` (:18). Run
  `pnpm generate:manifests`, then
  `pnpm vitest run tests/integration/generate-manifests-characterization.test.ts -u`
  and review the three snapshot changes (marketplace bytes, inventory, new
  per-plugin block).
- [ ] Step 4.2: `plugins/yellow-core/lib/remote-agent-provider-state.js` —
  add `Object.freeze({ id: 'jules', plugin: 'yellow-jules' })` inside
  `// provider-table:start/end` in the exact existing row form; add
  `READY_JULES` to `STATES`/`READY_STATE_BY_ID`; read `--tooling-jules` in
  `main` beside :355-356 and update the usage comment :39-41; update
  diagnostics (CONFLICT :224, UNSELECTED :238/:241, PARTIAL_TOOLING :253) to
  name Jules as experimental while keeping yellow-cursor preferred; retain
  precedence `CONFIG_INVALID > CONFLICT > UNSELECTED > PARTIAL_TOOLING >
  READY_*` and `PREFERRED_PROVIDER_ID = 'cursor'`; correct the :12 docstring
  (consumers are `/linear:delegate` and `setup/all.md` Step 2.5) and the
  header :3-6, :23-27 (R22).
- [ ] Step 4.3: `tests/integration/remote-agent-provider-state.test.ts` and
  fixtures — update :65-78 to the three-provider table and the "six states"
  title; add fixtures for the seventh state (e.g. `jules-enabled.json`,
  `three-installed-jules-enabled.json`, `three-enabled.json`) and update the
  fixture `README.md`; cover READY_JULES, two- and three-provider
  CONFLICT, scope filtering, `--tooling-jules no` → PARTIAL_TOOLING, and all
  existing Cursor/Devin cases unchanged (R24 tests, R26).
- [ ] Step 4.4: `plugins/yellow-core/commands/setup/all.md` at every site
  (R23): `JULES_API_KEY` presence probe beside :161-166 (value never
  printed); `yellow-jules` in the `setup-all-dashboard-plugin-loop` list
  (:343); a `**yellow-jules:**` READY/PARTIAL/NEEDS SETUP block in
  `setup-all-classification` after :559; a dashboard-example row after
  :763; the "Remote-Agent Provider Tooling" probe (:388-418) extended to
  resolve `yellow-jules@yellow-plugins` and report `jules_cli_resolved`; the
  `remote-agent` membership list inside `setup-all-provider-groups` (:796-798)
  gains `` - `yellow-jules` → `jules` ``; the acceptable-state enumeration
  (:822-823) becomes "not `READY_CURSOR`, `READY_DEVIN`, `READY_JULES`, or
  `PARTIAL_TOOLING`"; the `PARTIAL_TOOLING` mapping (:836) adds
  `/jules:setup`; `setup-all-delegated-commands` (:892-912) gains
  `jules:setup` after `devin:setup`; `setup-all-plugin-command-map`
  (:918-938) gains the jules row. Wrap the tooling probe and the
  acceptable-state line in new marker pairs
  (`<!-- setup-all-remote-agent-tooling:start/end -->`,
  `<!-- setup-all-remote-agent-states:start/end -->`) for Step 4.7. Run
  `pnpm validate:setup-all`.
- [ ] Step 4.5: `plugins/yellow-linear/commands/linear/delegate.md` at every
  site (R24): description :3 and `argument-hint` :4
  (`--provider cursor|devin|jules`); provider prose :20-34 ("any two
  enabled"); the `--provider` validator :40-41 (exactly `cursor`, `devin`, or
  `jules`); a `TOOLING_JULES` probe beside :160-166 using
  `resolve_plugin_root yellow-jules dist/cli.js`; the inline-Node classifier
  :169-180 reading `argv[5]` and passing `"$TOOLING_JULES"`; `READY_JULES` →
  `jules` in the mapping :202-203; the CONFLICT override rule unchanged
  (`--provider` overrides only `CONFLICT`, never enables an absent or failed
  provider); a `**Jules.**` dispatch branch that is a fail-closed stub
  (prints "Jules delegation ships in PR3; use `--provider cursor|devin`",
  exits non-zero, makes no vendor call); a matching status/report branch; and
  an error-table row after :666. Wrap the `--provider` value list and the
  READY mapping in `<!-- linear-delegate-providers:start/end -->` markers.
  Keep every phrase `plugins/yellow-linear/tests/delegate.bats` pins; add
  bats cases for the stub (text present, non-zero exit documented, no
  `dist/cli.js delegate` call) and the three-value validator. Run
  `bats tests/` from `plugins/yellow-linear`.
- [ ] Step 4.6: `scripts/validate-provider-groups.js` — correct the stale
  header :4-7; extend `tests/integration/validate-provider-groups.test.ts`
  `REMOTE_AGENT_PROVIDERS` for a three-member group (never relax a check,
  R26).
- [ ] Step 4.7: R25 consumer-site gate in `scripts/validate-provider-groups.js`:
  a new `ERROR-PROVIDER-008` (`PROVIDER_CONSUMER_SITE_DRIFT`, assembled by
  concatenation, registered in `errorCatalog.ts`) that reads every id from
  each `provider-table` block and fails when an id is absent from any
  registered consumer site: the `linear-delegate-providers` slice (both the
  `--provider` value and `READY_<ID>`), the `setup-all-remote-agent-states`
  slice (`READY_<ID>`), and the `setup-all-remote-agent-tooling` slice
  (`yellow-<plugin>`). A missing marker pair is itself an error. Add test
  cases (id missing from each site, marker missing, all present) to
  `tests/integration/validate-provider-groups.test.ts`. The Linear stub is
  that consumer's handling, so the gate holds across the PR2/PR3 split.
- [ ] Step 4.8: Root and CI wiring (R27): append
  `&& pnpm --filter yellow-jules run typecheck` to `package.json:16` and
  `&& pnpm --filter yellow-jules run test` to `:18`; in
  `.github/workflows/validate-schemas.yml` add a `yellow-jules` dist drift
  check after :1189 in the yellow-goal form; in
  `.github/workflows/validate-schemas-fork.yml` add a `yellow-jules` matrix
  entry (:76-87), its timeout if needed (:68), and a `yellow-jules)` arm
  mirroring `yellow-goal)` :234-239 (build, status drift check,
  `pnpm --filter yellow-jules test`). No new `paths:` globs. Commit the
  checkpoint (`feat(yellow-core,yellow-linear): register jules as a third remote-agent provider`).

### Checkpoint 5 — Documentation, changesets, full validation, ready for review

- [ ] Step 5.1: `plugins/yellow-jules/README.md` (Install, Prerequisites incl.
  `JULES_API_KEY` and consented SDK install, Commands for the four v0
  commands, Security model: artifact-first, no mutating command until PR3,
  data dir, redaction, Limitations: experimental, SDK "not an officially
  supported Google product", R53 smoke pending) and
  `plugins/yellow-jules/CLAUDE.md` (Architecture, sdk-adapter boundary, SDK
  pin policy incl. the runtime lockfile and re-verification triggers from
  contract "Transport verdict", CLI contract and Error catalog **linking** to
  `docs/yellow-jules/contract-v1.md` rather than restating it, Local state,
  Testing layers, Build discipline, Component catalog). The R38 handoff
  procedure is shell 03's.
- [ ] Step 5.2: `docs/yellow-jules/contract-v1.md` — flip `**Status:**` to
  "Accepted (PR2 landed read-only surface)"; add dated notes for the PR2
  revisions (external-session minting with `origin: "external"`, the
  `runtime/` lockfile location, any revised default); update
  `docs/yellow-jules/capability-matrix.md` rows now
  `packed-artifact-tested`.
- [ ] Step 5.3: Counts and cross-references (R28): "19 plugins" → "20" at
  `CLAUDE.md:10`, `README.md:3`, `docs/architecture-overview.md:3,60`; add
  yellow-jules to `README.md:33-35` and the ~:272 tree, `AGENTS.md:20-21`,
  `docs/architecture-overview.md:70,106,139,249`,
  `plugins/yellow-core/CLAUDE.md:294-296`,
  `plugins/yellow-linear/CLAUDE.md:~97-101`; add `validate:jules` to the
  `validate:schemas` list in root `CLAUDE.md`; add an `@google/jules-sdk`
  section to `docs/upstream-pins.md` beside the `@cursor/sdk` one with the
  pinned tree and "treat any bump as a re-verification of the four R3
  criteria". `docs/codex-distribution.md` is untouched (Codex stays disabled).
- [ ] Step 5.4: Changesets via `pnpm changeset`: `yellow-jules` minor (initial
  release), `yellow-core` minor (third remote-agent provider, READY_JULES),
  `yellow-linear` minor (`--provider jules` recognized, fail-closed until
  PR3), and `yellow-cursor` patch only if Step 3.5's replica markers changed
  its `dist/`.
- [ ] Step 5.5: Full local gate: `pnpm build` then confirm
  `git status --porcelain --untracked-files=all -- plugins/yellow-jules/dist plugins/yellow-cursor/dist`
  is empty; `pnpm validate:schemas`, `pnpm validate:versions`,
  `pnpm validate:generated`, `pnpm release:check` (doc counts),
  `pnpm test:unit`, `pnpm test:integration`, `pnpm lint`, `pnpm typecheck`,
  `pnpm validate:agents`, `pnpm lint:plugins`,
  `pnpm validate:shell-compat`, `pnpm check:shell-parse`,
  `pnpm test:shell-compat`, `bats tests/` in `plugins/yellow-linear` and
  `plugins/yellow-core`; `rg -l $'\r' plugins/yellow-jules scripts/validate-jules.js`
  empty (LF only). Report any pre-existing failure verbatim.
- [ ] Step 5.6: Amend the checkpoint stack into the single PR through the
  active provider's commands, tick every enumeration-site checklist item in
  the PR description, list follow-ups (shell 03: `delegate`/`reply`/`approve`
  runtime paths and wrappers, `authorize`, R38 handoff doc, Linear live
  dispatch; R53 smoke after shell 03), and mark the PR ready for review.

## Verification

- `pnpm --filter yellow-jules test` -> all suites pass, including
  `packed-sdk-transport.test.ts` against the real `0.2.0` artifact installed
  from `runtime/package-lock.json`, with the PATH-trap log empty
- Negative test in `offline-coverage.test.ts` -> fake server request log
  contains zero `POST`/`PATCH`/`PUT`/`DELETE` across every shipped subcommand
- `rg -n "session\(\{|\.send\(|\.approve\(" plugins/yellow-jules/src` -> no
  runtime call sites (the create builder is a pure object; only tests invoke
  the SDK's mutating surface)
- `rg -ln "@google/jules-sdk" plugins/yellow-jules/src` -> only
  `sdk-adapter.ts` (API/types) and `sdk-resolver.ts` (package location), R2
- `rg -li jules packages/ --glob '!**/errorCatalog.ts'; ls plugins/yellow-jules/skills 2>&1`
  -> no Jules runtime code under `packages/` (the `ERROR-JULES-*` catalog
  entries are validator metadata) and no `skills/` directory in PR2 (R5)
- `node plugins/yellow-jules/dist/cli.js bogus; echo $?` -> one JSON line
  `{"ok":false,"operation":"unknown",…}` and exit `2`
- `node plugins/yellow-jules/dist/cli.js setup` with `JULES_API_KEY` unset and
  a temp `YELLOW_JULES_DATA_DIR` -> `ok: true`, `credentialSource: "none"`,
  `requiresAttention: true`, exit `0`, no vendor request
- `node plugins/yellow-core/lib/remote-agent-provider-state.js classify --plugins-file tests/integration/fixtures/remote-agent-provider/<jules-enabled fixture> --tooling-jules yes`
  -> `READY_JULES`; with three enabled -> `CONFLICT` naming yellow-cursor as
  preferred
- `pnpm validate:schemas` -> passes including `validate-provider-groups`
  (ERROR-PROVIDER-008 clean) and `validate-jules`; deleting `jules` from the
  delegate markers in a scratch copy -> `ERROR-PROVIDER-008`
- `pnpm validate:setup-all` -> passes with yellow-jules in every marker block
- `cd plugins/yellow-linear && bats tests/` -> passes, including the new stub
  cases
- `pnpm build && git status --porcelain --untracked-files=all -- plugins/*/dist`
  -> empty
- `pnpm release:check` -> doc counts report 20 plugins, versions in sync
- `ls .changeset/*.md | xargs rg -l 'yellow-jules|yellow-core|yellow-linear'`
  -> changesets for all three plugins
- PR description -> every enumeration-site checklist item ticked, including
  the three extra `setup/all.md` marker blocks

## Context Files

- `plans/specs/yellow-jules-integration.md` — R1-R28, R35-R37, R40, R42,
  R49-R52; Design "Plugin layout", "Data model", "Command to runtime mapping"
- `docs/yellow-jules/contract-v1.md` — binding contract: verdicts, argument
  shapes, activity walk, envelope, error catalog, redaction, allowlist, local
  state
- `docs/yellow-jules/sdk-investigation.md` — Appendix A harness to
  productize; sections 5-9 evidence for the adapter configuration
- `docs/yellow-jules/integration-plan.md` — PR2 enumeration-site checklist
  and review-round-1 additions
- `docs/yellow-jules/capability-matrix.md` — rows to relabel
  `packed-artifact-tested`
- `plugins/yellow-cursor/src/*.ts`, `plugins/yellow-cursor/tests/*`,
  `plugins/yellow-cursor/commands/cursor/*.md`,
  `plugins/yellow-cursor/CLAUDE.md` — architecture template; replica source
- `plugins/yellow-morph/lib/install-morphmcp.sh`,
  `plugins/yellow-morph/package-lock.json` — lockfile-pinned data-dir install
  precedent
- `plugins/yellow-goal/tests/fixtures/fake-engine.mjs`,
  `plugins/yellow-goal/tests/spawn.test.ts` — process-level fake and bounded
  timeout patterns
- `plugins/yellow-core/lib/remote-agent-provider-state.js` — router table and
  states
- `plugins/yellow-core/commands/setup/all.md` — R23 sites and marker blocks
- `plugins/yellow-linear/commands/linear/delegate.md`,
  `plugins/yellow-linear/tests/delegate.bats` — R24 sites and pinned text
- `scripts/validate-provider-groups.js`,
  `tests/integration/validate-provider-groups.test.ts`,
  `tests/integration/remote-agent-provider-state.test.ts`,
  `tests/integration/fixtures/remote-agent-provider/` — R25/R26 gates
- `scripts/validate-setup-all.js` — enforces the extra marker blocks
- `packages/domain/src/validation/errorCatalog.ts`,
  `scripts/lint-error-codes.js` — error-code registration rules
- `catalog/catalog.json`, `catalog/plugins/yellow-cursor.json`,
  `tests/integration/__snapshots__/generate-manifests-characterization.test.ts.snap`
- `package.json`, `.gitignore`, `.github/workflows/validate-schemas.yml`,
  `.github/workflows/validate-schemas-fork.yml` — R27 wiring
- `scripts/validate-doc-counts.js`, `docs/upstream-pins.md`,
  `docs/architecture-overview.md`, `AGENTS.md`, `README.md`, `CLAUDE.md` — R28
- `plugins/yellow-core/skills/security-fencing/SKILL.md` — untrusted-content
  fence
- `docs/solutions/code-quality/golden-fixture-parity-vs-contract-correctness.md`,
  `docs/solutions/code-quality/unhandled-outcome-defaults-to-success-bucket.md`,
  `docs/solutions/security-issues/bash-to-node-port-drops-fail-closed-and-bounds.md`,
  `docs/solutions/code-quality/bash-block-subshell-isolation-in-command-files.md`
