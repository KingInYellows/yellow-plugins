# yellow-jules: Google Jules as a Third remote-agent Provider

## Overview

`yellow-jules` is a new optional plugin, a sibling of `yellow-cursor`, that
registers Google Jules as a third provider in the `remote-agent` capability
group (`cursor` preferred, `devin` legacy, `jules` experimental). One typed,
host-neutral TypeScript runtime owns API transport, session identifiers,
activity retrieval, artifact collection, operation reconciliation, and a
provider-local journal. Thin Claude command wrappers and generated Codex skills
call that runtime through a JSON CLI. The pinned `@google/jules-sdk` sits
behind an injected adapter so the transport can be swapped for a small REST
client without changing the plugin architecture.

The motivating value is asynchronous, unattended execution: Jules sessions run
for a long time without a supervising CLI holding a connection. That value is
realized fully only after the separate `yellow-goal` engine gains real-provider
execution, persistent waiting, and asynchronous outcomes. v0's interactive
commands and bounded supervision are deliberate scaffolding toward that
milestone, not the end state. Cursor/Devin parity is a side effect. Delivery is
artifact-first: sessions are created with plan approval required and vendor
auto-PR disabled, patches are staged outside the checkout, and every branch or
PR mutation goes through the enabled stacked-PR provider with a human merge
boundary.

Sources of truth: `docs/brainstorms/2026-09-09-yellow-jules-integration-brainstorm.md`
(decisions: Approach A, async motivation) and the user-supplied "Yellow Jules
integration plan, revision 2" (2026-09-09), whose sections are cited as §N
below. The revision-2 document is not in this repository; PR1 commits the
parts this spec depends on (§5, §6, §14, §17 evidence register) so later
shells do not depend on a file outside the tree. Repo facts below were
re-verified against `main` at `6a0bcc87` on 2026-09-09.

**Out of scope:** forking Jules Fleet; a Jules MCP facade (a later facade must
call this runtime); Cursor-target distribution of yellow-jules; Codex
portability of the generic `/linear:delegate` routing workflow; a distributed
ownership lock or queue service; vendor-PR adoption into local stacks
(explicit later policy); any change to the preferred provider (`cursor`).

## Users

- **Owner (Brad)** via Claude Code: delegates tasks, approves plans, replies,
  collects and integrates patches, grants bounded authorizations. Primary
  trial user.
- **Owner via Codex CLI:** same operations through generated Codex skills and
  the same executable; first-class from PR3 onward.
- **Supervisor agent (Claude or Codex session):** runs bounded supervision
  passes under a grant; owns research, plan evaluation, and technical replies.
- **yellow-goal engine (future):** invokes the released Jules CLI through a
  process boundary; owns durable waiting, budgets, and recovery.

## Requirements

### Architecture and boundaries

- **R1.** The system shall ship `yellow-jules` as an optional sibling plugin
  under `plugins/yellow-jules/`, registered in the catalog with
  `capabilityProvider: { group: "remote-agent", id: "jules" }` and
  `lifecycle: { status: "experimental", installPolicy: "manual" }`. It is
  neither a Jules Fleet fork nor a second goal controller. [§1, §7]
- **R2.** All Jules API access shall go through one typed runtime
  (`src/runtime.ts`) that receives an `SdkAdapter` by dependency injection;
  `src/sdk-adapter.ts` shall be the only file importing the SDK. No parallel
  MCP, shell-curl, or browser-control implementations of the same operations.
  [§1, mirrors `plugins/yellow-cursor/src/sdk-adapter.ts`]
- **R3.** Transport is SDK-first with a REST fallback behind the same adapter
  interface. When PR1's investigation shows the pinned artifact fails any of:
  (a) loads from a clean plugin-data-dir install with no monorepo
  `node_modules`, (b) serializes `requireApproval:true` / `autoPr:false`
  exactly as configured, (c) hidden HTTP retries can be disabled and the
  outgoing request count proves it, (d) SDK storage can be isolated to a
  bounded in-memory scratch with correct read-after-write inside one
  invocation, then PR2 shall implement a REST adapter against the HTTPS-only
  base `https://jules.googleapis.com/v1alpha` with `/sessions`, `/sources`,
  and `/sessions/{session}/activities` paths, sending the API key only to
  that origin and failing closed on HTTP, downgrade, or cross-origin
  redirects. Either way the command surface and runtime contract are
  unchanged. [§1, §6]
- **R4.** When installed from the plugin cache, the runtime shall run without
  the monorepo's `node_modules`. When the SDK adapter is selected (R3), it
  resolves the SDK in order: workspace
  `require`, then `<dataDir>/runtime/node_modules`, else fail with
  `JULES_SDK_MISSING` and a recovery action. Installation into the data dir
  happens only after explicit `/jules:setup` consent, pins an exact version
  with a recorded integrity hash, verifies the downloaded tarball against
  that hash and aborts with `JULES_SDK_INTEGRITY` on mismatch, runs with
  lifecycle scripts disabled, and never on a per-task basis. When the REST
  adapter is selected, the runtime has no SDK dependency and `setup` reports
  resolution as not applicable. [§4, §6.2; pattern: `yellow-cursor/src/sdk-resolver.ts`]
- **R5.** No Jules runtime code shall live in `packages/domain`,
  `packages/infrastructure`, or `packages/cli`, and no executable code shall
  live under `skills/` (the Codex generator copies only `SKILL.md` plus a flat
  `references/*.md`). [§4, §13; `docs/codex-distribution.md`]
