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

**SDK adapter.** All four R3 criteria pass on the packed
`@google/jules-sdk@0.2.0` artifact (`packed-artifact-tested`; see
sdk-investigation.md section 10):

| R3 criterion                                  | Result |
| --------------------------------------------- | ------ |
| (a) clean data-dir load, no monorepo modules  | pass   |
| (b) explicit flag serialization               | pass   |
| (c) hidden retries disable-able, count-proven | pass   |
| (d) isolatable in-memory storage              | pass   |

PR2 therefore ships `src/sdk-adapter.ts`, the only file importing the SDK (R2),
configured exactly as follows (nesting matters; a top-level `rateLimitRetry` is
silently ignored, sdk-investigation.md section 6):

```text
connect({
  apiKey: <value of JULES_API_KEY, passed through, never logged>,
  config: {
    requestTimeoutMs: <per-request timeout, bounded by the operation deadline>,
    rateLimitRetry: { maxRetryTimeMs: 0 },
  },
  storageFactory: {
    activity: () => new MemoryStorage(),
    session: () => new MemorySessionStorage(),
  },
  // baseUrl is set ONLY by tests, to a 127.0.0.1 origin; production never sets it.
})
```

Constraints the verdict carries (each is a re-verification trigger on any SDK
bump):

- `storageFactory` is typed on `JulesOptions` but marked `@internal`. The
  adapter never uses the default file storage: with a `package.json` in cwd the
  SDK writes `.jules/cache/` into the checkout (R15).
- Retries: the SDK default replays POSTs on 429 and 500/502/503/504.
  `maxRetryTimeMs: 0` yields exactly one outgoing request per call. Yellow owns
  bounded read retries; mutating requests are never auto-replayed (R14). The PR2
  test asserts the server-side request count, not the option value.
- `info()` serves the cache for terminal sessions verified within 24 h and for
  sessions older than 30 days. With per-process memory storage the first
  `info()` in a process is always a fresh read; the adapter performs at most one
  `info()` per session per process for status and reconciliation (R15).
- `history()` is a network read on every call; `activities.select()` is the
  local read.
- Only `session(config)`, `session(id)`, `session.send()`, `session.approve()`,
  `session.info()`, `session.activities.list()/hydrate()/select()`,
  `jules.sessions()`, and `jules.sources()/sources.get()` are used. `run()`,
  `all()`, `result()`, `ask()`, `waitFor()`, `stream()`, `updates()`, and
  `sync()` are never command implementations (R9).

**REST contingency (not taken by PR2).** If a future re-verification fails any
criterion, PR2's successor ships `src/rest-adapter.ts` against the HTTPS-only
base `https://jules.googleapis.com/v1alpha` with the `/sessions`, `/sources`,
and `/sessions/{session}/activities` paths, sending `X-Goog-Api-Key` only to
that origin, refusing plain HTTP, and failing closed on any downgrade or
cross-origin redirect (`redirect: "manual"` plus origin check), with the
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
  `exports["."].import`, and loads with
  `await import(pathToFileURL(entry).href)`.
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
it stages generated files under kind `generated-file`, and only a `changeSet`
qualifies as kind `patch`. The branch is implemented, not documented as
unsupported, but its live shape is a remaining unknown until the R53 smoke.

## PR2 test implications (R49-R51)

- Packed-SDK transport tests load the real `0.2.0` artifact from a per-test data
  dir installed with `--ignore-scripts` and redirect it with
  `baseUrl: "http://127.0.0.1:<port>/v1alpha"` to
  `plugins/yellow-jules/tests/fake-http-server.ts`, the productized harness from
  sdk-investigation.md appendix A. `baseUrl` is the only redirect that works:
  `ApiClient` calls global `fetch`, not `platform.fetch`.
- The fake server binds `127.0.0.1:0` only and refuses any other address; the
  test bootstrap wraps `globalThis.fetch` to assert every origin contacted is
  the loopback origin and that the API-key header is present (presence only,
  never the value). Credentials are dummies; real tools on `PATH` get failing
  traps (R51).
- Request counts are asserted server-side per call (one `POST /sessions` per
  create at `maxRetryTimeMs: 0`; the 429/500/502/503/504 fixtures never see a
  replay), which is the R14 and R50 evidence.
