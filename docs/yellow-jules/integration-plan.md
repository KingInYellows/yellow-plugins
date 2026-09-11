# Yellow Jules integration plan (accepted sections)

**Status:** Accepted **Source:** revision 2 (2026-09-09), reconciled to `main`
`8baa0bdd` (2026-09-10) **Verified against:** Node `v24.15.0`, npm `11.12.1`
**Spec:** `plans/specs/yellow-jules-integration.md` **Brainstorm:**
`docs/brainstorms/2026-09-09-yellow-jules-integration-brainstorm.md`

Revision 2 of the integration plan is a user-supplied planning document that is
not in this repository and was not available when this file was written (owner
decision at expansion, 2026-09-10). The four sections the spec depends on (§5,
§6, §14, §17) are **reconstructed from spec citations; revision 2 not in tree**:
each section below is rebuilt from the requirements that cite it, so later
shells depend on this file rather than on a document outside the tree. Where the
reconstruction is thinner than the original, the spec requirement is the
authority. Nothing here quotes revision 2 verbatim, so no vendor or reference
fencing is needed beyond the fences in the linked evidence.

## Motivation

Asynchronous, unattended execution, realized fully after the `yellow-goal`
engine milestone; v0 is scaffolding. The authoritative statement is the
Motivation section of [contract-v1.md](contract-v1.md) (R56; brainstorm decision
2026-09-09).

## §5 Command surface and runtime contract

Reconstructed from R7, R8, R9, R10, R11, R33, R40.

- One typed runtime behind `dist/cli.js`: exactly one JSON object on stdout,
  diagnostics on stderr, exit `0`/`1`/`2`, stable `code`/`retryable`/
  `recoveryAction`, centralized redaction, vendor error text never reproduced
  unredacted, every vendor identifier validated against an anchored allowlist
  before use in an adapter call, URL, journal key, or path; artifact paths
  derive from a locally minted id (R7). The full shape is
  [contract-v1.md](contract-v1.md).
- Commands are thin Bash wrappers with no API logic: `setup`, `list`, `status`,
  `collect` (PR2); `delegate`, `reply`, `approve` (PR3, Open Question 6
  decision); `authorize`, `supervise` (PR3); `integrate` (PR4). Every mutating
  wrapper confirms via AskUserQuestion unless a valid grant covers the operation
  (R8).
- Operations are short-lived: creation uses the interactive `session()` path;
  `run()`, `all()`, `result()`, `ask()`, `waitFor()` are never command
  implementations; messages are non-blocking; a coding session's duration is
  never a CLI timeout (R9).
- Every status result carries the raw vendor state and a normalized condition;
  unknown states map to `needs-inspection`; remote completion, local
  verification, and final acceptance are three distinct recorded states (R10).
- Cancel, pause, resume, per-session cost, and exactly-once execution return
  `JULES_UNSUPPORTED_CAPABILITY`; REST `delete` is not cancellation (R11).
- `supervise` executes exactly one bounded decision pass per invocation and is
  never a daemon; vendor text is fenced as untrusted on both hosts (R33).
- `collect` stages into `<dataDir>/artifacts/<local-id>/` without touching any
  checkout (R40).

## §6 Vendor contract

### §6.1 Creation and vendor PR policy

Reconstructed from R12, R13. Every delegated implementation session passes SDK
`requireApproval: true` and `autoPr: false` explicitly and the serialized
request must carry REST `requirePlanApproval: true` and
`automationMode: AUTOMATION_MODE_UNSPECIFIED`; REST field names never enter the
typed config (R12; PR1 captured exactly this body, sdk-investigation.md section
7). A vendor-created PR observed on a session that requested none is a
`policy-deviation`: recorded, delegation under the active grant stops, the
external PR reference is reported, and observation grants no authority to adopt,
close, rewrite, or merge it (R13).

### §6.2 Pinned artifact, install, and module loading