- **R6.** On the SDK-adapter branch, the plugin shall load the SDK's ESM entry either through a
  plugin-local ESM build (`"type": "module"` in `plugins/yellow-jules/package.json`)
  or a verified dynamic-import boundary from a CJS build, chosen by PR1's
  findings. Marketplace-wide module settings (`tsconfig.base.json`, other
  plugins) shall not change. On the REST branch the plugin keeps the
  yellow-cursor CJS build. As of `6a0bcc87` (2026-09-09) no plugin ships ESM;
  yellow-cursor and yellow-goal emit CJS via `module: node16`. [§4, §6.2]

### Command surface and CLI contract

- **R7.** `dist/cli.js` shall print exactly one JSON object on stdout,
  diagnostics on stderr, and exit 0 on success, 1 on operational failure, 2 on
  usage error, with stable `code`, `retryable`, and `recoveryAction` fields
  and centralized redaction on every output path. Vendor error text is never
  reproduced unredacted. Every vendor-supplied session, source, activity, or
  plan identifier, whether accepted as input or returned by the API, is
  validated against an anchored allowlist pattern before use in any adapter
  call, URL, journal key, or filesystem path, on both transport branches;
  artifact staging paths, including the per-session directory R40 stages
  into, derive from a locally minted id, never from the vendor
  `sessionResource` string. [§5; mirrors yellow-cursor `errors.ts`/`redact.ts`/`validate.ts`]
- **R8.** Command markdown files under `commands/jules/` shall be thin Bash
  wrappers around the CLI with no API logic. v0 commands: `setup`, `delegate`,
  `list`, `status`, `reply`, `approve`, `collect` (PR2); `authorize`,
  `supervise` (PR3); `integrate` (PR4). Every mutating wrapper confirms via
  AskUserQuestion unless a valid grant (R30) covers the operation. [§5, §8]
- **R9.** Runtime operations shall be short-lived. Session creation uses the
  configured interactive `session()` path; `run()`, `all()`, `result()`,
  `ask()`, and `waitFor()` shall not be used as command implementations.
  Messages are submitted non-blocking; a coding session's duration is never a
  CLI timeout. [§5]
- **R10.** Every status result shall carry both the raw vendor state and a
  normalized actionable condition. Unknown vendor states map to
  `needs-inspection`, never to completed. Remote completion, local
  verification, and final acceptance are three distinct recorded states. [§5]
- **R11.** Operations the vendor contract does not establish (cancel, pause,
  resume, per-session cost, exactly-once execution) shall return
  `JULES_UNSUPPORTED_CAPABILITY`. REST `delete` is not treated as safe
  cancellation. [§5, J3]

### Vendor contract: creation, retries, cache, sources, artifacts

- **R12.** When creating any delegated implementation session, the runtime
  shall pass SDK `requireApproval: true` and `autoPr: false` explicitly and
  assert the serialized request carries REST `requirePlanApproval: true` and
  `automationMode: AUTOMATION_MODE_UNSPECIFIED`. REST field names are never
  passed into the typed SDK config. [§6.1, J3, J7]
- **R13.** When a vendor-created PR is observed for a session that requested
  no PR, the runtime shall record a `policy-deviation` journal entry, stop new
  delegation under the active grant, and report the external PR reference.
  Observation grants no authority to adopt, close, rewrite, or merge it. [§6.1]
- **R14.** The runtime shall configure the SDK client so hidden response-status
  retries are disabled (`rateLimitRetry.maxRetryTimeMs: 0` on the inspected
  surface), verified by a packed-artifact test that counts outgoing requests.
  Yellow owns bounded read retries with backoff and jitter. Mutating requests
  are never auto-replayed after an ambiguous outcome; a clear 429 is
  distinguishable but still returns control. Every operation carries an
  absolute deadline in addition to per-request timeouts, and authority is
  rechecked before each intentional new write. [§6.3, J8]
- **R15.** The Yellow journal (R35) is the sole authority for grants,
  task/session mappings, processed activity ids, and verified outcomes. SDK
  storage is a bounded in-memory scratch factory (R3 criterion (d) guarantees
  this on the SDK branch; the REST branch has no SDK storage). Setup, import, and operations shall create no state under the
  source checkout or the plugin install cache. `status`, approval checks, and
  reconciliation shall perform fresh remote reads, never trusting a cache hit.
  [§6.4, J7, J9]
- **R16.** When an error occurs after a mutating request may have been
  accepted (network loss, response decoding, response mapping, SDK cache
  upsert, journal persistence), the runtime shall classify the operation as
  `JULES_UNKNOWN_OUTCOME`, preserve any known remote session id, and never
  launch a replacement session automatically. Reconciliation against remote
  sessions/activities resolves it; if still ambiguous, stop and report. [§6.4, §10]
- **R17.** Implementation delegation shall require a discovered GitHub source
  resource obtained from the Sources API; the runtime never synthesizes source
  names from owner/repo strings and never creates sources through this API. [§6.5, J4]
- **R18.** Activity retrieval shall paginate, deduplicate by activity id,
  persist the identifiers needed to reread after restart, and use overlapping
  reads on restart without assuming timestamp total order or durable page
  tokens. A page fetch that fails mid-traversal records `partial-pagination`
  and is never treated as end-of-results; R32's outside-activity check
  treats such a set as incomplete. No webhook is claimed unless verified in
  the current contract. [§6.5, §10, J5]