- Storage isolation is asserted by `find -newer marker` over `HOME`, `XDG_*`,
  `TMPDIR`, cwd, and the data dir after every scenario, with
  `NODE_DISABLE_COMPILE_CACHE=1` set so Node's compile cache is excluded by
  environment.
- Response bodies remain illustrative shapes derived from `types.d.ts`; a
  passing packed test proves request shape, count, and side effects, not vendor
  response compatibility (`golden-fixture-parity-vs-contract-correctness`).

## Subcommands

`node dist/cli.js <subcommand> [flags]`. Ships: PR2 unless marked.

| Subcommand  | Runtime op                                               | Authority            | Confirm              | Ships |
| ----------- | -------------------------------------------------------- | -------------------- | -------------------- | ----- |
| `setup`     | probe credentials, resolve SDK, list sources             | none                 | install consent only | PR2   |
| `delegate`  | validate packet, reserve, create session (R12)           | grant or interactive | yes                  | PR2   |
| `list`      | fresh reads, activity paging, optional reconcile         | none                 | no                   | PR2   |
| `status`    | fresh reads, activity paging, optional reconcile         | none                 | no                   | PR2   |
| `reply`     | send message                                             | grant or interactive | yes                  | PR2   |
| `approve`   | approve after re-fetch (R34)                             | grant or interactive | yes                  | PR2   |
| `collect`   | fetch artifacts to staging                               | none                 | no                   | PR2   |
| `authorize` | write grant (R30)                                        | owner                | yes                  | PR3   |
| `supervise` | one R33 pass; may call reply/approve/collect under grant | grant required       | per grant            | PR3   |
| `integrate` | base check, worktree, apply, verify, stack handoff (R41) | interactive          | yes                  | PR4   |

### Argument shapes

Flags are `parseArgs` strict, no positionals. `<local-id>` is the locally minted
id (see "Identifier allowlist"); `--session` accepts a local id or a vendor
`sessions/{id}` resource and resolves it through the journal.

- `setup [--install-sdk]` →
  `{ credentialSource: "env" | "none", sdkResolution: "workspace" | "data-dir" | "missing", sdkVersion?, sdkIntegrity?, sourcesReachable: CapabilityResult<number> }`.
  Installing requires `--install-sdk` (explicit consent), pins `0.2.0`, verifies
  the tarball sha512 against the recorded integrity before extraction, and runs
  with `--ignore-scripts` (R4).
- `delegate --repo <owner/repo> --branch <ref> --prompt <text> [--title <text>] [--task-ref <id>] [--request-id <local-request-id>] [--dry-run] (--grant-id <id> | --confirmation-token <token>)`
  →
  `{ localRequestId, localId, sessionResource, vendorState, condition, repository, requestedBranch, observedHead?, sourceResource }`.
  Always resolves the source through `sources.get` first (R17), reserves before
  the POST (R36), and passes `requireApproval: true, autoPr: false` (R12).
  `--dry-run` performs validation and the source read only.
- `list [--limit <n>] [--page-token <token>] [--archived]` →
  `{ sessions: [{ localId?, sessionResource, vendorState, condition, title, createTime }], nextPageToken? }`.
  Journal rows without a live match are reported, never dropped.
- `status --session <ref> [--reconcile]` →
  `{ localId, sessionResource, vendorState, condition, activities: { processed: n, new: n, partialPagination: bool }, pendingPlan?: { planId, steps }, outputs: [...], policyDeviation?: {...} }`.
- `reply --session <ref> --message <text> [--request-id <id>] (--grant-id | --confirmation-token)`
  → `{ localRequestId, sessionResource, sent: true }`. Non-blocking (R9).
- `approve --session <ref> --plan-id <evaluated plan id> [--request-id <id>] (--grant-id | --confirmation-token)`
  →
  `{ localRequestId, sessionResource, approvedPlanId, observedPlanIdAfter, policyDeviation? }`.
  `--plan-id` is the plan the human evaluated; the runtime re-fetches, compares,
  approves (the endpoint takes no plan id), re-reads, and records a deviation on
  mismatch (R34).
- `collect --session <ref>` →
  `{ localId, artifacts: [{ kind: "patch" | "pr-ref" | "generated-file" | "none", path?, sha256?, baseCommit?, verification: "unverified" }], noSupportedArtifact: bool, policyDeviation? }`.
  Stages under `<dataDir>/artifacts/<local-id>/` and never touches a checkout
  (R40).