Reconstructed from R3, R4, R6, R55. Transport is SDK-first with a REST fallback
behind the same adapter interface, decided by PR1's four criteria (R3). The SDK
is installed into the plugin data directory only after explicit `/jules:setup`
consent, pinned to an exact version with a recorded integrity hash, verified
against that hash before use, with lifecycle scripts disabled, never per task;
resolution order is workspace, then `<dataDir>/runtime/node_modules`, else
`JULES_SDK_MISSING` (R4). The module strategy (plugin-local ESM or CJS with a
dynamic-import boundary) is chosen by PR1 evidence and never changes
marketplace-wide module settings (R6). PR1's investigation record covers
registry metadata, tarball integrity, actual exports, clean install, load
result, captured bodies, retry behaviour, and storage side effects (R55). **PR1
outcome:** SDK adapter; CJS with a dynamic-import boundary; see
[contract-v1.md](contract-v1.md).

### §6.3 Retries, deadlines, and replay

Reconstructed from R14. The SDK client is configured so hidden response-status
retries are disabled (`config.rateLimitRetry.maxRetryTimeMs: 0`), verified by a
packed-artifact test counting outgoing requests. Yellow owns bounded read
retries with backoff and jitter; mutating requests are never auto-replayed after
an ambiguous outcome; a clear 429 is distinguishable but still returns control;
every operation carries an absolute deadline in addition to per-request
timeouts; authority is rechecked before each intentional write.

### §6.4 Cache ownership and ambiguous outcomes

Reconstructed from R15, R16. The Yellow journal is the sole authority for
grants, task/session mappings, processed activity ids, and verified outcomes;
SDK storage is a bounded in-memory scratch factory; setup, import, and
operations create no state under the source checkout or plugin cache; `status`,
approval checks, and reconciliation perform fresh remote reads (R15). An error
after a mutating request may have been accepted (network loss, response
decoding, mapping, SDK cache upsert, journal persistence) classifies the
operation as `JULES_UNKNOWN_OUTCOME`, preserves any known remote session id,
never launches a replacement, and is resolved by reconciliation against remote
sessions and activities or else stops and reports (R16).

### §6.5 Sources, activities, and artifacts

Reconstructed from R17, R18, R19, R20, R49. Implementation delegation requires a
discovered GitHub source resource from the Sources API; sources are never
synthesized from owner/repo strings or created through this API (R17). Activity
retrieval paginates, deduplicates by activity id within a bounded overlap
window, and persists the identifiers and page-continuation state needed to
reread after restart. Pages are assumed to arrive in ascending `createTime`
(re-verified at the R53 smoke); restart uses overlapping reads keyed to a
`createTime` watermark that advances only after a complete walk, so a reordered
page cannot corrupt it. A resume page token is persisted across restarts as a
deliberate, recorded departure from R18's default no-durable-page-tokens rule —
a stored token the vendor rejects, or that yields no progress, is discarded and
the walk restarts from the watermark instead. A mid-traversal failure records
`partial-pagination` (never a manufactured end of results), and the walk claims
no webhook (R18). `collect` retrieves every available artifact kind (change-set
patch with base commit, external PR reference, grounded generated files) or
returns an explicit `no-supported-artifact`; a completion message alone is
non-accepted for a code-changing task; artifacts from sessions with an
unreconciled `policy-deviation` are marked by `collect` and refused by
`integrate` (R19). The journal records requested branch and observed head
separately from the artifact's actual base; SHA-pinned execution is never
advertised (R20). Evidence is layered as fake-adapter tests, packed-SDK contract
tests against a local fake HTTP server, and a human-authorized live smoke, with
every capability-matrix row labeled (R49).

## §14 Delivery plan and PR boundaries

Reconstructed from R23, R25, R54-R62.

1. **PR1, contract and investigation** (R54-R57, docs only): this directory,
   bounded by the "PR1 exclusion list (R57)" section below; existing unrelated
   baseline failures are reported, not hidden.