- **R19.** `collect` shall retrieve every available artifact kind (change-set
  patch with base commit, external PR reference, grounded generated files) and
  return an explicit `no-supported-artifact` result otherwise. For
  code-changing tasks, a completion message or Markdown explanation alone
  yields a non-accepted result. `collect` marks, and `integrate` (R41)
  refuses, any artifact whose session carries an unreconciled
  `policy-deviation` record (R13). [§6.5, J5]
- **R20.** The journal shall record the requested branch and locally observed
  head separately from the artifact's actual base; the plugin never advertises
  SHA-pinned execution. [§6.5]

### Provider router and consumers (atomic PR2 boundary)

- **R21.** `catalog/plugins/yellow-jules.json` shall declare R1's identity and
  `targets: { claude: true, codex: { enabled: false } }` at PR2, with no
  `cursor` target. `catalog/catalog.json` `pluginOrder` gains the plugin.
  Generated manifests come only from `pnpm generate:manifests`;
  `tests/integration/generate-manifests-characterization.test.ts` snapshots
  are refreshed deliberately. [§7, §13]
- **R22.** `plugins/yellow-core/lib/remote-agent-provider-state.js` shall add
  `{ id: 'jules', plugin: 'yellow-jules' }` inside the
  `// provider-table:start/end` block, a `READY_JULES` state, a
  `--tooling-jules` probe flag, and diagnostics text naming Jules, while
  retaining precedence `CONFIG_INVALID > CONFLICT > UNSELECTED > PARTIAL_TOOLING > READY_*`
  and `PREFERRED_PROVIDER_ID = 'cursor'`. The module's docstring claim that
  `/linear:delegate` is its only consumer is stale (`setup/all.md` Step 2.5
  also calls it) and is corrected in the same edit. [§7]