- `authorize` (PR3): R30 fields; shape fixed in shell 03.
- `supervise` (PR3): `{ decision, nextCheck, ... }` per R33; shape fixed in
  shell 03.
- `integrate` (PR4): R41; shape fixed in shell 04.

**Confirmation token.** Every mutating subcommand requires either a valid grant
id or a single-use `--confirmation-token` bound to the exact operation (kind,
repository, branch, request id, target session, and a digest of the complete
payload). Minting mechanism: spec Open Question 6, settled in shell 03. Until
then the runtime treats wrapper-minted tokens as unproven and requires a grant
for non-interactive callers; the PR2 Claude wrappers confirm through
AskUserQuestion and the R53 smoke runs under R29's interactive confirmation.

## Output envelope

Exactly one JSON object on stdout per invocation; diagnostics on stderr only.

```text
{ "ok": true, "operation": "<subcommand>", ...result fields }
{ "ok": false, "operation": "<subcommand>", "localRequestId"?: "...",
  "error": { "code": "JULES_*", "message": "...", "retryable": bool,
             "requestId"?: "...", "recoveryAction": "..." } }
```

`localRequestId` is echoed on every mutating path, including failures, so a
caller can reconcile an interrupted attempt (mirrors `idempotencyKey` in
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
`CODE_TABLE: Record<code, { retryable, recoveryAction }>`, and
`AppError = { code, message, retryable, requestId?, recoveryAction }`;
`sdk-adapter.ts` classifies SDK errors by `instanceof` into `AdapterError`
kinds, never by string matching on messages.

| Code                           | Retryable | Recovery action                                                                  |
| ------------------------------ | --------- | -------------------------------------------------------------------------------- |
| `JULES_AUTH_FAILED`            | false     | set `JULES_API_KEY` (401/403 or missing key), then retry                         |
| `JULES_INVALID_INPUT`          | false     | fix the reported input or invocation and retry                                   |
| `JULES_SOURCE_ACCESS`          | false     | connect the repository to Jules; sources are discovered, never synthesized (R17) |
| `JULES_RATE_LIMITED`           | true      | wait and retry with backoff; a mutation is never auto-replayed                   |
| `JULES_SERVICE_UNAVAILABLE`    | true      | retry later (pre-dispatch only; see ambiguous-outcome design)                    |
| `JULES_NOT_FOUND`              | false     | verify the session or activity reference                                         |
| `JULES_MALFORMED_RESPONSE`     | false     | report; the SDK response shape was unexpected                                    |
| `JULES_INVALID_STATE`          | false     | the session is not awaiting approval; run `status`                               |
| `JULES_UNSUPPORTED_CAPABILITY` | false     | not available on the vendor contract; no retry will help (R11)                   |
| `JULES_UNKNOWN_OUTCOME`        | false     | run `status --reconcile`; never relaunch (R16)                                   |
| `JULES_JOURNAL_CORRUPT`        | false     | reconcile the journal by hand; writes are blocked (R37)                          |
| `JULES_DUPLICATE_LAUNCH`       | false     | an unresolved operation exists for this repo/branch; reconcile or override (R36) |
| `JULES_CONFIRMATION_REQUIRED`  | false     | re-run with a confirmation token or a grant id (R29)                             |
| `JULES_AUTHORITY_DENIED`       | false     | the grant does not cover this operation, repo, branch, or limit (R31)            |
| `JULES_GRANT_EXPIRED`          | false     | the grant or deadline expired; remote session may still run; see containment     |
| `JULES_POLICY_DEVIATION`       | false     | a vendor PR or plan change was observed; reconcile before further writes (R13)   |
| `JULES_DEADLINE_EXCEEDED`      | false     | the absolute operation deadline fired; no verdict recorded (R14, R33)            |
| `JULES_STALE_LOCK`             | false     | a lock from a crashed process exists; remove by hand after inspection (R38)      |
| `JULES_SDK_MISSING`            | false     | run `/jules:setup` to install the pinned SDK (R4)                                |
| `JULES_SDK_INTEGRITY`          | false     | the downloaded tarball did not match the recorded sha512; do not use it (R4)     |
| `JULES_DATA_DIR`               | false     | the data directory is not owner-only or is not owned by you (R35)                |

SDK class to code (all eleven classes in `dist/errors.d.ts`):

| SDK error class                                                                                                                       | Code                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `MissingApiKeyError`                                                                                                                  | `JULES_AUTH_FAILED`                                                                             |
| `JulesAuthenticationError`                                                                                                            | `JULES_AUTH_FAILED`                                                                             |
| `JulesRateLimitError`                                                                                                                 | `JULES_RATE_LIMITED`                                                                            |
| `SourceNotFoundError`                                                                                                                 | `JULES_SOURCE_ACCESS`                                                                           |
| `JulesApiError` 404                                                                                                                   | `JULES_NOT_FOUND` (`/sources` URL: `JULES_SOURCE_ACCESS`)                                       |
| `JulesApiError` 400/422                                                                                                               | `JULES_INVALID_INPUT`                                                                           |
| `JulesApiError` 5xx                                                                                                                   | pre-dispatch: `JULES_SERVICE_UNAVAILABLE`; after a mutating POST: `JULES_UNKNOWN_OUTCOME`       |
| `JulesNetworkError`                                                                                                                   | pre-dispatch: `JULES_SERVICE_UNAVAILABLE`; after a mutating POST: `JULES_UNKNOWN_OUTCOME`       |
| `TimeoutError`                                                                                                                        | `JULES_DEADLINE_EXCEEDED` (only reachable via forbidden `waitFor`/`result`; mapped defensively) |
| `InvalidStateError`                                                                                                                   | `JULES_INVALID_STATE`                                                                           |
| `SyncInProgressError`, `AutomatedSessionFailedError`, other `JulesError`, non-SDK throws (mapper "Unknown activity type", JSON parse) | `JULES_MALFORMED_RESPONSE`                                                                      |

The message field of `JulesApiError` embeds the response body text (`index.mjs`
L184); it is redacted and truncated before it reaches any output and is never
reproduced verbatim (R7).

**Ambiguous-outcome design.** Unlike Cursor's lazy `Agent.create()`, the Jules
`session(config)` call is eager: it issues `GET sources/github/{owner}/{repo}`
and then `POST sessions` inside one promise. The adapter distinguishes
pre-dispatch from post-dispatch failures by the `url` carried on
`JulesApiError`/`JulesNetworkError` (the source GET versus the `/sessions` POST)
and by its own explicit `sources.get` performed before `session()` (R17). A
failure on the source read, a 4xx on the POST, or `JulesRateLimitError` is a
clear pre-accept rejection. Any `JulesNetworkError` on the POST, any 5xx on the
POST, a response-decoding or mapper throw, a storage upsert failure, or a
journal persistence failure after the POST classifies the operation as
`JULES_UNKNOWN_OUTCOME` with the reservation left in place and any known
`sessionResource` preserved; a replacement session is never launched (R16). The
same rule applies to `reply` and `approve`. Reads (`list`, `status`, `collect`)
retry up to 2 times with exponential backoff from 500 ms and jitter, inside the
operation's absolute deadline; writes never retry.

## Exit codes

`0` on `ok: true`; `1` on `ok: false` for a well-formed operational failure; `2`
on a CLI usage error (unknown subcommand, missing flag, unparseable argv), which
still prints a valid
`{ ok: false, error: { code: "JULES_INVALID_INPUT", ... } }` object (R7).

## Redaction

Mirrors `yellow-cursor/src/redact.ts`, applied on every stdout, stderr, and
state-file write:

1. Exact match of the live `JULES_API_KEY` value (zero false positives).
2. `authorization: ...` header shapes and `Bearer <token>`.
3. `X-Goog-Api-Key: <value>` and any `api[-_]?key`/`apikey` field or query value
   (the SDK's own header name is added to the patterns).
4. Prefixed secret shapes (`sk-`, `pk-`, `key-`, `tok-`, `AIza` followed by 16+
   `[A-Za-z0-9_-]`).
5. `assertNoSecretShapedValues()` refuses to persist any field named `apiKey`,
   `api_key`, `token`, `authorization`, `secret`, `password`, or `prompt`, or
   any secret-shaped string; the journal stores a `promptDigest` only.
6. Vendor error text (`JulesApiError.message`, response bodies, activity text)
   is never reproduced unredacted; error messages are truncated to 512 bytes
   after redaction.
7. Any vendor-originated text a command renders (plan bodies, activity messages,
   question text, artifact contents) is wrapped in
   `--- begin untrusted-content (reference only) ---` /
   `--- end untrusted-content ---` with delimiter-forgery escaping from the
   `security-fencing` skill (R33).

## Identifier allowlist (R7)

Every vendor-supplied identifier, accepted as input or returned by the API, is
validated against an anchored pattern before use in any adapter call, URL,
journal key, or filesystem path, on both transport branches. Patterns are
derived from the resource-name formats in `dist/types.d.ts`
(`source-inspected`); the vendor's actual character sets are a remaining unknown
until the R53 smoke, so these are deliberately conservative and reject rather
than widen:

| Identifier        | Pattern                                                                                          | Source                               |
| ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| session id        | `^[A-Za-z0-9_-]{1,128}$`                                                                         | `sessions/{id}`, example `314159...` |
| session resource  | `^sessions/[A-Za-z0-9_-]{1,128}$`                                                                | `types.d.ts` L329                    |
| activity id       | `^[A-Za-z0-9_-]{1,128}$`                                                                         | last segment of the activity `name`  |
| activity resource | `^sessions/[A-Za-z0-9_-]{1,128}/activities/[A-Za-z0-9_-]{1,128}$`                                | `types.d.ts` L620                    |
| plan id, step id  | `^[A-Za-z0-9_-]{1,128}$`                                                                         | `Plan.id`, `PlanStep.id`             |
| source resource   | `^sources/github/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9_.-]{1,100}$`                       | `sources/github/{owner}/{repo}`      |
| `--repo` input    | `^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})/[A-Za-z0-9_.-]{1,100}$`                                      | GitHub owner and repo rules          |
| page token        | `^[A-Za-z0-9_.=-]{1,512}$`, query parameter only, never a path                                   | opaque; documented as ns timestamp   |
| branch / ref      | `yellow-cursor/src/validate.ts` `validateRef` rules (`REF_METACHAR_RE`, no `..`, no leading `-`) | git ref rules                        |
| local id          | `^jl-[0-9a-f]{32}$`, minted locally, the only id used in paths (R40)                             | runtime                              |
| local request id  | `^[A-Za-z0-9._:-]{1,200}$`                                                                       | mirrors `validateIdempotencyKey`     |

A value that fails validation yields `JULES_INVALID_INPUT` (input) or
`JULES_MALFORMED_RESPONSE` (returned by the API) and is never interpolated.
Artifact staging paths derive only from the local id, never from
`sessionResource`.

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
  writes) until a valid grant covers it (R29). Host hooks, prompt wording, and
  sandbox settings are never the sole enforcement layer (R31).
- **Grants** (R30, PR3): grant id, repository and source resource, branch or
  pattern, task/goal identifiers, permitted operations (subset of `create`,
  `reply`, `approve`, `collect`), max active sessions, max total tasks, max
  corrective rounds per task, absolute expiry, owner, controller identity, epoch
  reference. Trial defaults: 1 active session, 3 tasks, 2 corrective rounds, 2
  hours; never widened by the runtime or from within a session under a grant.
- **Single controller host** (R38): one data directory is the only writer; a
  local lock serializes it; stale locks fail loud; the manual handoff procedure
  lives in `plugins/yellow-jules/CLAUDE.md` from PR3.
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
under a source clone or the plugin cache; `0700` directories and `0600` files
enforced at open, non-owned or group/world-writable paths refused for
grant-consuming operations. Layout: `state/journal.json` (operation records),
`state/grants.json` (written only by `authorize`), `state/.lock`,
`artifacts/<local-id>/`, `runtime/node_modules/` (the data-dir SDK install). The
SDK's own storage is the per-process memory factory; the runtime never sets
`JULES_HOME` and never creates `.jules/`. Writes are reservation-first, atomic
(temp file plus rename) under the lock; the local request id is local
deduplication only, never a vendor idempotency guarantee (R36).

## Acceptance criteria

**PR1 (this contract's own gate):**

- `git diff --name-only main...HEAD` matches nothing under `plugins/`,
  `catalog/`, `.claude-plugin/`, `.agents/`, or `.changeset/`; no
  `plugins/yellow-jules/`, no `catalog/plugins/yellow-jules.json`, no
  `READY_JULES`, no Linear or setup-all edit, no live Jules session (R57).
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
