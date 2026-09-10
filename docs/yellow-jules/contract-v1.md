# yellow-jules provider CLI contract, version 1

**Version:** 1 **Status:** Draft until PR2 lands **Reconciled to:** `main`
`8baa0bdd` (2026-09-10) **Spec:** `plans/specs/yellow-jules-integration.md`
**Evidence:** [sdk-investigation.md](sdk-investigation.md),
[capability-matrix.md](capability-matrix.md)

This is the contract every later yellow-jules shell implements: subcommands,
JSON shapes, error codes, exit codes, redaction, identifier rules, autonomy
boundaries, and acceptance criteria. It mirrors the "CLI contract", "Error
catalog", and "Local state" sections of `plugins/yellow-cursor/CLAUDE.md` and
the shapes in
`plugins/yellow-cursor/src/{errors,cli,redact,validate,config,types}.ts`.
Evidence labels use the vocabulary defined once in
[capability-matrix.md](capability-matrix.md).

## Motivation

The motivating value of yellow-jules is asynchronous, unattended execution:
Jules sessions run for a long time without a supervising CLI holding a
connection. That value is realized fully only after the separate `yellow-goal`
engine gains real-provider execution, persistent waiting, and asynchronous
outcomes (spec R58-R62). v0's interactive commands and bounded supervision are
deliberate scaffolding toward that milestone, not the end state. Cursor/Devin
parity is a side effect. (R56; brainstorm decision 2026-09-09.)

## Transport verdict

**SDK adapter.** All four R3 criteria, (a) clean data-dir load, (b) explicit
flag serialization, (c) count-proven retry disablement, and (d) isolatable
in-memory storage, pass on the packed `@google/jules-sdk@0.2.0` artifact
(`packed-artifact-tested`; the canonical table is sdk-investigation.md section
10). PR2 therefore ships `src/sdk-adapter.ts`, the only file importing the SDK
(R2), configured exactly as follows (nesting matters; a top-level
`rateLimitRetry` is silently ignored, sdk-investigation.md section 6):

```text
connect({
  apiKey: <value of JULES_API_KEY, passed through, never logged>,
  config: {
    requestTimeoutMs: 60000,   // one client-wide value; reads are shortened
                               // to 30000 by the fetch guard below
    rateLimitRetry: { maxRetryTimeMs: 0 },
  },
  storageFactory: {
    activity: () => new MemoryStorage(),
    session: () => new MemorySessionStorage(),
  },
  // baseUrl is injected ONLY by tests, to a 127.0.0.1 origin, through a
  // test-only seam; it is never read from user config, env, or argv.
})
```

Constraints the verdict carries (each is a re-verification trigger on any SDK
bump):

- **Storage.** `storageFactory` is typed on `JulesOptions` but marked
  `@internal`. The adapter asserts both bindings: after `connect()`,
  `client.storage` is the injected `MemorySessionStorage` instance, and on first
  use of each session the activity storage the factory handed out is the
  injected `MemoryStorage` instance (the factory records every instance it
  creates); either mismatch is `JULES_SDK_INTEGRITY`, so a future SDK that drops
  or half-honours the option cannot fall back silently to file storage. As
  defense in depth the runtime creates `<dataDir>/sdk-scratch` (`0700`) and
  proves it writable **before** `connect()` (failure is `JULES_DATA_DIR`, never
  a fall-through), sets `JULES_HOME` to it for its own process only (never
  exported to a shell), and checks it is still empty immediately after
  `connect()` and again before exit on every SDK-using command, treating any
  file there as `JULES_SDK_INTEGRITY`; the default file storage would otherwise
  write `.jules/cache/` into cwd whenever cwd holds a `package.json` (R15).
- **Retries.** The SDK default replays POSTs on 429 and 500/502/503/504.
  `maxRetryTimeMs: 0` means no failed request is ever replayed by the SDK.
  Yellow owns bounded read retries; mutating requests are never auto-replayed
  (R14). The PR2 test asserts the server-side ordered request sequence per
  operation, not the option value. Request budgets: `delegate` is the adapter's
  own `sources.get` (`GET sources/github/{owner}/{repo}`, R17), then
  `session()`, which repeats that GET and issues one `POST sessions` (the
  duplicate GET is accepted as the price of pre-dispatch classification; the SDK
  offers no way to pass a pre-resolved source); `reply` and `approve` are one
  POST each plus the bounded reads named in their argument shapes; `status`,
  `collect`, `list`, and `setup` are read-only with the page bounds named in
  their argument shapes.