- **R23.** `plugins/yellow-core/commands/setup/all.md` shall cover Jules in the
  plugin enumeration loop, a credential-presence probe for the Jules API key
  env var (single API-key variable mirroring `CURSOR_API_KEY`; exact name
  confirmed from vendor docs in PR1's contract doc; the value is never
  printed), the per-provider READY/PARTIAL section, status-table rows,
  the setup command list, the Step 2.5 PARTIAL_TOOLING to setup-command
  mapping (`/jules:setup`), the "Remote-Agent Provider Tooling" probe that
  today filters `claude plugin list --json` for `yellow-cursor` only, the
  Step 2.5 acceptable-state enumeration ("not `READY_CURSOR`, `READY_DEVIN`,
  or `PARTIAL_TOOLING`"), which sits outside the validator's marker block
  and is caught by nothing mechanical, and the `remote-agent` membership list
  inside the `setup-all-provider-groups` markers. [§7, §13]
- **R24.** `plugins/yellow-linear/commands/linear/delegate.md` shall accept
  `--provider cursor|devin|jules` at every site: the description and
  `argument-hint`, the `--provider` value validator, the `READY_*` to provider
  mapping, the `PROVIDER="cursor"` default, the per-provider dispatch and
  status branches, the error table, and the classifier invocation, whose
  inline Node reads exactly two tooling-probe argv slots
  (`TOOLING_CURSOR`, `TOOLING_DEVIN`) and needs a third for Jules (the
  brainstorm doc lists line locators at `6a0bcc87`; re-anchor at
  implementation), preserving the rule that `--provider` overrides only
  `CONFLICT` and never enables an absent or failed provider. Tests cover two-
  and three-provider conflicts, scope filtering, unavailable tooling, and all
  existing Cursor/Devin behavior. [§7]
- **R25.** `READY_JULES` shall not ship while any consumer lacks handling for
  it: catalog registration, router table, setup coverage, Linear route, root
  script filters, fixtures, CI selectors, and changesets land in one PR and
  revert as one. The PR2 description carries the literal enumeration-site
  checklist, and PR2 adds a validator (or extends
  `scripts/validate-provider-groups.js`) that enumerates every provider id in
  the router table and fails when any id is absent from each registered
  consumer site (the `--provider` validator and `READY_*` mapping in the
  Linear delegate command, the Step 2.5 state enumeration and tooling probe
  in setup-all), so the guarantee is a CI gate rather than prose. [§7, §14; `docs/solutions/code-quality/unhandled-outcome-defaults-to-success-bucket.md`]
- **R26.** `scripts/validate-provider-groups.js` fixtures and
  `tests/integration/validate-provider-groups.test.ts` shall be extended for a
  three-member group, and `tests/integration/remote-agent-provider-state.test.ts`
  with its six fixtures under `tests/integration/fixtures/remote-agent-provider/`
  shall be extended for a seventh state and a three-provider table; the
  validator's checks are never relaxed. Its header
  comment still says the field marks "currently only `stacked-pr`" and is
  corrected in passing. [§7]
- **R27.** Root `package.json` `typecheck` and `test:unit` shall name
  `yellow-jules` explicitly alongside `yellow-cursor` and `yellow-goal` (no
  `--if-present`). `.github/workflows/validate-schemas.yml`'s `build` job
  shall add a committed-`dist` drift check for `plugins/yellow-jules/dist`
  next to the yellow-cursor and yellow-goal checks, and
  `validate-schemas-fork.yml` shall add a `yellow-jules` matrix arm (build,
  test, drift) mirroring its `yellow-goal` arm, since the main `build` and
  `unit-tests` jobs skip fork PRs. No new `paths:` globs are needed: both
  workflows already trigger on `plugins/**`. `.gitignore` shall add a
  `!plugins/yellow-jules/dist/` negation beside the existing yellow-cursor
  and yellow-goal exceptions, since `**/dist/` is ignored repo-wide and the
  drift check above depends on the compiled output being tracked. [§13]
- **R28.** Every plugin whose public behavior changes (`yellow-jules`,
  `yellow-core`, `yellow-linear`) shall carry a changeset; README, CLAUDE.md,
  `AGENTS.md` component counts, the "20 plugins" claims in root `CLAUDE.md`
  and `README.md` (gated by `scripts/validate-doc-counts.js` in
  `pnpm release:check`, not in `validate:schemas`), and
  `docs/codex-distribution.md` (only when Codex is enabled) are updated in
  the same PR. Adding the plugin changes three characterization snapshots
  (inventory, marketplace bytes, one per-plugin key). Every PR that edits
  plugin Markdown runs both `pnpm validate:agents` and `pnpm lint:plugins`. [§13]

### Authority and autonomy

- **R29.** Every mutating command shall default to interactive confirmation,
  matching `yellow-cursor` wrappers, until a grant covers it. Interactive
  confirmation is a runtime-validated single-operation authorization, not a
  caller-asserted flag: the wrapper's confirmation step mints a single-use
  confirmation token bound to the exact operation (kind, repository, branch,
  and request id), and the runtime accepts the token exactly once and only
  for that binding; TTY presence or absence on the CLI child's stdin proves
  nothing by itself. The engine process interface (R59), which never runs
  interactively, presents a grant id instead. [§8]
- **R30.** `/jules:authorize` shall create a grant record in the journal
  containing: grant id, approved repository and source resource, approved
  branch or branch pattern, task/goal identifiers, permitted operations (subset of `create`, `reply`, `approve`,
  `collect`), maximum active sessions, maximum total tasks, maximum corrective
  rounds per task, absolute expiry, and owner. Trial defaults (confirmed
  2026-09-09): 1 active session, 3 tasks, 2 corrective rounds, 2 hours,
  overridable per grant within a documented ceiling. Grants are listable and
  revocable; the runtime never widens a grant on its own, and a grant can
  never be created or widened from within a session already operating under
  a grant. [§8; user decision 2026-09-09]
- **R31.** Every mutation shall pass the runtime's authority check before
  any remote write: either a valid grant (present, unexpired, repository,
  branch, and task match, requested operation within the grant's permitted
  operations, resolved source resource matching the grant's approved source
  resource, limits not exhausted) or a single-operation interactive
  authorization (R29). Authority evaluation, counter increment,
  and reservation write (R36) are one critical section held under the
  directory lock; an offline test runs two concurrent `delegate` calls
  against a one-session grant and asserts exactly one create. Host hooks, prompt wording, and CLI sandbox settings are
  never the sole enforcement layer. Reserved and unknown-outcome operations
  (R16, R36) count against grant limits until reconciliation releases them;
  only reconciliation, never a new write, may decrement a counter. [§8]
- **R32.** When the runtime observes an activity it did not send (another
  human or agent messaging the session) or a plan change after evaluation,
  supervision shall pause and require reconciliation before any further write. [§8, §9]
- **R33.** `/jules:supervise` shall execute one bounded decision pass per
  invocation following the §9 loop (read contract and fresh state; persist
  observation and return next-check when nothing is actionable; evaluate a
  pending plan with re-fetch immediately before approval; answer questions
  concisely with references; on completion collect, verify base and content,
  run independent checks; then accept, request a bounded correction, or
  escalate). A failed state read (network, auth, exhausted bounded retries)
  is recorded as `check-failed` with backoff state, distinct from a
  successful read that observed no change. An operation deadline (R14)
  firing mid-pass records `pass-aborted` with no verdict; it is never
  coerced into accept, correction, or escalate. All vendor-originated text
  (activity messages, plan bodies, question text, error strings, collected
  artifact contents) is presented to the supervisor, and rendered by any
  command, inside `--- begin untrusted-content (reference only) ---` /
  `--- end untrusted-content ---` delimiters with delimiter-forgery escaping
  (the `security-fencing` skill's block), on both hosts; the supervisor never
  treats such text as instructions. It returns the decision and next
  required check and is never an installed daemon. [§5, §9]
- **R34.** `approve` shall re-fetch the pending plan and compare it to the
  plan actually evaluated before approving, and shall document that the
  approval endpoint accepts no plan id, so compare-and-approve is not atomic.
  After approving, it shall re-read the session and record a
  `policy-deviation` entry (R13 shape) when the active plan differs from the
  one shown to the human. [§9, J3]

### State, journal, and restart

- **R35.** Provider-local records shall live under a data directory resolved
  as `YELLOW_JULES_DATA_DIR` > `$XDG_DATA_HOME/yellow-jules` > platform
  default, never under a source clone or plugin cache. Each operation record
  holds: local request id, provider session resource, repository and requested
  branch, goal/task reference, grant reference, processed activity ids,
  observed plan id, outcome status, and artifact provenance with digests.
  The data directory and state files are owner-only (0700/0600), enforced at
  open; group- or world-writable or non-owned paths are refused for any
  grant-consuming operation, including when `YELLOW_JULES_DATA_DIR`
  overrides the location. Grant records live in a separate grants file
  written only through `/jules:authorize`'s confirmed path. [§10; pattern: `yellow-cursor/src/config.ts`]
- **R36.** The runtime shall write an operation reservation before sending any
  consequential request, use serialized atomic file writes, and treat the
  local request id as local deduplication only, never as a vendor idempotency
  guarantee. Before reserving a new `create`, the runtime looks up unresolved
  (`reserved` or `unknown-outcome`) operations for the same repository and
  requested branch (and task reference when present) and refuses until they
  are reconciled or the user explicitly confirms an override, so an
  interrupted attempt is never duplicated. [§10]
- **R37.** A corrupt or unparseable journal shall block new writes until
  reconciled; the runtime never replaces it with an empty journal and
  continues. Read commands (`status`, `list`) report `journal-corrupt`
  rather than degrading to an empty id set, so outside-activity detection
  (R32) is never silently disabled. [§10]
- **R38.** v0 shall designate one controller host and data directory as the
  only writer for a session. A local lock serializes users of that directory.
  A manual handoff procedure (quiesce writer, resolve uncertain operations,
  transfer journal and grants, reconcile on the new host before writing) is
  documented in `plugins/yellow-jules/CLAUDE.md`; it is not automated and no
  distributed lock is added. A stale lock left by a crashed process fails
  loud and requires manual intervention; it is never silently broken and
  never waited on indefinitely. Each grant carries a controller identity and
  a monotonic epoch whose authoritative value lives in a host-local file
  outside `<dataDir>` (keyed by controller identity), never inside the
  copied directory; the journal holds only a reference to it. Every write
  re-reads the host-local file and matches it against the reference,
  treating a missing or mismatched authority as fail-loud, and the handoff
  procedure writes the incremented epoch to the new host's file and
  invalidates the source journal, so a copied or restored data directory —
  which cannot carry the host-local file with it — fails loud instead of
  writing in parallel. [§9; user decision 2026-09-09]
- **R39.** When a grant or supervision deadline expires while a remote session
  is still active, the runtime shall report the running session and refuse
  further instructions; expiry is never reported as remote termination. The
  plugin documents an out-of-band containment procedure (vendor console stop,
  source-connection revocation, API-key rotation) reachable without a grant,
  and expiry reporting names it in `recoveryAction`. [§10]

### Delivery, verification, and handoff

- **R40.** `collect` shall stage patches and evidence in
  `<dataDir>/artifacts/<local-id>/`, where `<local-id>` is the locally minted,
  allowlist-validated id from R7 rather than the raw vendor session string,
  without modifying any checkout, applying changes, submitting a stack, or
  merging. [§5, §11]
- **R41.** `/jules:integrate` shall, for a collected artifact: verify the
  reported base against the intended branch and fail on mismatch; create a
  dedicated integration worktree through the yellow-core `git-worktree`
  skill; check the patch against a path deny-list (CI workflow files,
  package lifecycle scripts, hook scripts, `.claude/`, `.codex-plugin/`,
  `.cursor-plugin/`) and fail on a match; apply the patch there; require the
  user to acknowledge the diff before any command runs inside the worktree;
  run the task's verification contract, resolved and pinned from the
  pre-apply trusted checkout (never read from the worktree after apply),
  with lifecycle scripts disabled and without ambient credentials; then
  hand off branch and PR creation by running `/stack:status` and routing only
  through the `READY_GRAPHITE` or `READY_GITHUB` provider. It never invokes
  raw `git push`, `gh pr create`, or any auto-merge path. [§11; user decision 2026-09-09]
- **R42.** Existing Jules-created PRs shall be collectable as external
  artifacts only; the plugin does not assume they belong to a local stack and
  adds no adoption path without a separately approved policy. [§11]
- **R43.** Verification shall run available review and CI tooling against the
  actual staged patch or PR commit. The result carries one of `passed`,
  `failed` (checks ran and reported failures; burns a corrective round),
  `unavailable` (no tooling), or `errored` (tooling crashed or timed out;
  burns no corrective round). `unavailable` and `errored` are recorded as
  such, never as a manufactured pass, and R33 treats both identically when
  deciding accept, correction, or escalate. The result is written to the
  artifact record's `verification` field with the same vocabulary. [§11]
- **R44.** During corrections the supervisor shall send feedback to the
  existing active session or create a new bounded repair task under the same
  grant, within R30's corrective-round limit; completed sessions are not
  assumed reopenable. [§11]

### Distribution (Claude and Codex)

- **R45.** Skill bodies `skills/jules-delegation/SKILL.md` and
  `skills/jules-supervision/SKILL.md` shall be host-neutral and pass the Codex
  exposure lint; Claude-only tool names, slash commands, env vars, and subagent
  mechanics stay in command wrappers. The untrusted-content fencing of R33
  applies verbatim in the Codex skill bodies, and those bodies never rely on
  AskUserQuestion. [§12]
- **R46.** Codex exposure (`targets.codex.enabled: true`, an `interface`
  block with `displayName` and `category` (required by the generator when
  enabled), `skillAllowlist` naming both skills,
  `componentPaths.skills: ./codex/skills`, `includeHooks: false`) shall flip in PR3 only after
  `tests/integration/generate-manifests-codex.test.ts` is baselined before the
  flip, focused tests pass, and a manual Codex host smoke passes. The runtime
  never depends on plugin hooks firing on either host. [§12; `docs/solutions/integration-issues/codex-distribution-pipeline-silent-gaps.md`]
- **R47.** On Codex, supervision shall use only tools available on that host
  and shall report which research or review capabilities were unavailable for
  a pass; it never claims Claude-only sibling plugins are Codex tools. [§12]
- **R48.** From PR3, both hosts are first-class: delegate, status, reply,
  approve, collect, and supervise shall work on Codex through the same
  `dist/cli.js` with the same JSON contract and confirmation semantics.
  `authorize` is excluded from Codex parity until a host-neutral
  owner-confirmation primitive is specified (Open Question 4). [user decision 2026-09-09]

### Testing and evidence

- **R49.** Tests shall be split into three evidence layers: runtime
  unit/integration with a fake adapter (`tests/fake-sdk.ts`); packed-SDK
  contract tests using the pinned artifact against a local fake HTTP server
  with isolated storage; and a human-authorized live smoke. Every capability
  matrix row is labeled `documented`, `source-inspected`,
  `packed-artifact-tested`, or `live-observed`. [§6.5, §15]
- **R50.** Minimum transport fixtures: explicit create flags; POST
  429/500/502/503/504 without replay; lost or invalid 2xx response;
  post-create cache failure; fresh GET after stale cache; paginated and
  duplicate activities; changed pending plan; terminal output with
  patch/no-patch/PR/unknown artifact; no writes under checkout or cache.
  Each asserts the actual outgoing call count and distinguishes pre-dispatch
  failures from possibly accepted writes. [§15]
- **R51.** No CI test shall reach Jules or a live Claude/Codex executor.
  Transport tests refuse non-loopback endpoints, use dummy credentials, and
  install failing traps for real tools on PATH. [§15]
- **R52.** Offline coverage shall include: credential absence, inaccessible
  source, invalid inputs, SDK module loading, generated manifest drift,
  installed-cache execution, stdout/stderr/exit contract, provider conflicts
  and scope filtering, unauthorized writes, expired grants, task limits, stale
  plan observations, unknown states, duplicate activities, pagination,
  ambiguous creation/reply outcomes, crash recovery, corrupt journal (reads
  and writes), stale lock on restart, grant counters after an
  unknown-outcome write, partial pagination, verification tooling error
  versus unavailable, deadline with remote work active and deadline mid-pass,
  artifact base mismatch, and absence of any merge/submission fallback. Each
  scenario is exercised by the shell that ships the feature it tests: PR2
  covers everything up to corrupt journal and partial pagination; PR3 covers
  grants, limits, stale lock, grant counters, and deadlines; PR4 covers
  verification outcomes, base mismatch, and the no-fallback check. [§15]
- **R53.** After PR2 and before PR3, one human-authorized smoke shall run a
  single small task against `yellow-plugins` on an isolated scratch base
  branch (owner decision 2026-09-09; Jules holds a real source connection to
  this repository, and no grant exists yet, so the operator runs this smoke
  under R29's single-operation interactive confirmation, bound to that
  branch only) with explicit approval and no auto-PR. Success means: one session created; plan inspected; one
  reply or approval sent within authority; an interruption does not duplicate
  the task; the patch is independently checked; no PR is created by the
  vendor; no merge occurs. The result is committed as
  `docs/yellow-jules/smoke-result.md` with a `result: pass|fail` field, and
  PR3 work refuses to start until that file exists with `pass`. Its outcome
  resolves the delivery/transport question before supervision work begins.
  It is not CI. [§14, §15]

### PR1: contract, capability matrix, and isolated investigation

- **R54.** PR1 shall commit, under `docs/yellow-jules/`: the accepted
  integration plan (revision 2 content, reconciled to the checkout), a
  versioned provider-CLI contract (`contract-v1.md`: subcommands, JSON shapes,
  error codes, exit codes), a vendor capability matrix with evidence labels,
  illustrative request/response fixtures clearly marked illustrative, autonomy
  boundaries, and acceptance criteria. [§14]
- **R55.** PR1 shall include a zero-spend investigation record
  (`docs/yellow-jules/sdk-investigation.md`): registry metadata for
  `@google/jules-sdk@0.2.0`, tarball integrity value and locally computed hash,
  actual `package.json`/exports/types, a clean data-dir install with lifecycle
  scripts disabled and recorded Node version, ESM load result from the
  candidate module strategy, captured create/reply/approve request bodies
  against a local fake HTTP server, retry-configuration behavior, and storage
  side effects. Remaining unknowns are listed explicitly. The `npm view`
  result already obtained (`latest: 0.2.0`) is recorded as registry evidence,
  not tarball evidence. [§6.2, §14, §16]
- **R56.** PR1's contract document shall state the motivation explicitly:
  asynchronous unattended execution realized after the engine milestone, with
  v0's interactive surface as scaffolding. [brainstorm decision 2026-09-09]
- **R57.** PR1 shall not add `plugins/yellow-jules/`, a catalog file,
  `READY_JULES`, Linear or setup changes, generated host enablement,
  goal-engine changes, or any live Jules session; existing unrelated baseline
  failures are reported, not hidden. [§14]

### Engine milestone (yellow-goal repository, after PR4)

- **R58.** The `yellow-goal` engine shall gain a Provider Protocol revision
  (v2 or an additive v1 capability set) specifying: a `run.executor.jules`
  capability, real-provider permission profiles, persistent waiting and resume
  across engine restarts, asynchronous provider outcome events, and
  ground-truth verification of provider artifacts, while preserving the
  deterministic planner, the read-only packet compiler, and every existing
  stub-scenario guarantee. The v1 observable contract is the consumer's
  `plugins/yellow-goal/src/provider-protocol.ts` guards (PP-01..PP-11); the
  cited `provider-protocol-v1.md` was not found in any local or remote ref of
  the local yellow-goal checkout on 2026-09-09 and must be recovered or
  re-derived first. [§14 engine milestone]
- **R59.** The engine shall invoke the released `yellow-jules` CLI through a
  versioned process interface: an explicitly configured absolute path
  (fail-closed when absent), argv array with `shell: false`, closed stdin,
  bounded stdout/stderr, one absolute deadline, and SIGTERM then SIGKILL,
  mirroring the consumer transport in `plugins/yellow-goal/src/provider-process.ts`.
  No TypeScript import from a sibling clone and no recursive call back into
  the goal bridge. [§14]
- **R60.** The engine shall store references to provider job ids and grant
  ids; it shall not duplicate the provider journal or reconstruct the
  provider's mutation history. [§3, §10]
- **R61.** A new engine release shall be published with a SHA-256 asset, and
  a coordinated `yellow-goal` plugin PR shall bump `src/pin.ts`, the release
  verification script, and compatibility tests, keeping the
  `Released Goal Engine Compatibility` CI job zero-spend. [§14; `plugins/yellow-goal/CLAUDE.md`]
- **R62.** The engine milestone shall start only after PR4 ships and the owner
  explicitly approves it; installing `yellow-jules` never enables live engine
  execution. [§1, §14]

## Design

### Architecture

```text
Owner approval / grant
        |
        v
Claude Code or Codex supervisor  --uses--> research, review, CI plugins on that host
        |
        v
commands/jules/*.md (Claude) | codex/skills/* (Codex)   thin wrappers, confirm gates
        |
        v
dist/cli.js -> runtime.ts -> SdkAdapter (sdk-adapter.ts | rest-adapter.ts)
        |            |
        |            +--> journal (<dataDir>/state/journal.json), grants, artifacts
        v
Google Jules sessions / activities / sources
        |
        v
collect -> <dataDir>/artifacts/<session>/   (never touches checkout)
        |
        v
integrate -> git-worktree -> verification -> /stack:status -> active stack provider -> human merge

Later: yellow-goal engine --spawns--> released dist/cli.js (versioned process interface)
```

Traces: R1, R2, R8, R35, R40, R41, R59.

### Plugin layout (PR2 onward)

```text
plugins/yellow-jules/
  package.json          private; exact @google/jules-sdk pin; engines.node >=22.22
  tsconfig.json         extends ../../tsconfig.base.json; module setting per R6
  CLAUDE.md README.md
  src/ cli.ts runtime.ts sdk-adapter.ts sdk-resolver.ts config.ts state.ts
       authority.ts errors.ts redact.ts validate.ts
  dist/                 committed compiled output, drift-checked in CI
  commands/jules/       setup delegate list status reply approve collect
                        authorize supervise (PR3)  integrate (PR4)
  skills/jules-delegation/SKILL.md  skills/jules-supervision/SKILL.md (PR3)
  codex/skills/         generated, never hand-edited (PR3)
  tests/                fake-sdk.ts, fake-http-server.ts, runtime/cli/transport tests
```

Traces: R2, R4, R5, R6, R7, R45, R46.

### Transport decision (PR1 output, PR2 input)

PR1 runs the R55 investigation and records a pass/fail against the four R3
criteria. All pass: PR2 ships `sdk-adapter.ts` with `rateLimitRetry.maxRetryTimeMs: 0`
and an in-memory storage factory. Any fail: PR2 ships `rest-adapter.ts`
(sessions, sources, activities endpoints; explicit `requirePlanApproval` and
`automationMode` fields) with the `yellow-devin` security patterns (resource-id
validation, bearer redaction in error paths, fallback re-capture). The adapter
interface, journal, and commands are identical in both branches. Traces: R3,
R12, R14, R15.

### Data model (journal, `<dataDir>/state/`)

- **Operation record:** `localRequestId`, `kind` (create|reply|approve|collect),
  `sessionResource?`, `repository`, `requestedBranch`, `observedHead`,
  `taskRef?`, `grantId?`, `status` (reserved|accepted|unknown-outcome|
  reconciled|rejected), `processedActivityIds[]`, `observedPlanId?`,
  `condition` (normalized), `vendorState`, `artifacts[]`, timestamps.
- **Grant record:** R30 fields plus `controllerId`, `epochRef` (reference to
  the host-local authoritative epoch; R38), `revokedAt?`, and usage
  counters, stored in a separate grants file (R35).
- **Artifact record:** `sessionResource`, `kind` (patch|pr-ref|generated-file|
  none), `baseCommit?`, `path`, `sha256`, `collectedAt`,
  `verification` (unverified | passed | failed | unavailable | errored;
  never optional, initialized to `unverified`, written by R43). R41's
  integrate accepts `unverified` artifacts into its isolated apply-and-check
  phase and sets the field from R43's result; R33's accept step and any
  stack handoff require exactly `passed`, and absence or any other value is
  not acceptable.
- **Deviation record:** `policy-deviation` with external PR reference (R13).

Writes are reservation-first and atomic (temp file + rename) under a directory
lock. Traces: R13, R16, R20, R30, R35, R36, R37.

### Command to runtime mapping

| Command | Runtime op | Authority | Confirm |
| --- | --- | --- | --- |
| setup | probe credentials, resolve SDK, list sources | none | install consent only |
| delegate | validate packet, reserve, create session (R12) | grant or interactive | yes |
| list / status | fresh reads, activity paging, optional reconcile | none | no |
| reply / approve | send message / approve after re-fetch (R34) | grant or interactive | yes |
| collect | fetch artifacts to staging | none | no |
| authorize | write grant (R30) | owner | yes |
| supervise | one R33 pass; may call reply/approve/collect under grant | grant required | per grant |
| integrate | base check, worktree, apply, verify, stack handoff (R41) | interactive | yes |

Traces: R8, R9, R29, R31, R33.

### Provider router and consumer integration (PR2)

Add the `jules` row to the provider table and `READY_JULES` in
`remote-agent-provider-state.js`; extend `setup/all.md` and
`linear/delegate.md` at the enumerated sites; extend
`validate-provider-groups` fixtures; add `--filter yellow-jules` to root
`typecheck` and `test:unit`; add the dist-drift step to the main build job
and a fork-mirror matrix arm; refresh the characterization snapshot. Traces: R21-R28.

### Codex distribution (PR3)

Two host-neutral skills exposed through the catalog `targets.codex` block,
copied by the generator to `codex/skills/`. Codex skills call the same
`dist/cli.js`; host-specific wrappers stay in `commands/`. Baseline the codex
manifest test before flipping `enabled`. Traces: R45-R48.

### Evidence layers and CI

Fake-adapter tests and packed-SDK transport tests run in `pnpm --filter
yellow-jules test`; the live smoke (R53) is a documented manual procedure with
a checklist in `docs/yellow-jules/`. CI never holds Jules credentials.
Traces: R49-R53.

### Engine interface (milestone)

The engine invokes the released CLI's short-lived single-object JSON
operations (R7) through the process interface (R59), passing a grant id
(R29). A versioned `engine` mode adding a `capabilities` handshake and a
JSON Lines `run` event stream is a Jules-side contract extension owned by
shell 05 and specified there under a new contract version; v0's R7 contract
is unchanged. The plugin's journal remains the provider ledger; the engine
holds references only. Traces: R58-R62.

### Prior learnings that constrain implementation

From `docs/solutions/` (pre-pass 2026-09-09), beyond those cited inline:
`integration-issues/codex-skill-exposure-validator-blind-spots.md` (Codex
skills must not rely on AskUserQuestion; the lint does not catch it, R45),
`integration-issues/codex-config-retention-exposure-lint-conflict.md`,
`logic-errors/manifest-generator-value-shape-validation.md` (catalog value
shapes, R21), `security-issues/shell-binary-downloader-security-patterns.md`
and `security-issues/bash-to-node-port-drops-fail-closed-and-bounds.md`
(setup install path, R4), `security-issues/yellow-devin-plugin-security-audit.md`
(REST fallback patterns, R3), `code-quality/bash-block-subshell-isolation-in-command-files.md`
(command wrappers, R8), `code-quality/golden-fixture-parity-vs-contract-correctness.md`
(packed-SDK tests must exercise the real artifact, R49).

### PR stack (input to decompose, not binding)

1. **PR1 — Contract and investigation** (R54-R57; docs only).
2. **PR2 — Provider, runtime, complete Claude routing** (R1-R28, R29, R35-R37,
   R40, R42, R49-R53; atomic). Followed by the R53 human smoke.
3. **PR3 — Bounded authority, supervision, Codex surface** (R30-R34, R38, R39,
   R44-R48).
4. **PR4 — Verification and handoff** (R41, R43, end-to-end fake scenarios).
5. **Engine milestone** (R58-R62; yellow-goal repo first, then plugin pin bump).

## MVP Scope

MVP is PR1 plus PR2 plus the R53 smoke: an owner can set up, delegate with
explicit flags, observe, reply, approve, and collect a patch to staging with
interactive confirmation on every write. PR3 adds grants, supervision, and
Codex parity. PR4 adds integrate and verification handoff. The engine
milestone is last and separately approved.

## Resolved Decisions (2026-09-09)

- Approach A from the brainstorm: SDK-first behind the adapter, artifact-first
  delivery, four PRs plus a separate engine milestone.
- Motivation: asynchronous unattended execution; v0 is scaffolding.
- Engine milestone is in scope as R58-R62 (cross-repository).
- PR1 stays a separate release boundary.
- Single controller host with a documented manual handoff (R38).
- Owner uses both Claude Code and Codex; both hosts first-class from PR3 (R48).
- `/jules:authorize` is a dedicated command (R30); `/jules:integrate` owns
  apply-and-handoff (R41).
- Trial grant defaults kept (R30). Smoke runs against `yellow-plugins` on an
  isolated branch (R53). PR1 artifacts live in `docs/yellow-jules/` (R54).
  Credential is a single presence-checked API-key env var (R23).

## Open Questions

All three were reviewed on 2026-09-09 and deliberately deferred to the
implementation evidence named in each item.

1. Module strategy (plugin-local ESM vs CJS with dynamic import): decided by
   PR1 evidence per R6; record the choice in the contract doc.
2. On Codex, which research and review capabilities are actually available
   to the supervision skill? R47 requires reporting the gap; the concrete
   list depends on the installed Codex CLI version.
3. Does the pinned SDK expose generated-file artifacts at all? If not, R19's
   generated-file branch is documented as unsupported rather than implemented.
4. Host-neutral owner-confirmation primitive for `/jules:authorize` on Codex
   (R48): until specified, authorize is Claude-only.
5. Whether grant records need a key-bound MAC beyond owner-only permissions
   and a separate grants file (R35): decide at shell 03 expansion.
