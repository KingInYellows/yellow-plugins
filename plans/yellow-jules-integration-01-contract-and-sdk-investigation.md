# Feature: Contract, Capability Matrix, and Isolated SDK Investigation (PR1)

## Overview

Before any runtime code exists, the integration needs a committed contract and
hard evidence about the vendor SDK. Revision 2 of the integration plan lives
outside the repository today; this shell brings its load-bearing sections into
`docs/yellow-jules/`, defines the versioned provider-CLI contract every later
shell implements, and runs a zero-spend investigation of the published
`@google/jules-sdk@0.2.0` artifact against a local fake HTTP server. Its
verdict on the four transport criteria (clean-install load, explicit flag
serialization, disable-able retries, isolatable storage) decides whether PR2
ships an SDK adapter or a REST adapter, and which module strategy the plugin
build uses.

Nothing here touches the marketplace: no plugin directory, no catalog entry,
no provider-router or consumer change, no live Jules session.

## Origin

- Spec: `plans/specs/yellow-jules-integration.md`
- Covers: R54, R55, R56, R57; partial: R3 (investigation-verdict), R6
  (strategy-selection), R49 (evidence-labels)
- Shell: yellow-jules-integration-01-contract-and-sdk-investigation

## Pattern Survey

Surveyed at `main` `8baa0bdd` (2026-09-10). Local toolchain: Node `v24.15.0`,
npm `11.12.1`, pnpm `8.15.0`.

**Registry facts already in hand (registry evidence, not tarball evidence).**
`npm view @google/jules-sdk` on 2026-09-10: `version` `0.2.0`, `dist-tags.latest`
`0.2.0`, `dist.integrity`
`sha512-fKutNR8VvzsxqKA4uYkkJUZauXhiuIu9aVpjgeMuFADKt95y7oQbRJX/QmOS74fy2yAsY6SwKnIY6cJaaG6kpQ==`,
`dist.tarball` `https://registry.npmjs.org/@google/jules-sdk/-/jules-sdk-0.2.0.tgz`,
`type: module`, `exports["."]` = `{ types: ./dist/index.d.ts, import: ./dist/index.mjs }`
(no `require` condition), `exports["./types"]` types-only, dependencies
`yaml ^2.8.2` and `zod ^3.25.76`, no `engines` field, license Apache-2.0,
repository `google-labs-code/jules-sdk`. The readme ends with "This is not an
officially supported Google product." The package is ESM-only, so a
`module: node16` CJS build cannot statically import it; that shapes the R6
question (see Step 9). The brainstorm's earlier `npm view` result is at
`docs/brainstorms/2026-09-09-yellow-jules-integration-brainstorm.md:13`.

**Readme-documented surface (documented evidence).** Default client reads
`JULES_API_KEY`; `jules.with({ apiKey, pollingIntervalMs, timeout })` is the
only documented client config; `jules.session({ prompt, source: { github,
baseBranch }, autoPr })` creates a session; `session.approve()` takes no plan
id (R34); `session.send()` is fire-and-forget, `session.ask()` blocks (R9);
`session.info()`, `session.history()` ("cached activities"), `session.updates()`,
`session.select(query)` ("query local cache") show the SDK keeps a local
cache; artifacts are `changeSet` or `media`; `result.generatedFiles()` exists
only on the `run()`/`result()` path (spec Open Question 3); error classes
`JulesError`, `JulesNetworkError`, `JulesApiError`, `JulesRateLimitError`,
`MissingApiKeyError`. The readme never mentions `requireApproval`,
`rateLimitRetry`, a storage option, or a base-URL/fetch override: those four
must be source-inspected from `dist/index.d.ts` / `dist/index.mjs` (Step 10),
and the fake-server redirect mechanism is unknown until then (Step 11).