2. **PR2, provider, runtime, complete Claude routing** (R1-R28 read-only
   surface, R35-R37, R40, R42, R49-R52; atomic; the Open Question 6 decision
   moves R29 and `delegate`/`reply`/`approve` to PR3). `READY_JULES` ships only
   when every consumer handles it, in one PR that reverts as one; the PR
   description carries the literal enumeration-site checklist below and PR2 adds
   a validator that enumerates provider ids against each consumer site (R25).
   Setup-all covers the Jules credential probe, plugin enumeration, per-provider
   sections, status rows, setup command list, PARTIAL_TOOLING mapping, tooling
   probe, Step 2.5 acceptable-state enumeration, and the `remote-agent`
   membership list (R23).
3. **PR3, bounded authority, supervision, Codex surface** (R29-R34, R38, R39,
   R44-R48, and the `delegate`/`reply`/`approve` surface). Followed by the R53
   human smoke, committed as `docs/yellow-jules/smoke-result.md`.
4. **PR4, verification and handoff** (R41, R43, end-to-end fake scenarios).
5. **Engine milestone** (R58-R62; `yellow-goal` repository first, then the
   plugin pin bump): Provider Protocol revision, versioned process interface to
   the released CLI, references-only storage of provider ids, SHA-256 release
   asset, zero-spend compatibility job; starts only after PR4 ships and the
   owner explicitly approves; installing yellow-jules never enables live engine
   execution.

### PR2 enumeration-site checklist (R23, R24, R25)

Paste into the PR2 description and tick each site. The line locators from the
brainstorm are provisional at `6a0bcc87` and are re-anchored at implementation;
the site list, not the line numbers, is authoritative.

`plugins/yellow-core/commands/setup/all.md` (R23):

- [ ] plugin enumeration loop (brainstorm locator: line 289)
- [ ] API-key presence probe for `JULES_API_KEY`, value never printed (locator:
      lines 106-127, credential probes)
- [ ] per-provider READY/PARTIAL section (locator: lines 480-516)
- [ ] status-table rows (locator: lines 722-723)
- [ ] setup command list (locator: lines 858-886)
- [ ] Step 2.5 `PARTIAL_TOOLING` to setup-command mapping (`/jules:setup`)
- [ ] "Remote-Agent Provider Tooling" probe, which today filters
      `claude plugin list --json` for `yellow-cursor` only