- **Timeouts.** `config.requestTimeoutMs` is one client-wide value (`types.d.ts`
  L71), so the client is built at 60 000 ms (the create POST's budget) and the
  fetch guard below races a 30 000 ms `AbortController` on every non-POST
  request; the guard can only shorten the SDK's timeout, never lengthen it.
- **Network guard (both transport branches).** `ApiClient` calls global `fetch`,
  so the adapter installs a process-local `globalThis.fetch` wrapper that
  refuses any request whose origin is not the pinned
  `https://jules.googleapis.com` origin (or the test seam's loopback origin),
  refuses any non-`https:` scheme except that loopback, passes
  `redirect: "manual"`, applies the read timeout above, records the moment each
  POST is dispatched (for outcome classification), and on any 3xx response
  **throws** instead of returning the response, so the refusal surfaces through
  the SDK's `fetchWithTimeout` as `JulesNetworkError` and classifies as
  `JULES_SERVICE_UNAVAILABLE` (pre-dispatch) or `JULES_UNKNOWN_OUTCOME` (after a
  mutating POST). `X-Goog-Api-Key` is not among the headers `fetch` strips on
  cross-origin redirects, so following a redirect would forward the credential.
- **Fresh reads.** `info()` serves the cache for terminal sessions verified
  within 24 h and for sessions older than 30 days. With per-process memory
  storage, the first `info()` on a session in a process is a fresh read provided
  no earlier call in that process upserted that session; the adapter holds that
  invariant by pinning `persist: false` on every `jules.sessions()` page read
  and by performing at most one `info()` per session per process on the `status`
  and reconcile paths. `history()` hydrates from the network on every call;
  `activities.select()` is the local read.
- **Used surface.** Only `session(config)` (`types.d.ts` L1210, `index.mjs`
  L2723-2762), `session(id)` (`types.d.ts` L1222), `session.send()`,
  `session.approve()`, `session.info()`, `session.activities.list()`
  (`ActivityClient.list`, `dist/activities/types.d.ts` L50, options
  `{ pageSize?, pageToken?, filter? }` L5-9; the direct paginated network read),
  `session.activities.select()`, `jules.sessions()` (`SessionCursor`,
  `dist/sessions.d.ts` L4-24 and L45, `index.mjs` L2620-2627; `GET sessions`
  with `pageSize`, `pageToken`, `filter`, and `persist: false`; awaited for one
  page at a time, never iterated to exhaustion), and
  `jules.sources()`/`sources.get()` are used. `run()`, `all()`, `result()`,
  `ask()`, `waitFor()`, `stream()`, `updates()`, `history()`, `hydrate()`, and
  `sync()` are never command implementations (R9). Citations are in
  sdk-investigation.md section 6 and capability-matrix.md.
- **Filters are an optimization, never a correctness dependency.** Both list
  surfaces accept an AIP-160 `filter` string and the SDK serializes it onto the
  query (`index.mjs` L1164, L1800), but whether the vendor evaluates it
  server-side, and its accepted grammar, is `source-inspected` only and listed
  as a remaining unknown. Every bound below therefore holds with the filter
  ignored: page caps and the deadline bound the walk, dedup is by activity id,
  and reconcile matches on the title tag, not on the filter. A `400` on a
  filtered request is retried once unfiltered within the same bound.

**REST contingency (not taken by PR2).** If a future re-verification fails any
criterion, the successor PR ships `src/rest-adapter.ts` against
`https://jules.googleapis.com/v1alpha` (`/sessions`, `/sources`,
`/sessions/{session}/activities`), under the same network guard above and the
yellow-devin constraints C1/C2/C4/C5/H4/H9 from
`docs/solutions/security-issues/yellow-devin-plugin-security-audit.md`. The
command surface and this contract are unchanged on that branch (R3).

## Module-strategy verdict

**CJS build with a dynamic-import boundary** (spec R6 option 2), decided by
sdk-investigation.md section 5:

- `plugins/yellow-jules/tsconfig.json` extends `../../tsconfig.base.json` and
  emits CJS with `module: node16` like `yellow-cursor`; no marketplace-wide
  module setting changes. `tsc --module node16` preserves `await import(...)` in
  CJS output (`module: commonjs` would rewrite it to `require()` and fail on the
  ESM-only package).
- `src/sdk-resolver.ts` locates the package by resolving
  `@google/jules-sdk/package.json` (workspace first, then
  `<dataDir>/runtime/node_modules` via `createRequire`), reads
  `exports["."].import`, verifies the entry file's sha256 against the value
  recorded at install (`sdkEntrySha256`, alongside the tarball `sdkIntegrity`),
  and only then loads with `await import(pathToFileURL(entry).href)`; a mismatch
  is `JULES_SDK_INTEGRITY`. The workspace branch skips the sha256 check because
  the workspace lockfile owns that guarantee. Before any resolution the
  data-directory ownership and mode check (Local state) runs, because the data
  dir hosts executable code loaded by every SDK-using command.
  `require.resolve('@google/jules-sdk')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`
  and a bare `import('@google/jules-sdk')` from the plugin cache throws
  `ERR_MODULE_NOT_FOUND`; neither is used.
- Verified on Node 24.15.0 and on the 22.22.0 floor; `engines.node >=22.22` in
  PR2's `package.json`.
- Plugin-local ESM (`"type": "module"`) also loads and remains a viable
  alternative; `require(esm)` works unflagged on both Node lines and is recorded
  as an observation only, never relied upon.

## Confirmed API-key environment variable

`JULES_API_KEY` (`packed-artifact-tested`): declared in `dist/types.d.ts` L29,
read in `dist/index.mjs` L2358, and exercised in the harness, where the env
value was sent as the `X-Goog-Api-Key` header on every request. It is the single
presence-checked credential for R23's setup probe, mirroring `CURSOR_API_KEY`;
the value is never printed. The SDK reads it at client construction and throws
`MissingApiKeyError` at the first request.

## Open Question 3: generated-file artifacts

Answer (`source-inspected`, not exercised): the pinned SDK exposes generated
files on the interactive path as the raw
`SessionResource.generatedFiles?: GeneratedFile[]` field returned by
`session.info()` (`types.d.ts` L371, mapper `index.mjs` L733). The ergonomic
`generatedFiles()` helper exists only on `SessionOutcome` from `result()`, which
R9 forbids. `GeneratedFile.content` for `modified` entries carries only the
added lines, so a generated-file artifact is never a patch. R19's `collect`
therefore reads `info().generatedFiles`, `info().outputs[]` (`changeSet` with
`gitPatch.baseCommitId`, or `pullRequest`), and activity `changeSet` artifacts;
it stages generated files under kind `generated-file` (named locally, see
"Identifier allowlist"), and only a `changeSet` qualifies as kind `patch`. The
branch is implemented, not documented as unsupported, but its live shape is a
remaining unknown until the R53 smoke.

## PR2 test implications (R49-R51)

- Packed-SDK transport tests load the real `0.2.0` artifact from a per-test data
  dir installed with `--ignore-scripts` and redirect it through the test-only
  `baseUrl` seam to `http://127.0.0.1:<port>/v1alpha`, served by
  `plugins/yellow-jules/tests/fake-http-server.ts`, the productized and hardened
  form of sdk-investigation.md appendix A (its hardening list applies).
  `baseUrl` is the only redirect that works: `ApiClient` calls global `fetch`,
  not `platform.fetch`.
- The fake server binds `127.0.0.1:0` only and refuses any other address; the
  test bootstrap wraps `globalThis.fetch` to assert every origin contacted is
  the loopback origin and that the API-key header is present (presence only,
  never the value or its length). Credentials are dummies; real tools on `PATH`
  get failing traps (R51).
- Per operation the test asserts the exact ordered path sequence server-side
  (create: `GET sources/…`, `GET sources/…`, `POST sessions`) and that the
  429/500/502/503/504 fixtures never see a replay (R14, R50). A redirect fixture
  answers `POST sessions` with a 302 to a second loopback port and asserts the
  API-key header never reaches it. A filter fixture answers a filtered list with
  `400` and asserts exactly one unfiltered retry.
- Storage isolation is asserted by `find -newer marker` over `HOME`, `XDG_*`,
  `TMPDIR`, cwd, and the data dir after every scenario, with
  `NODE_DISABLE_COMPILE_CACHE=1` set so Node's compile cache is excluded by
  environment.
- Response bodies remain illustrative shapes derived from `types.d.ts`; a
  passing packed test proves request shape, count, and side effects, not vendor
  response compatibility (`golden-fixture-parity-vs-contract-correctness`).

## Subcommands

`node dist/cli.js <subcommand> [flags]`. Ships: PR2 unless marked.

| Subcommand  | Runtime op                                                          | Authority            | Confirm              | Ships |
| ----------- | ------------------------------------------------------------------- | -------------------- | -------------------- | ----- |
| `setup`     | probe credentials, resolve SDK, probe sources                       | none                 | install consent only | PR2   |
| `delegate`  | validate packet, reserve, create session (R12)                      | grant or interactive | yes                  | PR2   |
| `list`      | one page of fresh session reads, page-scoped journal match          | none                 | no                   | PR2   |
| `status`    | fresh session read, watermarked activity paging, optional reconcile | none                 | no                   | PR2   |
| `reply`     | send message                                                        | grant or interactive | yes                  | PR2   |
| `approve`   | approve after complete re-fetch (R34)                               | grant or interactive | yes                  | PR2   |
| `collect`   | bounded artifact read, stage to disk                                | none                 | no                   | PR2   |
| `authorize` | write grant (R30)                                                   | owner                | yes                  | PR3   |
| `supervise` | one R33 pass; may call reply/approve/collect under grant            | grant required       | per grant            | PR3   |
| `integrate` | base check, worktree, apply, verify, stack handoff (R41)            | interactive          | yes                  | PR4   |

In PR2 `--grant-id` is accepted by the parser but always refused with
`JULES_CONFIRMATION_REQUIRED`, because `authorize`, the only writer of
`state/grants.json`, ships in PR3; a hand-planted grants file is never trusted.
The grant path activates with `authorize`.

### Argument shapes

Flags are `parseArgs` strict, no positionals. `<local-id>` is the locally minted
id (see "Identifier allowlist"); `--session` accepts a local id or a vendor
`sessions/{id}` resource and resolves it through the journal. Every subcommand
accepts `--deadline-ms <n>` (absolute operation deadline; defaults 120 000 for
reads, 180 000 for `delegate`, `reply`, `approve`, and `collect`). The deadline,
not a page cap, is the binding limit under slow responses: four 30 s reads
exhaust a 120 s deadline. `title` values returned by `list` and `status` have
the reconcile tag stripped for display; the tag is surfaced as `localId`
instead.

**Activity walk (used by `status`, `approve`, and `collect`; only `status`
writes journal read-state).** One `activities.list()` walk of at most 20 pages
(`pageSize` 50; 10 on `collect`, whose pages carry artifact bodies) following
`nextPageToken`, stopping on the page cap, a page failure, the deadline, or an
activity the SDK mapper cannot parse, with `partialPagination: true` and
`ok: true`, never a manufactured end of results (R18); the unparseable case
additionally sets `unmappedActivity: true`, the signal that the SDK pin needs
re-verification, and is never an error envelope on a walk. Pages are assumed to
arrive in ascending `createTime` (inferred from the SDK's own incremental filter
design, `index.mjs` L1002-1031; re-verified at the R53 smoke; either order is
safe because the watermark advances only on a complete walk).

Journal read-state ownership: `status` is the **only** writer of
`lastActivityCreateTime`, `lastActivityId`, `resumePageToken`, and the dedup
ring; `approve` and `collect` walks read the ring for counting only and never
write any of those fields, and `collect` records its own
`artifactResumePageToken` separately. Watermark rule: `lastActivityCreateTime`
and `lastActivityId` advance only after a **complete** `status` walk (no
`nextPageToken` left) to the newest activity seen; a partial walk never advances
them and records `resumePageToken` so the next `status` continues from it before
starting a fresh watermarked read. The dedup ring holds every id seen by
`status` whose `createTime` falls within the 5-minute overlap window, capped at
1000 entries; if the cap is reached the walk reports `dedupWindowExceeded: true`
and counts may inflate. Ring membership suppresses re-counting toward `new` and
re-acting under `supervise`; it **never** suppresses an activity from being
read, parsed, or used to extract plan or artifact state by `status`, `approve`,
or `collect`.

`pendingPlan` rule: every walk that observes a `planGenerated` activity with a
later `(createTime, activityId)` than the journal's stored `pendingPlan`
replaces it (`{ planId, steps, activityCreateTime }`); `planApproved` clears it;
an empty delta never clears it. `status` therefore renders the newest plan the
runtime has observed, and `approve` compares against the same field.

- `setup [--install-sdk]` →
  `{ credentialSource: "env" | "none", sdkResolution: "workspace" | "data-dir" | "missing", sdkVersion?, sdkIntegrity?, sdkEntrySha256?, sourcesReachable: CapabilityResult<{ count, truncated }> }`
  (`sdkIntegrity` and `sdkEntrySha256` are both present whenever `sdkResolution`
  is `data-dir`). The sources probe requests one page (`pageSize` 20) and
  reports `truncated: true` when a `nextPageToken` remains; an unmappable
  (non-GitHub) source degrades the probe to `{ supported: false, reason }`
  rather than failing setup. Installing requires `--install-sdk` (explicit
  consent), pins `0.2.0`, verifies the tarball sha512 against the recorded
  integrity before extraction, records `sdkEntrySha256`, and runs with
  `--ignore-scripts` (R4).
- `delegate --repo <owner/repo> --branch <ref> --prompt <text> [--title <text>] [--task-ref <id>] [--request-id <local-request-id>] [--dry-run] [--grant-id <id>]`
  →
  `{ localRequestId, localId, sessionResource, vendorState, condition, repository, requestedBranch, observedHead?, sourceResource }`;
  on failure the envelope carries `localRequestId` and `localId` so a
  reservation can be reconciled. `--dry-run` performs validation and the source
  read only and returns `{ ..., confirmationToken }` (see "Confirmation token").
  The real call always resolves the source through `sources.get` first (R17),
  reserves before the POST (R36), passes `requireApproval: true, autoPr: false`
  (R12), and sets the vendor `title` to `[yellow:<local-id>] <title>` (tag
  first, so vendor-side truncation cannot strip it; `<title>` defaults to the
  first 60 characters of the prompt when `--title` is omitted) as the reconcile
  match key; a `--title` containing `[yellow:` is `JULES_INVALID_INPUT`. R36
  duplicate-launch refusal has **no override in PR2**: the only recovery is
  reconciliation; an explicit override ships with the PR3 authority surface and
  enters the confirmation binding there.
- `list [--limit <n>] [--page-token <token>] [--archived]` →
  `{ sessions: [{ localId?, sessionResource, vendorState, condition, title, createTime }], nextPageToken?, journalOnly: [{ localId, sessionResource?, condition }] }`.
  One `GET sessions` page (`pageSize` = `--limit`, default 20, max 100,
  `persist: false`), no activity reads. `journalOnly` lists journal rows whose
  session did not appear on **this page**; it is page-scoped and never implies
  the session is gone.
- `status [--session <ref>] [--reconcile]` →
  `{ localId?, sessionResource?, vendorState?, condition?, activities?: { processed: n, new: n, pages: n, partialPagination: bool, dedupWindowExceeded: bool, unmappedActivity: bool, resumePageToken? }, pendingPlan?: { planId, steps, activityCreateTime }, outputs?: [...], policyDeviation?, reconciled?: [{ localRequestId, kind, outcome: "bound" | "ambiguous-reconcile" | "policy-deviation" | "unknown-outcome" | "not-reached", sessionResource? }] }`.
  With `--session`: one `info()`, then the activity walk from the watermark
  (`filter=create_time>"<lastActivityCreateTime minus 5 minutes>"` as an
  optimization). `--session` is required unless `--reconcile` is given.
  `--reconcile` without `--session` resolves **every** outstanding `reserved`
  and `unknown-outcome` operation; with `--session` it narrows to that session's
  operations; the session fields are absent when no session is bound. Reconcile
  by kind: `delegate` reservations are resolved by **one** shared walk of
  `jules.sessions()` (pages of 100, `persist: false`, at most 5 pages,
  `filter=create_time > "<oldest reservation time minus 5 minutes>"` as an
  optimization), matching each page against every outstanding tag with the
  anchored regex `^\[yellow:(jl-[0-9a-f]{32})\](?: |$)` and never reading
  activities per candidate; a match binds only if it is **exactly one** session
  whose `sourceContext.source` equals the reservation's validated source
  resource and whose `githubRepoContext.startingBranch` equals the reserved
  branch; more than one candidate is `ambiguous-reconcile`, a repository or
  branch mismatch is `policy-deviation`, and both leave the operation
  `unknown-outcome`. `reply` and `approve` unknown outcomes are resolved on
  their own session, never by the sessions walk: one `info()` plus the activity
  walk, looking for a `userMessaged` activity whose message digest equals the
  reservation's payload digest, or a `planApproved` whose `planId` equals the
  reservation's observed plan id; found binds, not found after a complete walk
  leaves `unknown-outcome`, a partial walk leaves `not-reached`. Operations the
  deadline prevented from being checked are reported as `not-reached`, never as
  resolved.
- `reply --session <ref> --message <text> [--request-id <id>] [--dry-run] [--grant-id <id>]`
  → `{ localRequestId, sessionResource, sent: true }`. `--dry-run` validates,
  performs one `info()`, and returns `{ ..., confirmationToken }`. The real call
  is one POST, non-blocking (R9).
- `approve --session <ref> --plan-id <evaluated plan id> [--request-id <id>] [--dry-run] [--grant-id <id>]`
  →
  `{ localRequestId, sessionResource, approvedPlanId, observedPlanIdAfter: string | null, verificationDeferred: bool, verification: { pages: n, partialPagination: bool }, policyDeviation? }`.
  `--dry-run` performs the R34 re-fetch: one `info()` (state must be
  `awaitingPlanApproval`, else `JULES_INVALID_STATE`) and an activity walk that
  starts at the journal's `pendingPlan.activityCreateTime` minus 5 minutes (no
  `pendingPlan` in the journal is `JULES_INVALID_STATE`, recovery "run
  `status`"), **not** at the watermark, so the plan is always re-read fresh from
  the vendor and the read stays bounded when the filter is honoured; it binds
  the token to the plan id observed at that moment and returns
  `{ ..., confirmationToken, observedPlanId }`. The real call repeats that
  re-fetch inside 40 % of the deadline and requires it to be **complete** (no
  `nextPageToken` left): a partial pre-POST re-fetch is never a pass and fails
  closed with `JULES_INVALID_STATE`; a complete re-fetch whose newest
  `planGenerated` differs from `--plan-id` fails closed with
  `JULES_POLICY_DEVIATION`. Only then does it issue the POST (the endpoint takes
  no plan id), then re-read from the same start point within the remaining
  budget and record a deviation on mismatch (R34). If the post-POST re-read is
  partial for any reason (page cap, page failure, deadline after the POST was
  answered `2xx`), the result is `ok: true` with `approvedPlanId` set,
  `observedPlanIdAfter: null`, `verificationDeferred: true`, and
  `verification.partialPagination: true` (recovery: run `status`), never a
  failure envelope and never `JULES_UNKNOWN_OUTCOME`.
- `collect --session <ref>` →
  `{ localId, sessionResource, artifacts: [{ kind: "patch" | "pr-ref" | "generated-file", path?, sha256?, baseCommit?, prUrl?, vendorPath?, secretShapedContent: bool, verification: "unverified" }], skipped: [{ kind, reason: "artifact-too-large" | "aggregate-cap-reached", bytes? }], activities: { pages: n, partialPagination: bool, unmappedActivity: bool }, partialStaging: bool, noSupportedArtifact: bool, policyDeviation? }`.
  One `info()` (for `outputs[]` and `generatedFiles`) plus the activity walk
  (from the session start, or from the journal's `artifactResumePageToken` when
  set, `pageSize` 10, filtered to `changeSet`-bearing activities as an
  optimization) for activity `changeSet` artifacts. Absence is encoded once:
  `artifacts: []` with `noSupportedArtifact: true`, and only when
  `partialPagination` and `partialStaging` are both `false`; a truncated walk
  returns `noSupportedArtifact: false, partialPagination: true` and is never
  treated as absence. Patch and generated-file contents are written to
  `<dataDir>/artifacts/<local-id>/` rather than held in the result envelope
  (peak memory is the parsed vendor page, which is why `collect` uses `pageSize`
  10; a response exceeding the runtime's string limits surfaces as
  `JULES_MALFORMED_RESPONSE`); files are named locally (`patch.diff`,
  `generated/<nn>-<sha256[0:12]>`), and a `manifest.json` records the vendor
  `GeneratedFile.path` as data only. Caps are degrade-and-report, never an error
  envelope, because they are exceeded by vendor data, not caller input: a single
  artifact over 25 MiB is skipped with `artifact-too-large`; once 200 artifacts
  or 100 MiB have been staged in one invocation, staging stops, remaining
  artifacts are listed in `skipped` with `aggregate-cap-reached`, and
  `partialStaging: true` is set. Never touches a checkout (R40).
- `authorize` (PR3): R30 fields; shape fixed in shell 03.
- `supervise` (PR3): `{ decision, nextCheck, ... }` per R33; shape fixed in
  shell 03.
- `integrate` (PR4): R41; shape fixed in shell 04.

### Confirmation token

Every mutating subcommand (`delegate`, `reply`, `approve`; later `authorize`,
`integrate`, and `supervise`'s writes) requires either a valid `--grant-id` (PR3
onward) or a single-use confirmation token bound to the exact operation. Binding
fields by kind: `delegate` binds kind, repository, branch, request id, task ref,
source resource, and a sha256 of the prompt; `reply` binds kind, target session,
request id, and a sha256 of the message; `approve` binds kind, target session,
request id, and the observed plan id. The token never travels in argv (argv is
world-readable on Linux and lands in shell history and transcripts); the wrapper
passes it in the `YELLOW_JULES_CONFIRMATION` environment variable of the child
process only.

**PR2 interim mechanism (explicitly provisional).** The runtime mints the token:
`--dry-run` on `delegate`, `reply`, or `approve` validates, performs the read
named in its argument shape, writes
`{ tokenSha256, bindingDigest, expiresAt (10 minutes) }` to
`<dataDir>/state/pending-confirmations.json` (`0600`; the raw token is never
stored; at most 50 entries, expired entries swept on every read), and returns
the token. The Claude wrapper shows the dry-run result, asks through
AskUserQuestion, and only on approval re-runs the command with the token in the
environment; the runtime consumes the token exactly once, inside the R31
critical section under `state/.lock`, and only when the binding digest matches.
This is the same trust level as `yellow-cursor`'s dry-run-then-`--yes` pattern,
with binding added.

**Residual risk, recorded, not hidden.** Any local process that can read the
data directory can run both steps without a human; the AskUserQuestion gate is
enforced by wrapper convention, not by the runtime, which is exactly the gap
spec R29 names as Open Question 6. The spec is self-contradictory here and this
contract does not resolve it: R29 says OQ6 is "settled in shell 03 before any
non-grant mutation ships"; Open Question 6 says "until then the runtime treats
wrapper-minted tokens as unproven and requires a grant"; and R53 requires an
owner-run smoke after PR2 "under R29's single-operation interactive
confirmation" with "no grant exists yet". **Owner decision required before PR2
implements `delegate`, `reply`, or `approve`:** (a) amend OQ6 to accept this
interim mechanism for PR2 and the R53 smoke only, with the smoke run by the
owner from Claude Code, no agent or Codex caller in scope, and OQ6 closed in
shell 03 before PR3; or (b) move `delegate`, `reply`, and `approve` to PR3
behind `authorize` and run the R53 smoke against a grant. No default is
recorded; PR2 must not start the mutating subcommands until the decision is
written into the spec. Under either option, interactive versus non-interactive
callers is never the discriminator.

## Output envelope

Exactly one JSON object on stdout per invocation; diagnostics on stderr only.

```text
{ "ok": true, "operation": "<subcommand>", ...result fields }
{ "ok": false, "operation": "<subcommand>", "localRequestId"?: "...",
  "localId"?: "...",
  "error": { "code": "JULES_*", "message": "...", "retryable": bool,
             "requestId"?: "...", "recoveryAction": "..." } }
```

`operation` is the subcommand name, or the literal `"unknown"` on a usage error
where no valid subcommand was given (mirrors `yellow-cursor`). `localRequestId`
and `localId` are echoed on every mutating path, including failures, so a caller
can reconcile an interrupted attempt (mirrors `idempotencyKey` in
`yellow-cursor/src/cli.ts`). All output passes through `redactDeep` before
`JSON.stringify`.

### Status results

Every status-bearing result carries both `vendorState` (the SDK's
`SessionState`, itself mapped from the REST enum) and a normalized `condition`
(R10):

| `vendorState`                        | `condition`         |
| ------------------------------------ | ------------------- |
| `queued`, `planning`                 | `starting`          |
| `awaitingPlanApproval`               | `awaiting-approval` |
| `awaitingUserFeedback`               | `awaiting-reply`    |
| `inProgress`                         | `working`           |
| `paused`                             | `paused`            |
| `failed`                             | `failed`            |
| `completed` (remote only)            | `remote-completed`  |
| `unspecified` or any unlisted string | `needs-inspection`  |

`remote-completed`, `locally-verified` (R43 passed), and `accepted` (R33 accept
step) are three distinct recorded states; a `condition` never advances past
`remote-completed` without a journal record from the later step. The SDK maps
any unknown REST state to `unspecified` (`index.mjs` L689-690), so the adapter
also carries the raw REST string when it differs, and `unspecified` always lands
in `needs-inspection`, never in a completed bucket.

## Error catalog

`src/errors.ts` defines `AppErrorCode`, a
`CODE_TABLE: Record<code, { retryable, recoveryAction }>` whose `recoveryAction`
is the per-code default, and
`AppError = { code, message, retryable, requestId?, recoveryAction }`; a call
site may override `recoveryAction` with a more specific instruction (as
`makeAppError` overrides do in yellow-cursor), so the table strings are floors,
not the only permitted text. `sdk-adapter.ts` classifies SDK errors by
`instanceof`, never by message text, and tests the most-derived classes first
(`JulesRateLimitError` and `JulesAuthenticationError` before their
`JulesApiError` base), because a 429 is an instance of both.

| Code                           | Retryable | Recovery action (default)                                                                                                                          |
| ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JULES_AUTH_FAILED`            | false     | set `JULES_API_KEY` (401/403 or missing key), then retry                                                                                           |
| `JULES_INVALID_INPUT`          | false     | fix the reported input or invocation and retry                                                                                                     |
| `JULES_SOURCE_ACCESS`          | false     | connect the repository to Jules; sources are discovered, never synthesized (R17)                                                                   |
| `JULES_RATE_LIMITED`           | true      | wait at least 60 s and retry; the runtime never retries a 429 itself                                                                               |
| `JULES_SERVICE_UNAVAILABLE`    | true      | retry later (pre-dispatch only; see ambiguous-outcome design)                                                                                      |
| `JULES_NOT_FOUND`              | false     | verify the session or activity reference                                                                                                           |
| `JULES_MALFORMED_RESPONSE`     | false     | report; the SDK response shape was unexpected (non-walk reads and pre-dispatch only)                                                               |
| `JULES_INVALID_STATE`          | false     | the session is not awaiting approval, or its pending plan could not be completely re-read; run `status`                                            |
| `JULES_UNSUPPORTED_CAPABILITY` | false     | not available on the vendor contract; no retry will help (R11)                                                                                     |
| `JULES_UNKNOWN_OUTCOME`        | false     | run `status --reconcile` (a `delegate`), or `status --session <ref> --reconcile` (a `reply` or `approve`); never relaunch (R16)                    |
| `JULES_JOURNAL_CORRUPT`        | false     | reconcile the journal by hand; writes are blocked (R37)                                                                                            |
| `JULES_DUPLICATE_LAUNCH`       | false     | an unresolved operation exists for this repo/branch; run `status --reconcile` first (R36; no override in PR2)                                      |
| `JULES_CONFIRMATION_REQUIRED`  | false     | run the command with `--dry-run`, confirm, then re-run with the token in `YELLOW_JULES_CONFIRMATION` (grants arrive with `authorize` in PR3) (R29) |
| `JULES_AUTHORITY_DENIED`       | false     | the grant does not cover this operation, repo, branch, or limit (R31)                                                                              |
| `JULES_GRANT_EXPIRED`          | false     | the grant or deadline expired; remote session may still run; see containment                                                                       |
| `JULES_POLICY_DEVIATION`       | false     | a vendor PR, plan change, or repository mismatch was observed; reconcile before further writes (R13)                                               |
| `JULES_DEADLINE_EXCEEDED`      | false     | the absolute operation deadline fired before any write was dispatched; no verdict recorded (R14, R33)                                              |
| `JULES_STALE_LOCK`             | false     | a lock from a crashed process exists; remove by hand after inspection (R38)                                                                        |
| `JULES_SDK_MISSING`            | false     | run `/jules:setup` to install the pinned SDK (R4)                                                                                                  |
| `JULES_SDK_INTEGRITY`          | false     | the SDK tarball, entry file, or storage binding failed verification; do not use it (R4)                                                            |
| `JULES_DATA_DIR`               | false     | the data directory is not owner-only, not owned by you, or its scratch dir is not writable (R35)                                                   |

SDK class to code (all eleven classes in `dist/errors.d.ts`). "After dispatch"
means a mutating POST has been sent and no clear rejection was received. A
mapper throw **inside an activity walk** is not an error at all: the walk stops
with `partialPagination: true, unmappedActivity: true` (see "Activity walk");
the last row below applies to the other reads (`info()`, `sources`, `sessions`)
and to pre-dispatch paths:

| SDK error class                                                                                                                                                                                 | Pre-dispatch or read        | After dispatch                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------- |
| `MissingApiKeyError`, `JulesAuthenticationError` (401/403)                                                                                                                                      | `JULES_AUTH_FAILED`         | `JULES_AUTH_FAILED` (a 401/403 answer is a clear rejection) |
| `JulesRateLimitError` (429)                                                                                                                                                                     | `JULES_RATE_LIMITED`        | `JULES_RATE_LIMITED` (clear rejection)                      |
| `SourceNotFoundError`; `JulesApiError` 404 on a `/sources` URL                                                                                                                                  | `JULES_SOURCE_ACCESS`       | n/a (source reads precede dispatch)                         |
| `JulesApiError` 404 on `/sessions…`                                                                                                                                                             | `JULES_NOT_FOUND`           | `JULES_NOT_FOUND` (clear rejection)                         |
| `JulesApiError` 400/409/422                                                                                                                                                                     | `JULES_INVALID_INPUT`       | `JULES_INVALID_INPUT` (clear rejection)                     |
| `JulesApiError` 5xx                                                                                                                                                                             | `JULES_SERVICE_UNAVAILABLE` | `JULES_UNKNOWN_OUTCOME`                                     |
| `JulesNetworkError` (fetch failure, request timeout, refused redirect thrown by the guard)                                                                                                      | `JULES_SERVICE_UNAVAILABLE` | `JULES_UNKNOWN_OUTCOME`                                     |
| `InvalidStateError`                                                                                                                                                                             | `JULES_INVALID_STATE`       | `JULES_INVALID_STATE`                                       |
| `TimeoutError` (only reachable via the forbidden `waitFor`/`result`; mapped defensively)                                                                                                        | `JULES_DEADLINE_EXCEEDED`   | `JULES_UNKNOWN_OUTCOME`                                     |
| `SyncInProgressError`, `AutomatedSessionFailedError`, other `JulesError`, non-SDK throws (the mapper's unknown-activity or unknown-artifact `Error` outside a walk, JSON parse, storage upsert) | `JULES_MALFORMED_RESPONSE`  | `JULES_UNKNOWN_OUTCOME`                                     |

Default rule: any error after dispatch that is not a clear rejection in the
table, including an unrecognized future class or one carrying no `url`,
classifies as `JULES_UNKNOWN_OUTCOME`. The one exception is a deadline firing
after a `2xx` answer to the POST, which is a known outcome and is reported as
success with `verificationDeferred: true` (see `approve`). The message field of
`JulesApiError` embeds the response body text (`index.mjs` L184); it is redacted
and truncated before it reaches any output and is never reproduced verbatim
(R7).

**Ambiguous-outcome design.** Unlike Cursor's lazy `Agent.create()`, the Jules
`session(config)` call is eager: it issues `GET sources/github/{owner}/{repo}`
and then `POST sessions` inside one promise. The adapter distinguishes
pre-dispatch from post-dispatch failures by the `url` carried on
`JulesApiError`/`JulesNetworkError` (the source GET versus the `/sessions`
POST), by its own explicit `sources.get` performed before `session()` (R17), and
by the fetch wrapper, which records the moment the POST is sent. A failure on
the source read, a 4xx on the POST, or `JulesRateLimitError` is a clear
pre-accept rejection. Any `JulesNetworkError` on the POST, any 5xx on the POST,
a refused redirect, a response-decoding or mapper throw, a storage upsert
failure, or a journal persistence failure after the POST classifies the
operation as `JULES_UNKNOWN_OUTCOME` with the reservation left in place and any
known `sessionResource` preserved; a replacement session is never launched
(R16). The same rule applies to `reply` and `approve`, whose unknown outcomes
are resolved on their own session as described under `status --reconcile`. Reads
(`list`, `status`, `collect`) retry up to 2 times with exponential backoff from
500 ms and jitter on 5xx and network errors only, inside the operation's
absolute deadline; a 429 on a read returns control immediately (no vendor
`Retry-After` is visible through the SDK); writes never retry.

## Exit codes

`0` on `ok: true`; `1` on `ok: false` for a well-formed operational failure; `2`
on a CLI usage error (unknown subcommand, missing flag, unparseable argv), which
still prints a valid
`{ ok: false, operation: "<name or unknown>", error: { code: "JULES_INVALID_INPUT", ... } }`
object (R7).

## Redaction

Mirrors `yellow-cursor/src/redact.ts`, applied on every stdout, stderr, and
state-file write, and extended to staged artifacts as stated below:

1. Exact match of the live `JULES_API_KEY` value (zero false positives).
2. `authorization: ...` header shapes and `Bearer <token>`.
3. `X-Goog-Api-Key: <value>` and any `api[-_]?key`/`apikey` field or query value
   (the SDK's own header name is added to the patterns).
4. Prefixed secret shapes (`sk-`, `pk-`, `key-`, `tok-`, `AIza` followed by 16+
   `[A-Za-z0-9_-]`).
5. `assertNoSecretShapedValues()` refuses to persist any field named `apiKey`,
   `api_key`, `token`, `authorization`, `secret`, `password`, or `prompt`, or
   any secret-shaped string; the journal stores a `promptDigest` only, and the
   confirmation store holds `tokenSha256`, never the token.
6. Vendor error text (`JulesApiError.message`, response bodies, activity text)
   is never reproduced unredacted; error messages are truncated to 512 bytes
   after redaction.
7. Any vendor-originated text a command renders (plan bodies, activity messages,
   question text, artifact contents, `suggestedCommitMessage`) is wrapped in
   `--- begin untrusted-content (reference only) ---` /
   `--- end untrusted-content ---` with delimiter-forgery escaping from the
   `security-fencing` skill (R33). `suggestedCommitMessage` is never passed to
   `git commit`, a PR title, or a PR body without human authorship.
8. **Staged artifacts.** Patches and generated files are staged byte-exact
   (redaction would invalidate the sha256 and the apply) but are scanned with
   layers 1-4; a hit sets `secretShapedContent: true` on the artifact, which
   `integrate` refuses until a human clears it. `bashOutput` and `media`
   artifacts are never staged as files; they are held only for the duration of
   the invocation and redacted before any rendering.

## Identifier allowlist (R7)

Every vendor-supplied identifier, accepted as input or returned by the API, is
validated against an anchored pattern before use in any adapter call, URL,
journal key, or filesystem path, on both transport branches. Patterns are
derived from the resource-name formats in `dist/types.d.ts`
(`source-inspected`); the vendor's actual character sets are a remaining unknown
until the R53 smoke, so these are deliberately conservative and reject rather
than widen:

| Identifier                       | Pattern or rule                                                                                                                                                                                                                                                                                                                               | Source                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------- |
| session id                       | `^[A-Za-z0-9_-]{1,128}$`                                                                                                                                                                                                                                                                                                                      | `sessions/{id}`, example `314159...`                                                       |
| session resource                 | `^sessions/[A-Za-z0-9_-]{1,128}$`                                                                                                                                                                                                                                                                                                             | `types.d.ts` L329                                                                          |
| activity id                      | `^[A-Za-z0-9_-]{1,128}$`                                                                                                                                                                                                                                                                                                                      | last segment of the activity `name`                                                        |
| activity resource                | `^sessions/[A-Za-z0-9_-]{1,128}/activities/[A-Za-z0-9_-]{1,128}$`                                                                                                                                                                                                                                                                             | `types.d.ts` L620                                                                          |
| plan id, step id                 | `^[A-Za-z0-9_-]{1,128}$`                                                                                                                                                                                                                                                                                                                      | `Plan.id`, `PlanStep.id`                                                                   |
| source resource                  | `^sources/github/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$`                                                                                                                                                                                                                                                        | `sources/github/{owner}/{repo}`; repo never `.` or `..`                                    |
| `--repo` input                   | `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$`                                                                                                                                                                                                                                                                       | GitHub owner and repo rules; `.github` stays valid                                         |
| `baseCommitId`                   | `^[0-9a-f]{40}$` or `^[0-9a-f]{64}$`                                                                                                                                                                                                                                                                                                          | `GitPatch.baseCommitId`; reaches git argv                                                  |
| `pullRequest.url`, session `url` | parse-then-compare, never a templated regex: `new URL(value)`, `protocol === "https:"`, `hostname === "github.com"`, split the pathname, strict-equal the owner and repo segments to the session's validated source, then `^/pull/[0-9]{1,10}$` on the remainder; any other value is reported as `policy-deviation`, never rendered as a link | `PullRequest.url`, `SessionResource.url`                                                   |
| `GeneratedFile.path`             | data only: recorded in `manifest.json`, never used in any filesystem operation by `collect`; `integrate` (PR4) validates it as a relative POSIX path with no `..`, no leading `/`, no symlink traversal before any apply                                                                                                                      | `GeneratedFile.path`                                                                       |
| page token, resume token         | `^(?!\.{1,2}$)[A-Za-z0-9_.=-]{1,512}$`, query parameter only, never a path                                                                                                                                                                                                                                                                    | opaque; documented as ns timestamp                                                         |
| branch / ref                     | `yellow-cursor/src/validate.ts` `validateRef` rules (`REF_METACHAR_RE`, no `..`, no leading `-`)                                                                                                                                                                                                                                              | git ref rules                                                                              |
| local id                         | `^jl-[0-9a-f]{32}$`, minted locally, the only id used in paths (R40)                                                                                                                                                                                                                                                                          | runtime                                                                                    |
| title tag                        | extracted only with `^\[yellow:(jl-[0-9a-f]{32})\](?:                                                                                                                                                                                                                                                                                         | $)`; `--title`may not contain`[yellow:`; vendor-side title trimming is a remaining unknown | runtime |
| local request id, `--task-ref`   | `^[A-Za-z0-9._:-]{1,200}$`, rejecting `__proto__`, `constructor`, `prototype`                                                                                                                                                                                                                                                                 | mirrors `validateIdempotencyKey`; journal and grant match keys                             |

A value that fails validation yields `JULES_INVALID_INPUT` (input) or
`JULES_MALFORMED_RESPONSE` (returned by the API) and is never interpolated.
Artifact staging paths and file names derive only from the local id, a local
sequence number, and content digests, never from `sessionResource` or any vendor
path.

## Unsupported capabilities (R11)

`cancel`, `pause`, `resume`, per-session cost, and exactly-once execution return
`JULES_UNSUPPORTED_CAPABILITY` with a `CapabilityResult`-style reason. The SDK
exposes no such methods (`source-inspected`); `archive`/`unarchive` exist but
are not part of this surface; REST `delete` is not treated as safe cancellation
and is unreachable from the CLI. Expiry of a grant or deadline is never reported
as remote termination (R39).

## Autonomy boundaries

- **Interactive confirmation is the default** for every mutating command
  (`delegate`, `reply`, `approve`, `authorize`, `integrate`, and `supervise`'s
  writes) until a valid grant covers it (R29), through the confirmation-token
  mechanism above, with its residual risk and the pending owner decision
  recorded there. Host hooks, prompt wording, and sandbox settings are never the
  sole enforcement layer (R31).
- **Grants** (R30, PR3): grant id, repository and source resource, branch or
  pattern, task/goal identifiers, permitted operations (subset of `create`,
  `reply`, `approve`, `collect`), max active sessions, max total tasks, max
  corrective rounds per task, absolute expiry, owner, controller identity, epoch
  reference. Trial defaults: 1 active session, 3 tasks, 2 corrective rounds, 2
  hours; never widened by the runtime or from within a session under a grant.
- **Single controller host** (R38): one data directory is the only writer; a
  local lock serializes it; stale locks fail loud; the copy-detection control is
  in Local state; the manual handoff procedure lives in
  `plugins/yellow-jules/CLAUDE.md` from PR3.
- **Out-of-band containment** (R39): vendor console stop, source-connection
  revocation, and API-key rotation are documented and reachable without a grant;
  expiry `recoveryAction` names them.
- **Artifact-first** (R12, R13, R42): sessions are created with plan approval
  required and vendor auto-PR disabled; a vendor-created PR observed on a
  session that requested none is a `policy-deviation` that stops delegation
  under the active grant; existing Jules PRs are collectable as external
  references only, never adopted, closed, rewritten, or merged. Every branch or
  PR mutation goes through the enabled stacked-PR provider with a human merge
  boundary (R41).

## Local state (R35-R38)

Data directory: `YELLOW_JULES_DATA_DIR` > `$XDG_DATA_HOME/yellow-jules` >
platform default (`~/.local/share/yellow-jules`,
`~/Library/Application Support/yellow-jules`, `%APPDATA%\yellow-jules`), never
under a source clone or the plugin cache. `0700` directories and `0600` files
are enforced at open; a non-owned or group- or world-writable data directory,
`state/`, `sdk-scratch/`, or `runtime/` is refused with `JULES_DATA_DIR` on
**every** invocation that reads state or resolves the SDK (not only
grant-consuming ones), because `runtime/node_modules/` is executable code loaded
into the process. Layout: `state/journal.json` (operation records),
`state/journal-archive/<yyyy-mm>.json` (terminal records older than 30 days,
read only on a reference miss), `state/grants.json` (written only by
`authorize`), `state/pending-confirmations.json`, `state/.lock`,
`artifacts/<local-id>/`, `sdk-scratch/` (created `0700`, must stay empty), and
`runtime/node_modules/` (the data-dir SDK install, with `sdkIntegrity` and
`sdkEntrySha256` recorded in `runtime/pin.json`).

Each operation record carries the R35 fields plus the activity read-state that
makes reads bounded across processes, written only by `status` (see "Activity
walk"): `lastActivityCreateTime`, `lastActivityId` (tie-break for equal
timestamps), `resumePageToken?`, `recentActivityIds` (the dedup ring: ids within
the 5-minute overlap window, at most 1000), `activityCount`, and `pendingPlan?`;
`collect` writes only `artifactResumePageToken?`. Retention: the ring and both
resume tokens are dropped once an operation reaches a terminal, reconciled
outcome, so a settled record is a few hundred bytes and a live one is bounded by
the ring; terminal records older than 30 days move to the archive file, so
`state/journal.json` holds only live and recent records and is rewritten whole
under the lock without growing with history. Journal, grant, and
pending-confirmation maps are built with `Object.create(null)` (or `Map`), never
by plain property assignment, so caller-supplied keys cannot reach the
prototype. Writes are reservation-first and atomic (temp file plus rename) under
the lock, and authority evaluation, token consumption, counter increment, and
reservation write are one critical section under that lock (R31); the local
request id is local deduplication only, never a vendor idempotency guarantee
(R36).

R38 copy detection (shape fixed in shell 03): a controller-identity and epoch
authority file lives **outside** `<dataDir>` on the host, records the canonical
absolute path of the data directory it authorizes, is re-read and matched on
every write, and a missing or mismatched value fails loud (`JULES_STALE_LOCK` or
a dedicated code); the journal holds only a reference to it, so a copied or
restored data directory cannot write in parallel.

The SDK's own storage is the per-process memory factory; the runtime never
creates `.jules/` anywhere and treats a populated `sdk-scratch/` as
`JULES_SDK_INTEGRITY`.

## Acceptance criteria

**PR1 (this contract's own gate):**

- The R57 exclusion list in
  [integration-plan.md](integration-plan.md#pr1-exclusion-list-r57) holds:
  `git diff --name-only main...HEAD` matches nothing under `plugins/`,
  `catalog/`, `.claude-plugin/`, `.agents/`, or `.changeset/`, and no live Jules
  session was opened.
- Both verdicts above are recorded with a decided value and no `TBD`.
- `sdk-investigation.md` holds an R3 row for each of (a)-(d) with `pass`,
  `fail`, or `not exercisable`, and `capability-matrix.md` carries no
  `live-observed` row.
- `pnpm validate:schemas`, `pnpm lint`, and `pnpm typecheck` pass, or
  pre-existing failures are listed in the PR description.

**MVP (PR1 + PR2 + the R53 smoke):** an owner can `setup`, `delegate` with
explicit flags, observe with `list`/`status`, `reply`, `approve`, and `collect`
a patch to staging with interactive confirmation on every write;
`docs/yellow-jules/smoke-result.md` exists with `result: pass` recording one
session created, plan inspected, one reply or approval within authority, an
interruption that did not duplicate the task, an independently checked patch, no
vendor PR, and no merge.