**Contract template.** `plugins/yellow-cursor/CLAUDE.md` sections "SDK pin
policy", "CLI contract", "Error catalog" (table `Code | Retryable | Recovery
Action`, followed by an "Ambiguous-outcome design" prose subsection), and
"Local state" are the structure `contract-v1.md` mirrors. Code shapes to
mirror: `plugins/yellow-cursor/src/errors.ts` (`AppErrorCode` union,
`CODE_TABLE: Record<code, {retryable, recoveryAction}>`, `AppError =
{code, message, retryable, requestId?, recoveryAction}`, separate
`AdapterError` kinds); `src/cli.ts` (`printJson` = one line of
`JSON.stringify(redactDeep(value))`, exit 0 on `ok:true`, 1 on `ok:false`, 2
on usage error that still prints a valid `{ok:false}`); `src/redact.ts`
(layered: exact live env value, `AUTHORIZATION_HEADER_RE`, `BEARER_TOKEN_RE`,
`KEY_FIELD_RE`, `PREFIXED_SECRET_RE`, plus `assertNoSecretShapedValues()` at
write time); `src/validate.ts` (anchored allowlists, `REF_METACHAR_RE`);
`src/config.ts` (`YELLOW_CURSOR_DATA_DIR` > `XDG_DATA_HOME` > platform default);
`src/types.ts` (`SdkAdapter` interface, `CapabilityResult<T>` =
`{supported:true,value}|{supported:false,reason}` for unsupported
capabilities, R11). `src/sdk-resolver.ts` resolves via `require()` and its
`installSdk()` runs `npm install --prefix <runtimeDir> ... --no-save
--no-audit --no-fund` **without** `--ignore-scripts`; neither transfers to an
ESM-only package unchanged (Step 8, Step 9).

**Docs conventions.** `docs/` has no per-plugin directory; `docs/yellow-jules/`
is the first (spec-mandated by R54). No frontmatter in `docs/`; header style
is bold-label lines under the H1 (`**Version:** / **Last Updated:** /
**Status:**` in `docs/contracts/*.md`; `**Date:** / **Verified against:**` in
`docs/research/*.md`). The four-value evidence vocabulary and "illustrative"
fixture marking are new conventions this PR introduces; model their precision
on R55's "registry evidence, not tarball evidence" phrasing. Vendor text quoted
in docs goes inside `--- begin <name> (reference only) ---` / `--- end <name>
---` (`plugins/yellow-core/skills/security-fencing/SKILL.md`,
`docs/security.md:358`). Closest structural precedent for the investigation
record is `docs/runtime-install-smoke.md` (isolation mechanism spelled out,
"What it proves / does NOT prove" table, explicit not-in-CI framing).
`docs/spikes/*.md` are the CLI-behaviour investigation precedents.

**Validators and lint over `docs/`.** None gate this subtree:
`scripts/validate-doc-counts.js` scans four root files only;
`scripts/validate-solutions.js` is scoped to `docs/solutions/`;
`scripts/lint-error-codes.js` scans `scripts/*.js` for `ERROR-<CAT>-<N>` codes
and never matches `JULES_*`; `docs/contracts/cli-contracts.md` and
`error-codes.md` belong to the unrelated `packages/domain` catalog. markdownlint
and prettier are configured (`.markdownlint.json` line length 120,
`.prettierrc.json` `proseWrap: always` at 80) but wired into no script or CI
job. `validate-schemas.yml` triggers on `docs/**` but runs only the `pnpm
validate:*`/test/lint/typecheck targets. `changeset-check` keys on
`plugins/**` paths, so a docs-only PR needs no changeset.

**No loopback HTTP fake server exists in the repo** (`rg 'node:http|createServer('`
over `plugins/`, `tests/`, `scripts/` is empty); `plugins/yellow-cursor/tests/fake-sdk.ts`
fakes at the `SdkAdapter` interface, not the socket. The harness in Step 11 is
new; PR2 productizes it as `tests/fake-http-server.ts` (R49).

**Learnings that constrain this shell.**
`docs/solutions/code-quality/golden-fixture-parity-vs-contract-correctness.md`:
response fixtures derived from the SDK's own zod schemas are `source-inspected`
at best, never verified; keep captured *request* evidence
(`packed-artifact-tested`) distinct from *response* shapes.
`docs/solutions/code-quality/unhandled-outcome-defaults-to-success-bucket.md`:
a criterion that cannot be exercised is a fail toward REST or a listed unknown,
never a pass. `docs/solutions/security-issues/yellow-devin-plugin-security-audit.md`:
C1/C2/C4/C5/H4/H9 (no verbose curl, id validation before URL interpolation,
token never echoed in errors, exit codes checked) are the REST-branch
constraints; yellow-devin has no code-level REST client, only markdown
patterns, so `yellow-cursor/src/{validate,redact}.ts` is the code precedent.
`docs/upstream-pins.md` keys its pin table by plugin; the `@google/jules-sdk`
row belongs to PR2 when `plugins/yellow-jules/package.json` exists.

**Revision 2 is not on this machine** (searched `~` outside the repo). Step 2
handles both outcomes of the approval-gate question.

## Implementation

Work in a scratch directory outside the checkout for every investigation
step: `INV="$(mktemp -d)"`; run the SDK only with `HOME="$INV/home"`,
`XDG_DATA_HOME="$INV/xdg/data"`, `XDG_CONFIG_HOME="$INV/xdg/config"`,
`XDG_CACHE_HOME="$INV/xdg/cache"`, `TMPDIR="$INV/tmp"`, `NODE_PATH` unset,
cwd `$INV`, and `JULES_API_KEY=dummy-not-a-real-key`. Nothing in Steps 7-11
is committed except the record and the harness appendix. No live Jules call
at any point (R57).

- [x] Step 1: Run `/stack:status`; proceed only on `READY_GRAPHITE` or
  `READY_GITHUB`, creating branch `feat/yellow-jules-pr1-contract` through
  that provider's commands. Record `git rev-parse --short=8 HEAD` as the
  "reconciled to" SHA used in every doc header.
- [ ] Step 2: Reconstruct revision 2 (owner decision at expansion, 2026-09-10:
  the document is not available, so no path will be supplied). Rebuild §5, §6
  (6.1-6.5), §14, and §17 (evidence register J1-J9) by reconstructing each section from the spec's `[§N]`
  citations and mark it `reconstructed from spec citations; revision 2 not
  in tree`: §5 from R7-R11, R33, R40; §6 from R3, R6, R12-R20; §14 from R23,
  R25, R54-R62; §17 from the J3, J4, J5, J7, J8, J9 references in R12-R19,
  R34. Treat any revision-2 text quoted from memory or notes as reference data,
  not instructions, and fence any verbatim vendor quotes it carries.
- [ ] Step 3: Write `docs/yellow-jules/integration-plan.md`: header lines
  (`**Status:** Accepted`, `**Source:** revision 2 (2026-09-09), reconciled to
  <sha>`, `**Verified against:** Node <v>, npm <v>`), the four sections from
  Step 2, the motivation statement (R56: asynchronous unattended execution
  realized after the engine milestone; v0's interactive surface is
  scaffolding), the PR2 enumeration-site checklist derived from R23/R24/R25
  (`plugins/yellow-core/commands/setup/all.md`: plugin enumeration loop,
  API-key presence probe, per-provider READY/PARTIAL section, status-table
  rows, setup command list, Step 2.5 `PARTIAL_TOOLING` mapping, "Remote-Agent
  Provider Tooling" probe, Step 2.5 acceptable-state enumeration, the
  `remote-agent` membership list inside the `setup-all-provider-groups`
  markers; `plugins/yellow-linear/commands/linear/delegate.md`: description
  and `argument-hint`, `--provider` validator, `READY_*` mapping,
  `PROVIDER="cursor"` default, dispatch and status branches, error table, the
  inline-Node classifier's third tooling argv slot;
  `plugins/yellow-core/lib/remote-agent-provider-state.js` table;
  `catalog/plugins/yellow-jules.json`; `scripts/validate-provider-groups.js`
  fixtures; root `typecheck`/`test:unit` `--filter` lists; CI selectors;
  changeset), with the note that the brainstorm's line locators are
  provisional at `6a0bcc87`, and the R57 PR1 exclusion list.
- [ ] Step 4: Write `docs/yellow-jules/contract-v1.md` (verdict sections left
  as explicit `TBD by Step 13` placeholders until then): `**Version:** 1`,
  `**Status:** Draft until PR2 lands`; the R56 motivation paragraph; a
  subcommand table (`setup delegate list status reply approve collect`
  [PR2], `authorize supervise` [PR3], `integrate` [PR4]) with `Runtime op |
  Authority | Confirm` columns copied from the spec's "Command to runtime
  mapping"; per-subcommand argument shapes, with the R29 confirmation token
  marked "minting mechanism: spec Open Question 6, settled in shell 03"; the
  output envelope `{ok:true, ...}` / `{ok:false, error:{code, message,
  retryable, requestId?, recoveryAction}}` mirroring `yellow-cursor/src/cli.ts`;
  status results carrying `vendorState` plus normalized `condition`, unknown
  states mapping to `needs-inspection` (R10); the `JULES_*` error table
  (`Code | Retryable | Recovery Action`) containing at least the spec-named
  `JULES_UNSUPPORTED_CAPABILITY`, `JULES_UNKNOWN_OUTCOME`, `JULES_SDK_MISSING`,
  `JULES_SDK_INTEGRITY`, `JULES_DATA_DIR`, plus one code per failure mode in
  R7, R13, R14, R16, R17, R29, R31, R35-R39 (auth, invalid input, source
  access, rate limited, service unavailable, not found, malformed response,
  journal corrupt, duplicate launch, confirmation required, authority denied,
  grant expired, policy deviation, deadline exceeded, stale lock); exit codes
  0/1/2 (R7); redaction rules mirroring `redact.ts` layering plus "vendor
  error text is never reproduced unredacted" and R33 fencing on render; the
  identifier allowlist rule (R7) with patterns filled from the vendor resource
  formats observed in Step 10 and labeled by evidence; the
  unsupported-capability response for cancel, pause, resume, per-session
  cost, exactly-once (R11; REST `delete` is not cancellation); an "Autonomy
  boundaries" section (interactive confirmation default R29, grant fields and
  trial defaults R30, single controller host R38, out-of-band containment
  R39, artifact-first with vendor auto-PR suppressed R12/R13/R42); and an
  "Acceptance criteria" section (PR1: R57 exclusion checks pass and both
  verdicts recorded; MVP: spec MVP Scope plus the R53 smoke).
- [ ] Step 5: Write `docs/yellow-jules/capability-matrix.md` with the label
  vocabulary defined once (`documented`, `source-inspected`,
  `packed-artifact-tested`, `live-observed`) and columns `Behavior | Relied on
  by | Label | Citation | Notes`. Seed rows: API-key env var name; client
  config options; session-create flags and their REST field names; approve
  takes no plan id (R34); `send()` non-blocking (R9); activities pagination
  and ids (R18); sources list/get (R17); artifact kinds `changeSet`/`media`;
  generated-file artifacts on the interactive path (Open Question 3); retry
  configuration; storage/cache location and isolation; error classes; base
  URL override; rate-limit behavior; webhooks (none claimed, R18); session
  state enumeration (R10); vendor PR creation observability (R13). State
  explicitly that no row can carry `live-observed` in PR1 (zero-spend).
- [ ] Step 6: Write `docs/yellow-jules/fixtures.md`: illustrative CLI
  envelopes (one success and one failure per subcommand) and illustrative
  vendor request/response bodies for create, reply, approve, each inside a
  fenced JSON block whose first line above it reads `Illustrative only, not a
  captured response`. Captured request bodies from Step 11 go in
  `sdk-investigation.md`, never here.
- [x] Step 7: Registry and tarball evidence. Record `npm view
  @google/jules-sdk@0.2.0 --json` (version, `dist.integrity`, `dist.shasum`,
  `dist.tarball`, `type`, `exports`, dependencies, absence of `engines`,
  license, repository, the "not an officially supported Google product"
  readme note). Run `npm pack @google/jules-sdk@0.2.0 --pack-destination
  "$INV" --ignore-scripts`, compute `openssl dgst -sha512 -binary
  jules-sdk-0.2.0.tgz | base64 -w0`, and compare to the registry integrity;
  `tar tzf` the archive; extract it; record `package.json` verbatim
  (fenced, reference only), the `scripts` block or its absence, the actual
  `exports`, and the presence of `dist/index.mjs`, `dist/index.d.ts`,
  `dist/types.d.ts`.
- [x] Step 8: Clean install (R3 criterion a, R55). From cwd `$INV` with no
  ancestor `node_modules`: `npm install --prefix "$INV/data/runtime"
  @google/jules-sdk@0.2.0 --ignore-scripts --no-save --no-audit --no-fund
  --no-package-lock`; record `node --version`, `npm --version`, `npm ls
  --prefix "$INV/data/runtime"`, and the installed dependency set (`yaml`,
  `zod`, anything transitive). Note in the record that
  `yellow-cursor/src/sdk-resolver.ts` `installSdk()` lacks `--ignore-scripts`
  and PR2 must add it.
- [x] Step 9: Module-strategy load tests (R6). From cwd `$INV`, load by
  absolute file URL (ESM ignores `NODE_PATH`): (A) plugin-local ESM
  candidate: `node --input-type=module -e 'const m = await
  import(new URL("file://" + process.env.SDK_MJS)); console.log(Object.keys(m))'`;
  (B) CJS + dynamic-import candidate: `node -e 'import(require("node:url")
  .pathToFileURL(process.env.SDK_MJS).href).then(m => console.log(Object.keys(m)))'`;
  (C) observation only, not a spec option: `node -e
  'require(process.env.SDK_MJS)'` (`require(esm)`). Record the export list,
  whether import has side effects (files created under `$INV`, network
  attempts, `MissingApiKeyError` thrown at import versus at first call), and
  whether `JULES_API_KEY` is read eagerly. Test the Node floor `22.22` if a
  version manager is available; otherwise list it as a remaining unknown.
- [x] Step 10: Source inspection. Read `dist/index.d.ts` for the `jules.with()`
  option type (look for `apiKey`, `pollingIntervalMs`, `timeout`, any base
  URL / endpoint / `fetch` / transport option, `rateLimitRetry` and
  `maxRetryTimeMs`, any `storage` factory), the `session()` create option
  type (`requireApproval`, `autoPr`, `source`, `baseBranch`), the
  `session.approve()` signature, activities/pagination and sources types,
  artifact union members, error classes, and the session-state union. Grep
  `dist/index.mjs` for `jules.googleapis.com`, `v1alpha`,
  `requirePlanApproval`, `automationMode`, `Retry-After`, `429`,
  `maxRetryTimeMs`, filesystem writes (`writeFile`, `mkdir`, `.jules`), and
  how `fetch` is obtained (global versus injected). Fill matrix rows as
  `source-inspected` with file and line citations; derive the identifier
  allowlist patterns for Step 4 from the resource-name formats found.
- [x] Step 11: Fake-server capture (R3 criteria b, c, d). Write
  `$INV/fake-jules-server.mjs` (`node:http` on `127.0.0.1:0`, refuses any
  other bind address, appends `{method, path, headers-with-secrets-redacted,
  body}` per request to `$INV/requests.jsonl`, routes for `POST
  /v1alpha/sessions`, `GET /v1alpha/sessions/{id}`, `GET
  /v1alpha/sessions/{id}/activities` (two pages sharing one duplicate id),
  the send-message and approve-plan endpoints, and a scripted `429` then
  `503` mode; response bodies shaped from the Step 10 zod schemas). Pick the
  redirect mechanism in this order and record which was required: a
  documented option, an env var, a `globalThis.fetch` wrapper that rewrites
  the origin, an undici global dispatcher. Then, one Node process per check:
  (b) create with `requireApproval: true, autoPr: false` and assert the
  captured body has `requirePlanApproval: true` and `automationMode:
  "AUTOMATION_MODE_UNSPECIFIED"`; send a reply; approve; (c) with
  `rateLimitRetry.maxRetryTimeMs: 0` (if the option exists) run one create
  against the `429`/`503` mode and assert exactly one outgoing request per
  call; (d) configure the in-memory storage option if one exists, then diff
  `$INV/home`, `$INV/xdg`, `$INV/tmp`, and cwd before and after (`find
  "$INV" -newer "$INV/marker"`), and confirm `session.history()` or
  `session.select()` returns the just-created session inside the same
  invocation. Assert the API key header is present only on requests to the
  loopback origin, logging presence not value. Save the server script and
  every command as a fenced appendix in `sdk-investigation.md`.
- [x] Step 12: Write `docs/yellow-jules/sdk-investigation.md`: header
  (`**Date:**`, `**Verified against:** Node/npm versions, head <sha>,
  integrity value`), a "What it proves / does NOT prove" table modeled on
  `docs/runtime-install-smoke.md`, one section per R55 item (registry
  metadata; tarball integrity and local hash; actual package.json, exports,
  types; clean install with scripts disabled and recorded Node version; ESM
  load result per strategy; captured create/reply/approve request bodies,
  fenced as reference-only; retry behavior with request counts; storage side
  effects), an R3 criteria table with a row each for (a)-(d) holding
  `pass`/`fail`/`not exercisable` plus its evidence label (a criterion not
  exercised is never recorded as pass), a "Remaining unknowns" list (Node
  floor if untested, redirect mechanism caveats, anything only
  source-inspected), the note that the tarball-hash step exceeds the
  `@cursor/sdk` precedent, and the harness appendix from Step 11.
- [ ] Step 13: Record verdicts in `docs/yellow-jules/contract-v1.md`,
  replacing the placeholders: transport verdict (SDK adapter only if all four
  criteria are `pass`; any `fail` or `not exercisable` selects the REST
  adapter per R3, naming base `https://jules.googleapis.com/v1alpha`, the
  `/sessions`, `/sources`, `/sessions/{session}/activities` paths, HTTPS-only,
  fail-closed on downgrade or cross-origin redirect); module-strategy verdict
  (plugin-local ESM versus CJS with a dynamic-import boundary, from Step 9;
  `require(esm)` recorded as observation only); the confirmed API-key env var
  name (`JULES_API_KEY` per readme, re-labeled after Step 10 confirms it in
  the types) for R23; the Open Question 3 answer (generated-file artifacts
  supported on the interactive path or documented as unsupported for R19); and
  a "PR2 test implications" note stating how packed-SDK transport tests will
  redirect to the fake server (R49-R51).
- [ ] Step 14: Consistency pass across the five files: every matrix row has
  exactly one label and none is `live-observed`; every fixture block carries
  the illustrative marker; every vendor quote is fenced; the motivation
  statement appears in `contract-v1.md`; the PR2 checklist cites R23, R24,
  R25; the R3 table has no blank cells; `plans/specs/yellow-jules-integration.md`
  is untouched.
- [ ] Step 15: Validate and package. Run `pnpm validate:schemas`, `pnpm lint`,
  `pnpm typecheck`; report any pre-existing failure verbatim rather than
  hiding it (R57). Run `npx prettier --check docs/yellow-jules` (never `pnpm
  format` repo-wide). Confirm `git diff --name-only main...HEAD | grep -E
  '^(plugins|catalog|\.claude-plugin|\.agents|\.changeset)/'` prints nothing (R57
  is an exclusion list: the plan file, shell deletion, and solution docs may
  ride along), and that every new file is LF.
  Commit through the active stack provider's own commands (gt-workflow's
  `smart-submit` skill on `READY_GRAPHITE`; `gh stack` on `READY_GITHUB`);
  the PR description carries the R57 exclusion list and both verdicts.
- [ ] Step 16: List follow-ups in the PR description, not as work here: the
  `docs/upstream-pins.md` row and `--ignore-scripts` in `installSdk()` for
  PR2; `tests/fake-http-server.ts` productizing the Step 11 harness (R49);
  `docs/yellow-jules/smoke-result.md` after PR2 (R53).

## Verification

- `ls docs/yellow-jules` -> exactly `capability-matrix.md contract-v1.md
  fixtures.md integration-plan.md sdk-investigation.md`
- `git diff --name-only main...HEAD | grep -E '^(plugins|catalog|\.claude-plugin|\.agents|\.changeset)/' | wc -l`
  -> `0` (R57 exclusion list); `ls plugins/yellow-jules catalog/plugins/yellow-jules.json 2>&1`
  -> both "No such file"
- `rg -n 'READY_JULES|jules' plugins/yellow-core/lib/remote-agent-provider-state.js plugins/yellow-core/commands/setup/all.md plugins/yellow-linear/commands/linear/delegate.md catalog/`
  -> no matches (R57)
- `rg -n 'Transport verdict|Module-strategy verdict|TBD by Step 13' docs/yellow-jules/contract-v1.md`
  -> both verdict headings present with a decided value, zero `TBD` hits
- `rg -c '^\| .* \| live-observed \|' docs/yellow-jules/capability-matrix.md`
  -> `0`; every table row matches one of the four labels
- `rg -c 'Illustrative only' docs/yellow-jules/fixtures.md` equals
  `rg -c '^```json' docs/yellow-jules/fixtures.md`
- The base64 sha512 recorded in `sdk-investigation.md` equals the registry
  `dist.integrity` value recorded in the same file
- `rg -n 'R3 \(a\)|R3 \(b\)|R3 \(c\)|R3 \(d\)' docs/yellow-jules/sdk-investigation.md`
  -> four rows, each `pass`, `fail`, or `not exercisable`, none blank
- `rg -n 'JULES_API_KEY' docs/yellow-jules/contract-v1.md` -> present with an
  evidence label
- `pnpm validate:schemas && pnpm lint && pnpm typecheck` -> pass, or
  pre-existing failures listed in the PR description
- `rg -l $'\r' docs/yellow-jules` -> no output (LF only)
- `ls .changeset/*.md 2>/dev/null | grep -v README` -> unchanged from `main`
- `git diff main...HEAD -- plans/specs/yellow-jules-integration.md` -> empty

## Context Files

- `plans/specs/yellow-jules-integration.md` — R3, R6, R7-R20, R23-R25,
  R29-R53 shape the contract; R54-R57 are this shell's scope; Design
  "Transport decision", "Data model", "Command to runtime mapping"
- `docs/brainstorms/2026-09-09-yellow-jules-integration-brainstorm.md` —
  registry evidence (line 13), enumeration-site grounding, learnings pre-pass
- `plugins/yellow-cursor/CLAUDE.md` — "SDK pin policy", "CLI contract",
  "Error catalog", "Local state": the sections `contract-v1.md` mirrors
- `plugins/yellow-cursor/src/errors.ts` — `AppErrorCode`, `CODE_TABLE`,
  `AppError` shape for the `JULES_*` table
- `plugins/yellow-cursor/src/cli.ts` — one-object stdout envelope, exit-code
  semantics, `printJson`
- `plugins/yellow-cursor/src/redact.ts` — redaction layering to restate as
  contract rules
- `plugins/yellow-cursor/src/validate.ts` — anchored allowlist precedent for
  the R7 identifier rule
- `plugins/yellow-cursor/src/config.ts` — data-dir precedence mirrored by R35
- `plugins/yellow-cursor/src/sdk-resolver.ts` — `installSdk()` flags (no
  `--ignore-scripts`) and `require()`-based resolution that does not transfer
  to an ESM-only package
- `plugins/yellow-cursor/src/types.ts` — `SdkAdapter`, `CapabilityResult`
- `plugins/yellow-cursor/tests/fake-sdk.ts` — interface-level fake; contrast
  with the Step 11 socket-level harness
- `docs/runtime-install-smoke.md` — structural precedent for
  `sdk-investigation.md`
- `docs/upstream-pins.md` — pin table and bump checklist (PR2 follow-up)
- `plugins/yellow-core/skills/security-fencing/SKILL.md` — fence block for
  vendor text
- `docs/solutions/code-quality/golden-fixture-parity-vs-contract-correctness.md`
  — why response fixtures stay `source-inspected`
- `docs/solutions/code-quality/unhandled-outcome-defaults-to-success-bucket.md`
  — why an unexercised criterion is never a pass
- `docs/solutions/security-issues/yellow-devin-plugin-security-audit.md` —
  REST-branch constraints C1, C2, C4, C5, H4, H9
- `plugins/yellow-core/lib/remote-agent-provider-state.js`,
  `plugins/yellow-core/commands/setup/all.md`,
  `plugins/yellow-linear/commands/linear/delegate.md`,
  `scripts/validate-provider-groups.js` — R57 must-not-touch set; named in the
  PR2 checklist only