- [ ] Step 2.5 acceptable-state enumeration ("not `READY_CURSOR`, `READY_DEVIN`,
      or `PARTIAL_TOOLING`"); outside the validator's marker block, caught by
      nothing mechanical
- [ ] `remote-agent` membership list inside the `setup-all-provider-groups`
      markers

`plugins/yellow-linear/commands/linear/delegate.md` (R24):

- [ ] description and `argument-hint` (locator: lines 3-4)
- [ ] `--provider` value validator, "exactly `cursor` or `devin`" (locator:
      line 41)
- [ ] `READY_*` to provider mapping (locator: lines 202-203)
- [ ] `PROVIDER="cursor"` default (locator: line 388)
- [ ] per-provider dispatch and status branches (locator: lines 566-569,
      625-628)
- [ ] per-provider error table (locator: line 666)
- [ ] inline-Node classifier invocation: a third tooling-probe argv slot after
      `TOOLING_CURSOR` and `TOOLING_DEVIN`
- [ ] `jules` dispatch branch: a fail-closed stub in PR2 (error-table row "Jules
      delegation ships in PR3", non-zero exit, no vendor call); PR3 swaps in the
      live `dist/cli.js delegate` call (Open Question 6)

Other sites (R22, R25, R26, R27, R28):

- [ ] `plugins/yellow-core/lib/remote-agent-provider-state.js`: provider-table
      row, `READY_JULES`, `--tooling-jules`, diagnostics text, stale docstring
      about `/linear:delegate` being the only consumer
- [ ] `catalog/plugins/yellow-jules.json` and `catalog/catalog.json`
      `pluginOrder`; regenerate manifests; refresh characterization snapshots
- [ ] `scripts/validate-provider-groups.js` fixtures and
      `tests/integration/validate-provider-groups.test.ts` (three-member group);
      `tests/integration/remote-agent-provider-state.test.ts` and its fixtures
      (seventh state, three-provider table); header comment "currently only
      `stacked-pr`"
- [ ] root `package.json` `typecheck` and `test:unit` `--filter yellow-jules`
- [ ] CI selectors: `validate-schemas.yml` build-job dist drift check;
      `validate-schemas-fork.yml` matrix arm; `.gitignore`
      `!plugins/yellow-jules/dist/`
- [ ] changesets for `yellow-jules`, `yellow-core`, `yellow-linear`; README,
      CLAUDE.md, AGENTS.md counts; "20 plugins" claims; `docs/upstream-pins.md`
      row
- [ ] new validator (or extension of `validate-provider-groups.js`) that fails
      when any router-table provider id is missing from a registered consumer
      site (R25)

## §17 Evidence register

Reconstructed from the J-references in R11, R12, R14, R15, R17, R18, R19, R34.
Revision 2 numbered its evidence items J1-J9; only J3, J4, J5, J7, J8, and J9
are cited by the spec. J1, J2, and J6 are not cited by any requirement and are
not reconstructed. The "PR1 status" column points at the evidence this PR
produced.

| Item | Reconstructed claim (from citing requirements)                                                                                                                           | PR1 status                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| J3   | The approval endpoint accepts no plan id (R34); the vendor contract establishes no cancel, pause, resume, cost, or exactly-once (R11); REST field names for create (R12) | `packed-artifact-tested`: `POST sessions/{id}:approvePlan` with body `{}`; absence of the operations is `source-inspected` |
| J4   | Sources come from the Sources API; the SDK constructs the resource name from `owner/repo` for lookup only (R17)                                                          | `packed-artifact-tested`: `GET sources/github/{owner}/{repo}` precedes every create                                        |
| J5   | Activities paginate with `nextPageToken` and can repeat across pages; artifacts are change sets, media, or generated files (R18, R19)                                    | pagination and dedup `packed-artifact-tested`; artifact union `source-inspected`                                           |
| J7   | `requireApproval`/`autoPr` serialize to `requirePlanApproval`/`automationMode`; the SDK keeps a local cache that must be isolated (R12, R15)                             | `packed-artifact-tested`: exact body captured; memory storage factory produces no files                                    |
| J8   | The SDK retries rate-limited responses unless `rateLimitRetry.maxRetryTimeMs` is zero (R14)                                                                              | `packed-artifact-tested`: one POST per create at 0; replay of 429 and 5xx at the default                                   |
| J9   | Cached reads are not fresh reads; status paths must read remotely (R15)                                                                                                  | `source-inspected`: `info()` cache tiers; `history()` hydrates; contract limits `info()` to one fresh read per process     |

## PR2 checklist additions (review round 1)

- A drift check over the units copied from `yellow-cursor` (`redact.ts`,
  `validateRef` and `validateIdempotencyKey`, `errors.ts`, the `config.ts`
  data-directory precedence), following the marker-delimited replica pattern
  `scripts/validate-provider-groups.js` enforces.
- The `remote-agent` group preference order: `yellow-cursor` stays the preferred
  default and Jules joins without becoming it, so the `UNSELECTED` and
  `CONFLICT` guidance text is updated deliberately alongside the provider-table
  row.
- The runtime's `SdkAdapter` port and a transport-neutral error kind union,
  against which the error catalog is expressed (the SDK class table in
  contract-v1.md is one implementation mapping); a PR2 design item, not contract
  prose.

## PR1 exclusion list (R57)

Verification uses the positive form:
`git diff --name-only main...HEAD | grep -vE '^(docs|plans)/'` prints nothing.

PR1 does not add or change any of: `plugins/yellow-jules/`;
`catalog/plugins/yellow-jules.json` or `catalog/catalog.json`; `READY_JULES` or
any row in `plugins/yellow-core/lib/remote-agent-provider-state.js`;
`plugins/yellow-core/commands/setup/all.md`;
`plugins/yellow-linear/commands/linear/delegate.md`;
`scripts/validate-provider-groups.js` or its fixtures; generated host enablement
(`.claude-plugin/`, `.agents/`, Codex or Cursor targets); the `yellow-goal`
engine; `.changeset/`; and it opens no live Jules session. The PR1 diff against
`main` is limited to `docs/`, `plans/`, and this directory.
