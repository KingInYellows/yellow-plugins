# yellow-jules: `@google/jules-sdk@0.2.0` investigation record

**Date:** 2026-09-10 **Verified against:** Node `v24.15.0` / npm `11.12.1`
(primary), Node `v22.22.0` / npm `10.9.4` (floor check), `main` at `8baa0bdd`,
registry integrity
`sha512-fKutNR8VvzsxqKA4uYkkJUZauXhiuIu9aVpjgeMuFADKt95y7oQbRJX/QmOS74fy2yAsY6SwKnIY6cJaaG6kpQ==`
**Status:** Complete for PR1 (spec R55). Zero-spend: no request left the
loopback interface and no live Jules session was created (R57).

This record is the evidence behind the transport and module-strategy verdicts in
[contract-v1.md](contract-v1.md) and the labels in
[capability-matrix.md](capability-matrix.md). It exceeds the `@cursor/sdk`
precedent in one respect: the tarball hash was computed locally and compared to
the registry integrity value, which `plugins/yellow-cursor` never recorded for
its own pin (see
`docs/solutions/security-issues/npm-install-missing-ignore-scripts-and-integrity.md`).

Vendor-originated strings in this record are either inside a
`--- begin … (reference only) ---` fence or paraphrased with a citation; none is
quoted bare. The R53 smoke record inherits that rule.

## What it proves and what it does not

| Proves                                                                                                                               | Does NOT prove                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| The published tarball is byte-identical to the registry's integrity value and installs cleanly with lifecycle scripts disabled       | That the package is safe to run in general (no code audit beyond the greps in section 6)                 |
| The ESM entry loads from a data-dir install on Node 24.15.0 and 22.22.0 by absolute file URL, from both an ESM and a CJS caller      | Behaviour on any other Node line, on Windows, or under a bundler                                         |
| The exact JSON bodies the SDK sends for create, send-message, and approve-plan, and the exact paths                                  | What the real API accepts or returns; every response body in the harness is an illustrative shape        |
| That `config.rateLimitRetry.maxRetryTimeMs: 0` yields exactly one POST per create on 429 and 503, and that the default replays POSTs | Behaviour on network errors (`JulesNetworkError` is never retried by `ApiClient`; not exercised here)    |
| That an in-memory `storageFactory` produces zero filesystem writes and read-after-write works inside one process                     | Cross-process cache semantics; that the `@internal` `storageFactory` option survives an SDK version bump |
| Which environment variable the SDK reads for the API key and which header carries it                                                 | The API key format or how the vendor validates it                                                        |

## Isolation

Every command in this record ran from a scratch directory `INV` created with
`mktemp -d`, with `HOME="$INV/home"`, `XDG_DATA_HOME="$INV/xdg/data"`,
`XDG_CONFIG_HOME="$INV/xdg/config"`, `XDG_CACHE_HOME="$INV/xdg/cache"`,
`TMPDIR="$INV/tmp"`, `NODE_PATH` unset, cwd `$INV` (which contains no
`package.json`), and `JULES_API_KEY=dummy-not-a-real-key`. The SDK checks ran
additionally with `NODE_DISABLE_COMPILE_CACHE=1`, so the "no side effects"
findings in section 9 exclude Node's compile cache by environment, not by SDK
behaviour. No ancestor of `$INV` contained a `node_modules` directory (checked
by walking to `/`).

## 1. Registry metadata (registry evidence, not tarball evidence)

`npm view @google/jules-sdk@0.2.0 --json`, 2026-09-10:

| Field                | Value                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `version`            | `0.2.0`                                                                                           |
| `dist-tags.latest`   | `0.2.0`                                                                                           |
| `dist.integrity`     | `sha512-fKutNR8VvzsxqKA4uYkkJUZauXhiuIu9aVpjgeMuFADKt95y7oQbRJX/QmOS74fy2yAsY6SwKnIY6cJaaG6kpQ==` |
| `dist.shasum`        | `0e5f226d6338b66637e647df0c9f07175272802c`                                                        |
| `dist.tarball`       | `https://registry.npmjs.org/@google/jules-sdk/-/jules-sdk-0.2.0.tgz`                              |
| `dist.fileCount`     | `37`                                                                                              |
| `dist.unpackedSize`  | `561950`                                                                                          |
| `type`               | `module`                                                                                          |
| `exports["."]`       | `{ "types": "./dist/index.d.ts", "import": "./dist/index.mjs" }` (no `require` condition)         |
| `exports["./types"]` | `{ "types": "./dist/types.d.ts" }` (types only)                                                   |
| `dependencies`       | `yaml ^2.8.2`, `zod ^3.25.76`                                                                     |
| `engines`            | absent                                                                                            |
| `license`            | `Apache-2.0`                                                                                      |
| `repository`         | `git+https://github.com/google-labs-code/jules-sdk.git`, `gitHead e6fc09fe`                       |
| `publishConfig`      | `registry: https://wombat-dressing-room.appspot.com`                                              |
| `versions`           | `0.0.1` … `0.0.6`, `0.1.0`, `0.2.0` (first publish 2026-01-23, `0.2.0` on 2026-03-09)             |

The readme ends with a note that the project is not an officially supported
Google product and is not eligible for Google's open-source vulnerability
rewards program. The readme mentions `JULES_API_KEY`, `with(`,
`pollingIntervalMs`, `timeout`, `autoPr`, `approve(`, `generatedFiles`,
`MissingApiKeyError`, and `JulesRateLimitError`; it never mentions
`requireApproval`, `rateLimitRetry`, `maxRetryTimeMs`, `storage`, `baseUrl`, or
`fetch` (grep counts of the packed `README.md`).

## 2. Tarball integrity and local hash

```bash
npm pack @google/jules-sdk@0.2.0 --pack-destination "$INV" --ignore-scripts
# -> google-jules-sdk-0.2.0.tgz (37 files)
openssl dgst -sha512 -binary google-jules-sdk-0.2.0.tgz | base64 -w0
# -> fKutNR8VvzsxqKA4uYkkJUZauXhiuIu9aVpjgeMuFADKt95y7oQbRJX/QmOS74fy2yAsY6SwKnIY6cJaaG6kpQ==
openssl dgst -sha1 google-jules-sdk-0.2.0.tgz
# -> 0e5f226d6338b66637e647df0c9f07175272802c
```

Local sha512 (base64) equals the registry `dist.integrity` payload exactly;
local sha1 equals `dist.shasum`. Label: `packed-artifact-tested`.

`tar tzf` listing (37 entries): `package/package.json`, `package/README.md`,
`package/dist/index.mjs`, `package/dist/index.mjs.map`, and 33 `.d.ts` files
under `package/dist/` (`index`, `types`, `client`, `session`, `sessions`,
`sources`, `api`, `artifacts`, `errors`, `mappers`, `polling`, `retry-utils`,
`caching`, `snapshot`, `streaming`, `utils`,
`activities/{client,summary,types}`, `network/adapter`, `platform/{node,types}`,
`query/{computed,projection,schema,select,validate}`,
`storage/{cache-info,memory,node-fs,root,types}`, `utils/page-token`). There is
no `dist/types.d.mts`, no CJS build, and no source `.ts` in the tarball;
`dist/index.mjs` is 4369 lines, unminified, with a source map.

## 3. Actual `package.json`, exports, and types

Packed `package/package.json`, verbatim:

```text
--- begin @google/jules-sdk@0.2.0 package.json (reference only) ---
{
  "name": "@google/jules-sdk",
  "version": "0.2.0",
  "type": "module",
  "description": "Official Jules TypeScript SDK",
  "repository": {
    "type": "git",
    "url": "https://github.com/google-labs-code/jules-sdk.git"
  },
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs"
    },
    "./types": {
      "types": "./dist/types.d.ts"
    },
    "./package.json": "./package.json"
  },
  "files": [
    "dist/",
    "README.md"
  ],
  "scripts": {
    "build": "vite build",
    "test": "vitest",
    "type-check": "tsc --project tsconfig.test.json"
  },
  "keywords": [
    "jules",
    "ai",
    "agent",
    "sdk",
    "developer-tools"
  ],
  "author": "Google LLC",
  "license": "Apache-2.0",
  "publishConfig": {
    "registry": "https://wombat-dressing-room.appspot.com",
    "access": "public"
  },
  "dependencies": {
    "yaml": "^2.8.2",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.15.0",
    "js-yaml": "^4.1.0",
    "jsdom": "^27.1.0",
    "msw": "^2.10.4",
    "typescript": "^5.8.3",
    "vite": "^7.3.0",
    "vite-plugin-dts": "^4.5.4",
    "vitest": "^3.2.4"
  }
}
--- end @google/jules-sdk@0.2.0 package.json ---
```

Observations: the `scripts` block contains only `build`, `test`, and
`type-check`; there is no `preinstall`, `install`, `postinstall`, or `prepare`
script, so `--ignore-scripts` disables nothing today but stays mandatory as a
policy (a future version could add one). `dist/index.mjs`, `dist/index.d.ts`,
and `dist/types.d.ts` are all present. `@types/node ^22.15.0` in
`devDependencies` is the only hint of a Node floor; the package declares no
`engines`.

## 4. Clean install with lifecycle scripts disabled (R3 criterion a)

```bash
npm install --prefix "$INV/data/runtime" @google/jules-sdk@0.2.0 \
  --ignore-scripts --no-save --no-audit --no-fund --no-package-lock
```

Node `v24.15.0`, npm `11.12.1`. Resulting tree
(`npm ls --prefix "$INV/data/runtime"`):

```text
/tmp/…/data/runtime
├── @google/jules-sdk@0.2.0 extraneous
├── yaml@2.9.0 extraneous
└── zod@3.25.76 extraneous
```

"extraneous" is expected: `--no-save` with no `package.json` in the prefix means
nothing declares the dependency; it is not an error. The installed
`package.json`, `dist/index.mjs`, and `dist/index.d.ts` are byte-identical to
the packed tarball (`cmp` over the three files). `yaml` resolved to `2.9.0`, not
`2.8.2`: transitive dependencies float under `^`, which is a pin-policy input
for PR2 (record the resolved transitive set in `docs/upstream-pins.md` or ship a
lockfile-equivalent). Install evidence is the tree above and the byte
comparison, not the shell exit code (the install command was piped through
`tail`, which masks `npm`'s exit status).

`plugins/yellow-cursor/src/sdk-resolver.ts` `installSdk()` runs the equivalent
`npm install --prefix … --no-save --no-audit --no-fund` **without**
`--ignore-scripts`; PR2 must add it (follow-up in the PR description).

## 5. ESM load result per module strategy (R6)

`SDK_MJS="$INV/data/runtime/node_modules/@google/jules-sdk/dist/index.mjs"`.
Each check is one Node process, cwd `$INV`, `NODE_PATH` unset.

| Strategy                                                                                 | Node 24.15.0   | Node 22.22.0   | Notes                                                      |
| ---------------------------------------------------------------------------------------- | -------------- | -------------- | ---------------------------------------------------------- |
| (A) ESM caller: `node --input-type=module -e 'await import(new URL("file://"+SDK_MJS))'` | loads, 32 keys | loads, 32 keys | import took ~10 ms                                         |
| (B) CJS caller: `node -e 'import(pathToFileURL(SDK_MJS).href)'`                          | loads, 32 keys | loads, 32 keys | spec option; chosen strategy, see contract-v1.md           |
| (C) `node -e 'require(SDK_MJS)'` (`require(esm)`; observation only, not a spec option)   | loads, 32 keys | loads, 32 keys | unflagged `require(esm)` since Node 22.12; not relied upon |

Exported keys (both strategies): `ACTIVITY_SCHEMA`,
`AutomatedSessionFailedError`, `BashArtifact`, `ChangeSetArtifact`,
`FILTER_OP_SCHEMA`, `InvalidStateError`, `JulesApiError`,
`JulesAuthenticationError`, `JulesClientImpl`, `JulesError`,
`JulesNetworkError`, `JulesRateLimitError`, `MemorySessionStorage`,
`MemoryStorage`, `MissingApiKeyError`, `NodePlatform`, `PROJECTION_SCHEMA`,
`SESSION_SCHEMA`, `SessionCursor`, `SourceNotFoundError`, `SyncInProgressError`,
`TimeoutError`, `connect`, `formatValidationResult`, `generateMarkdownDocs`,
`generateTypeDefinition`, `getAllSchemas`, `getSchema`, `jules`, `parseUnidiff`,
`toSummary`, `validateQuery`.

Import side effects: no file created under `$INV/home`, `$INV/xdg`, `$INV/tmp`,
or `$INV/data` (`find -newer marker`); no network activity
(`NODE_DEBUG=net,http` printed nothing). With `JULES_API_KEY` unset, the import
succeeds, `jules.with({})` succeeds, and the first request
(`jules.session("s-1").info()`) throws `MissingApiKeyError`, whose message
(paraphrased; `index.mjs` L64) says the key is missing and names the constructor
option and the `JULES_API_KEY` variable as the two ways to supply it. The env
var is read eagerly at client construction (`dist/index.mjs` L2358, run at
module evaluation for the default `jules` export via `connect()` at L4334) but
the throw is deferred to the first request (L135-139).

Resolver facts for PR2 (CJS caller anchored in the runtime dir via
`createRequire`): `resolve('@google/jules-sdk')` throws
`ERR_PACKAGE_PATH_NOT_EXPORTED` (the exports map has no `require` condition);
`resolve('@google/jules-sdk/package.json')` succeeds; reading
`exports["."].import` from it and calling `import(pathToFileURL(entry).href)`
loads the module. A bare `import('@google/jules-sdk')` from a file outside the
runtime dir throws `ERR_MODULE_NOT_FOUND`, and a plain `require.resolve` from
cwd throws `MODULE_NOT_FOUND`. `tsc 5.9.3` with `--module node16` emits
`await import(...)` unchanged in a CJS file; with `--module commonjs` it
rewrites it to `Promise.resolve(...).then(s => require(s))`, which would fail on
an ESM-only package. The repo base config is `NodeNext`; `plugins/yellow-cursor`
uses `node16`.

## 6. Source inspection (`source-inspected`)

Citations are `dist/types.d.ts` (`T`) and `dist/index.mjs` (`M`) line numbers in
the packed `0.2.0` artifact.

- **Client options** (`JulesOptions`, T26-95): `apiKey?` (T32; falls back to
  `JULES_API_KEY`, T29; sent as the `X-Goog-Api-Key` header, T30 and M136),
  `apiKey_TEST_ONLY_DO_NOT_USE_IN_PRODUCTION?` (deprecated, T40), `baseUrl?`
  (default `https://jules.googleapis.com/v1alpha`, T45 and M2359),
  `storageFactory?` (`@internal`, T51; shape
  `{ activity(sessionId) => ActivityStorage, session() => SessionStorage }`,
  T9-12), `platform?` (`@internal`, T57), `config?.pollingIntervalMs` (default
  5000, T66), `config?.requestTimeoutMs` (default 30000, T71),
  `config?.rateLimitRetry?.{maxRetryTimeMs (default 300000), baseDelayMs (1000), maxDelayMs (30000)}`
  (T77-93, M110-113). The retry knob is nested under `config`; a top-level
  `rateLimitRetry` is ignored (M2368 reads `options.config?.rateLimitRetry`).
- **Retry loop** (M151-173): on `!response.ok`, if status is `429` **or**
  `500/502/503/504`, and `elapsed < maxRetryTimeMs`, the SDK sleeps
  `min(baseDelayMs * 2^n, maxDelayMs)` and re-issues the same request (POST
  included). With `maxRetryTimeMs: 0` the condition is false on the first
  failure, so the request is issued exactly once. After the window, `429` throws
  `JulesRateLimitError`; other statuses fall through to
  `401/403 -> JulesAuthenticationError` and `default -> JulesApiError` whose
  message embeds the response body text (M183-190). `fetchWithTimeout`
  (M202-215) wraps global `fetch` with an `AbortController` and throws
  `JulesNetworkError` on any fetch failure; there is no retry on network errors.
  `ApiClient` calls the global `fetch` (M209), not `platform.fetch` (M3161), so
  `platform` injection would not redirect traffic; `baseUrl` is the only
  redirect mechanism.
- **Session creation** (M2723-2762 interactive `session()`, M2685-2722 automated
  `run()`): `_prepareSessionCreation` (M2638-2659) calls
  `sources.get({ github })`, which issues `GET sources/github/{owner}/{repo}`
  (M319-321) and throws `SourceNotFoundError` on 404 (M2647). The POST body is
  `{ prompt, title, sourceContext: { source: <source.name>, githubRepoContext: { startingBranch } }, automationMode: autoPr === false ? "AUTOMATION_MODE_UNSPECIFIED" : "AUTO_CREATE_PR", requirePlanApproval: requireApproval ?? true }`
  (M2743-2746; `run()` defaults `requirePlanApproval` to `false`, M2692). The
  created session is upserted into session storage (M2750) and the
  `SessionClientImpl` strips a leading `sessions/` from the id it is given
  (M1424).
- **Send and approve**: `send(prompt)` is `POST sessions/{id}:sendMessage` with
  body `{ prompt }` (M1526-1531); `approve()` is
  `POST sessions/{id}:approvePlan` with body `{}` (M1507-1512). Neither takes or
  sends a plan id (R34). `archive`/`unarchive` are
  `POST sessions/{id}:archive|:unarchive`.
- **Reads**: `info()` (M1666-1687) returns the cached resource when
  `isCacheValid` (terminal state verified within 24 h, or older than 30 days,
  `dist/caching.d.ts`), otherwise `GET sessions/{id}` and upsert. Activities:
  `GET sessions/{id}/activities` with `pageSize`, `pageToken`, `filter`
  (M1155-1173); `hydrate()` (M1002-1031) walks `nextPageToken`, skips ids
  already in storage (dedup by id), and on later passes adds
  `filter=create_time>"<latest createTime>"`. `history()` on
  `DefaultActivityClient` always calls `hydrate()` first (M980-985), so it is a
  network read despite the interface JSDoc (T936-939), which claims the method
  opens no network connection. Page tokens are documented as nanosecond
  timestamps (`dist/utils/page-token.d.ts`). `streamActivities` (M794-879)
  dedups by `(createTime, id)` and retries only the first `404` up to 10 times.
- **Session enumeration and direct activity list**: `jules.sessions(options)`
  (T1265; `dist/sessions.d.ts` L483-503: `pageSize`, `pageToken`, `limit`,
  `persist` default `true` = write-through to session storage, `filter`) returns
  a `SessionCursor` (exported, `dist/index.d.ts` L27) that is thenable for one
  page (`GET sessions`, M2620-2627) and async-iterable for all pages.
  `session.activities.list(options)` is `ActivityClient.list`
  (`dist/activities/types.d.ts` L1461-1464, "NETWORK LIST"), implemented by
  `DefaultActivityClient.list` over `NetworkAdapter.listActivities`
  (M1155-1173); it is the one paginated activity read that does not go through
  `hydrate()`. Neither was exercised by the harness (`source-inspected`).
- **Storage default** (M4327-4330): `NodeFileStorage`/`NodeSessionStorage`
  rooted at `getRootDir()` (M349-369): `JULES_HOME` if writable, else **cwd if
  it contains a `package.json`**, else `HOME`, else `os.homedir()`, else
  `TMPDIR`/`TMP`/`/tmp`. Files:
  `.jules/cache/<sessionId>/{activities.jsonl, metadata.json, session.json}` and
  `.jules/cache/sessions.jsonl`; sync checkpoints at
  `.jules/cache/sync-checkpoint.json` (M2513). `MemoryStorage` (M4230) and
  `MemorySessionStorage` (M4290) are exported.
- **Resource-name formats** (types only; the harness echoes its own ids and is
  not evidence of vendor id shape): sessions `sessions/{id}` with JSDoc example
  `sessions/314159...` (T329), activities
  `sessions/{session}/activities/{activity}` (T620), sources
  `sources/github/{owner}/{repo}` with short id `github/{owner}/{repo}`
  (T212-218, M319), plans `Plan.id` and `PlanStep.id` strings (T378-392).
- **State enumeration** (M669-692): REST `STATE_UNSPECIFIED`, `QUEUED`,
  `PLANNING`, `AWAITING_PLAN_APPROVAL`, `AWAITING_USER_FEEDBACK`, `IN_PROGRESS`,
  `PAUSED`, `FAILED`, `COMPLETED` map to SDK `unspecified`, `queued`,
  `planning`, `awaitingPlanApproval`, `awaitingUserFeedback`, `inProgress`,
  `paused`, `failed`, `completed`; **any unknown REST string maps to
  `unspecified`** (M689-690), which the adapter must treat as `needs-inspection`
  (R10), never as a known state.
- **Artifacts and outputs**: activity artifacts are `changeSet` (with
  `gitPatch.{unidiffPatch, baseCommitId, suggestedCommitMessage}`, T397-418),
  `media` (`{data, mimeType}`), and `bashOutput` (T596-613, M583-597; an unknown
  artifact key throws). Session outputs are `pullRequest`
  (`{url,title,description,baseRef?,headRef?}`) or `changeSet` (T298-304,
  M709-723). `SessionResource.generatedFiles?: GeneratedFile[]` is passed
  through by the mapper (M733) and is readable from `info()` on the interactive
  path; the ergonomic `generatedFiles()` helper exists only on `SessionOutcome`
  from `result()` (T798). `GeneratedFile.content` for `modified` files carries
  only the added lines (T463).
- **Activity types** (M598-668): `agentMessaged`, `userMessaged`,
  `planGenerated` (carries `plan: { id, steps[], createTime }`), `planApproved`
  (`planId`), `progressUpdated`, `sessionCompleted`, `sessionFailed` (`reason`);
  an unknown activity key throws a plain `Error` whose message names an unknown
  activity type (M667).
- **Error classes** (`dist/errors.d.ts`): `JulesError`,
  `JulesNetworkError {url}`, `JulesApiError {url,status,statusText}`,
  `JulesAuthenticationError` (401/403), `JulesRateLimitError` (429),
  `MissingApiKeyError`, `SourceNotFoundError`, `AutomatedSessionFailedError`,
  `TimeoutError`, `SyncInProgressError`, `InvalidStateError`. Eleven classes;
  the readme names five.
- **Operations the SDK does not offer**: no cancel, pause, resume, delete, or
  cost method on `SessionClient` or `JulesClient` (T922-1046, T1180-1320); no
  webhook registration anywhere in the bundle (`grep -c webhook` = 0).

## 7. Captured request bodies (`packed-artifact-tested`)

Check (b):
`connect({ baseUrl: <loopback>, config: { rateLimitRetry: { maxRetryTimeMs: 0 } } })`
with the default (file) storage, then
`client.session({ prompt, title, source: { github: "octo/repo", baseBranch: "main" }, requireApproval: true, autoPr: false })`,
`session.send(...)`, `session.approve()`, `session.info()`, and
`for await (a of session.history())`. Server-side capture, secrets redacted to
presence, the `host` and hop-by-hop headers dropped:

```text
--- begin captured requests, check (b) (reference only) ---
{"seq":1,"method":"GET","path":"/v1alpha/sources/github/octo/repo","query":{},"headers":{"content-type":"application/json","x-goog-api-key":"<present>","user-agent":"node"},"status":200}
{"seq":2,"method":"POST","path":"/v1alpha/sessions","query":{},"headers":{"content-type":"application/json","x-goog-api-key":"<present>","user-agent":"node","content-length":"247"},"body":{"prompt":"Investigate only. Do not change files.","title":"pr1-check-b","sourceContext":{"source":"sources/github/octo/repo","githubRepoContext":{"startingBranch":"main"}},"automationMode":"AUTOMATION_MODE_UNSPECIFIED","requirePlanApproval":true},"status":200}
{"seq":3,"method":"POST","path":"/v1alpha/sessions/4242424242:sendMessage","query":{},"headers":{"content-type":"application/json","x-goog-api-key":"<present>","user-agent":"node","content-length":"31"},"body":{"prompt":"reply from check-b"},"status":200}
{"seq":4,"method":"POST","path":"/v1alpha/sessions/4242424242:approvePlan","query":{},"headers":{"content-type":"application/json","x-goog-api-key":"<present>","user-agent":"node","content-length":"2"},"body":{},"status":200}
{"seq":5,"method":"GET","path":"/v1alpha/sessions/4242424242","query":{},"headers":{"content-type":"application/json","x-goog-api-key":"<present>","user-agent":"node"},"status":200}
{"seq":6,"method":"GET","path":"/v1alpha/sessions/4242424242/activities","query":{},"headers":{"content-type":"application/json","x-goog-api-key":"<present>","user-agent":"node"},"status":200}
{"seq":7,"method":"GET","path":"/v1alpha/sessions/4242424242/activities","query":{"pageToken":"page-2"},"headers":{"content-type":"application/json","x-goog-api-key":"<present>","user-agent":"node"},"status":200}
--- end captured requests, check (b) ---
```

Findings: the create body carries `requirePlanApproval: true` and
`automationMode: "AUTOMATION_MODE_UNSPECIFIED"` exactly as configured (R12);
`send` posts `{ prompt }` and `approve` posts `{}` with no plan id (R34); the
`SessionClient.id` returned for the created session is the bare id `4242424242`
although the SDK constructs it from `name` (the constructor strips the prefix);
`info()` after create hit the network because a `QUEUED` session is never
cache-valid; `history()` walked two pages and returned `act-1, act-2, act-3`
(three unique ids) although `act-2` appeared on both pages. The in-process
`fetch` wrapper saw 7 requests, all to the single loopback origin, all carrying
the `X-Goog-Api-Key` header (presence only logged). The env value is what was
sent: the harness confirmed presence only, and the productized test must never
compare or log the header's length.

Check (d) added a second `history()` pass, which issued two more list requests
with `filter=create_time>"2026-09-10T00:00:03Z"` (the latest cached
`createTime`) and `pageToken=page-2`, confirming the incremental-sync filter and
that `history()` is not a local-only read. `session.activities.select({})`
answered from memory without a request.

## 8. Retry behaviour with request counts (R3 criterion c)

Server scripted to answer the first `POST /v1alpha/sessions` with `429` and the
second with `503` (all other routes `200`). Client:
`config.rateLimitRetry.maxRetryTimeMs: 0`, in-memory storage, two `session()`
calls in one process.

| Call          | Client error                                                          | Server log for the call                                 | Outgoing calls (fetch wrapper) |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------ |
| first create  | `JulesRateLimitError` (`status 429`, also `instanceof JulesApiError`) | `GET sources/github/octo/repo 200`, `POST sessions 429` | 2 (1 GET + 1 POST)             |
| second create | `JulesApiError` (`status 503`)                                        | `GET sources/github/octo/repo 200`, `POST sessions 503` | 2 (1 GET + 1 POST)             |

Exactly one POST per create; both calls returned within 35 ms. Control run with
`maxRetryTimeMs: 1500` and the same script: the first create produced
`POST 429`, `POST 503`, `POST 200` (three POSTs, two hidden replays of a
mutating request) and reported success. The knob is therefore causal, and the
SDK's default (300 000 ms) would replay a create after a 429 or any of
500/502/503/504, which is the R14 hazard. `JulesNetworkError` (fetch failure or
the 30 s request timeout) is not retried by the SDK on any setting and was not
exercised.

## 9. Storage side effects (R3 criterion d)

Default storage (check b, cwd without `package.json`, `HOME=$INV/home`): four
files appeared, `home/.jules/cache/4242424242/activities.jsonl`,
`home/.jules/cache/4242424242/metadata.json`,
`home/.jules/cache/4242424242/session.json`, and
`home/.jules/cache/sessions.jsonl`. Nothing under `xdg`, `tmp`, `data`, or cwd.
Per `getRootDir()` the same run from a checkout containing a `package.json`
would have written `.jules/cache/` **into the checkout**, which R15 forbids.

In-memory storage (check d,
`storageFactory: { activity: () => new MemoryStorage(), session: () => new MemorySessionStorage() }`):
`find "$INV" -newer marker -type f` returned nothing outside the harness's own
log files. Read-after-write inside the same process:
`client.storage.get(session.id)` returned the created session (`state: queued`),
`client.select({ from: "sessions", where: { id } })` returned it, and
`session.history()` returned the three activities. The `storageFactory` option
is typed but marked `@internal` (T47-51): the (d) pass rests on an option the
vendor flags as unstable, so any SDK bump re-verifies (d) before the pin moves.

## 10. R3 criteria

| Criterion                                                                           | Result | Evidence label           | Evidence                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| R3 (a) loads from a clean plugin-data-dir install with no monorepo `node_modules`   | pass   | `packed-artifact-tested` | sections 4-5: `--ignore-scripts` install, file-URL import from ESM and CJS callers on Node 24.15.0 and 22.22.0, no import side effects      |
| R3 (b) serializes `requireApproval: true` / `autoPr: false` exactly as configured   | pass   | `packed-artifact-tested` | section 7: captured body `requirePlanApproval: true`, `automationMode: "AUTOMATION_MODE_UNSPECIFIED"`                                       |
| R3 (c) hidden HTTP retries can be disabled and the outgoing request count proves it | pass   | `packed-artifact-tested` | section 8: one POST per create at `config.rateLimitRetry.maxRetryTimeMs: 0`; three POSTs in the control run at 1500 ms                      |
| R3 (d) SDK storage isolated to a bounded in-memory scratch with read-after-write    | pass   | `packed-artifact-tested` | section 9: zero files with the memory factory; `storage.get`, `select`, `history` see the created session in-process; option is `@internal` |

A criterion that could not be exercised would have been recorded as
`not exercisable`, never as pass; none was in that state.

## 11. Documented-versus-source divergences

| Readme or JSDoc says                                               | Source does                                                                             | Consequence for PR2                                                        |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `jules.with({ apiKey, pollingIntervalMs, timeout })`               | `JulesOptions` nests `pollingIntervalMs` and `requestTimeoutMs` under `config` (T61-71) | Adapter passes `config.requestTimeoutMs`; a top-level `timeout` is ignored |
| JSDoc scopes `rateLimitRetry` to 429 rate limiting (T73)           | Retries on 429 and 500/502/503/504 (M152)                                               | Disable via `config.rateLimitRetry.maxRetryTimeMs: 0`; test by count       |
| JSDoc says `history()` opens no network connection (T936-939)      | `DefaultActivityClient.history()` hydrates from the network first (M980-985)            | Treat `history()` as a network read; use `activities.select()` for local   |
| Readme lists 5 error classes                                       | `errors.d.ts` declares 11                                                               | `JULES_*` table maps all 11 (contract-v1.md)                               |
| JSDoc presents `Platform.fetch` as the unified network path (T771) | `ApiClient` uses global `fetch` (M209)                                                  | Redirect only via `baseUrl`; global-fetch wrappers also work for tests     |
| `storageFactory` JSDoc-tagged internal (T47)                       | Read from public `JulesOptions` (M2355) and exported memory classes                     | Pin-stability risk; re-verify (d) on every bump                            |

## 12. Remaining unknowns

- Vendor identifier character sets. The harness echoed its own ids; the
  allowlist patterns in `contract-v1.md` are derived from `types.d.ts`
  resource-name formats only (`source-inspected`) and must be re-checked against
  the R53 live smoke before they are treated as exhaustive.
- Real response shapes for every endpoint (the harness returned shapes derived
  from `types.d.ts`; `source-inspected` at best per
  `docs/solutions/code-quality/golden-fixture-parity-vs-contract-correctness.md`).
- `JulesNetworkError` and request-timeout paths (not exercised).
- `sources` list pagination against real data, and whether the Sources API
  exposes anything beyond `githubRepo` (the mapper throws on any other source
  type, M263).
- Behaviour on Node lines other than 22.22.0 and 24.15.0, and on Windows
  (`getRootDir()` uses `HOME`, not `USERPROFILE`).
- Whether the `@internal` `storageFactory` and `baseUrl` options remain in the
  next SDK version (pin-stability risk; any bump re-runs this record).
- The vendor's rate-limit headers (`Retry-After` is never read by the SDK;
  `grep -c` is 0), so Yellow's own backoff cannot rely on them through the SDK.
- Cross-origin or downgrade redirects: the SDK follows `fetch` defaults
  (redirects followed silently) and `X-Goog-Api-Key` is not among the headers
  `fetch` strips on a cross-origin redirect, so the SDK branch inherits the risk
  through global `fetch`, not only the REST branch. Not exercised;
  contract-v1.md requires a process-local fetch guard (`redirect: "manual"`,
  pinned origin) and PR2 adds a 302-to-second-port fixture asserting the header
  never arrives.

## Appendix A: harness

Five files, run from `$INV`. The server binds `127.0.0.1:0` and exits 2 on any
other bind address. Response bodies are illustrative shapes derived from
`dist/types.d.ts`; only the request log is evidence. PR2 productizes this as
`plugins/yellow-jules/tests/fake-http-server.ts` (R49). This appendix is the
historical evidence record, reproduced as executed on 2026-09-10; it is not
maintained after PR2 lands, and the productized copy is authoritative from then
on. Review after the run found these hardening gaps, which the productized copy
closes and which did not affect the captured evidence:

- The activities route has no `req.method === 'GET'` guard, unlike every sibling
  route.
- Header logging is a three-entry denylist; the productized server logs an
  allowlist (`content-type`, `content-length`, `user-agent`) and records every
  other header as name plus `<present>`.
- Log and port-file paths default to cwd-relative names; derive both from the
  test's temp directory with no env override.
- The log is opened with `appendFileSync` per request (follows a pre-existing
  symlink, never truncated at startup, synchronous in the handler); open once
  with `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` and truncate per scenario.
- The request body is accumulated without a size cap and logged verbatim,
  including `prompt`; cap the body (413 over the limit) and log a
  `promptDigest`.
- The client `fetch` wrapper assumes a plain-object `headers` init and a string
  `input`; normalize with `new Headers(init?.headers ?? {})` and accept `URL`
  and `Request` inputs.
- `summarizeFetch()` rebuilds a `Set` over the whole log on every call; keep
  running counters.

`fake-jules-server.mjs`:

```javascript
// fake-jules-server.mjs — loopback-only fake of the Jules v1alpha REST surface.
// Zero-spend harness for docs/yellow-jules/sdk-investigation.md (PR1, R55).
// Response bodies are ILLUSTRATIVE shapes derived from dist/types.d.ts and the
// mappers in dist/index.mjs (source-inspected), never captured vendor responses.
import http from 'node:http';
import fs from 'node:fs';

const BIND = process.env.FAKE_BIND ?? '127.0.0.1';
if (BIND !== '127.0.0.1') {
  process.stderr.write(`refusing to bind to ${BIND}; loopback only\n`);
  process.exit(2);
}
const LOG = process.env.FAKE_LOG ?? 'requests.jsonl';
// FAKE_SCRIPT: comma-separated status codes applied, in order, to successive
// POST /v1alpha/sessions requests (e.g. "429,503"); empty = always 200.
const script = (process.env.FAKE_SCRIPT ?? '')
  .split(',')
  .filter(Boolean)
  .map(Number);
const SECRET_HEADERS = new Set(['x-goog-api-key', 'authorization', 'cookie']);
let seq = 0;

const SESSION_ID = '4242424242';
const SOURCE = {
  name: 'sources/github/octo/repo',
  id: 'github/octo/repo',
  githubRepo: {
    owner: 'octo',
    repo: 'repo',
    isPrivate: false,
    defaultBranch: { displayName: 'main' },
    branches: [{ displayName: 'main' }],
  },
};
const now = () => new Date().toISOString();
const session = (body, state) => ({
  name: `sessions/${SESSION_ID}`,
  id: SESSION_ID,
  prompt: body?.prompt ?? 'p',
  title: body?.title ?? 't',
  sourceContext: body?.sourceContext ?? {
    source: SOURCE.name,
    githubRepoContext: { startingBranch: 'main' },
  },
  requirePlanApproval: body?.requirePlanApproval,
  automationMode: body?.automationMode,
  state,
  createTime: now(),
  updateTime: now(),
  url: `https://jules.google.com/session/${SESSION_ID}`,
  outputs: [],
});
const act = (id, t, extra) => ({
  name: `sessions/${SESSION_ID}/activities/${id}`,
  createTime: t,
  originator: 'agent',
  artifacts: [],
  ...extra,
});
const A1 = act('act-1', '2026-09-10T00:00:01Z', {
  planGenerated: {
    plan: {
      id: 'plan-1',
      createTime: '2026-09-10T00:00:01Z',
      steps: [{ id: 'step-1', title: 'Inspect', index: 0 }],
    },
  },
});
const A2 = act('act-2', '2026-09-10T00:00:02Z', {
  agentMessaged: { agentMessage: 'hello' },
});
const A3 = act('act-3', '2026-09-10T00:00:03Z', {
  progressUpdated: { title: 'Working', description: 'd' },
});

function redactHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h))
    out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? '<present>' : v;
  return out;
}
function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => {
    raw += c;
  });
  req.on('end', () => {
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = { _unparsed: raw };
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    const entry = {
      seq: ++seq,
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: redactHeaders(req.headers),
      body,
    };
    let status = 200,
      payload;
    const p = url.pathname;
    let m;
    if (
      req.method === 'GET' &&
      (m = p.match(/^\/v1alpha\/sources\/github\/([^/]+)\/([^/]+)$/))
    ) {
      payload =
        m[1] === 'octo' && m[2] === 'repo'
          ? SOURCE
          : ((status = 404),
            { error: { code: 404, message: 'source not found' } });
    } else if (req.method === 'GET' && p === '/v1alpha/sources') {
      payload = { sources: [SOURCE] };
    } else if (req.method === 'POST' && p === '/v1alpha/sessions') {
      const scripted = script.shift();
      if (scripted) {
        status = scripted;
        payload = {
          error: { code: scripted, message: `scripted ${scripted}` },
        };
      } else payload = session(body, 'QUEUED');
    } else if ((m = p.match(/^\/v1alpha\/sessions\/(.+?)\/activities$/))) {
      entry.sessionSegment = m[1];
      const tok = url.searchParams.get('pageToken');
      payload =
        tok === 'page-2'
          ? { activities: [A2, A3] }
          : { activities: [A1, A2], nextPageToken: 'page-2' };
    } else if (
      req.method === 'POST' &&
      (m = p.match(
        /^\/v1alpha\/sessions\/(.+?):(sendMessage|approvePlan|archive|unarchive)$/
      ))
    ) {
      entry.sessionSegment = m[1];
      entry.verb = m[2];
      payload = {};
    } else if (
      req.method === 'GET' &&
      (m = p.match(/^\/v1alpha\/sessions\/(.+)$/))
    ) {
      entry.sessionSegment = m[1];
      payload = session(undefined, 'AWAITING_PLAN_APPROVAL');
    } else {
      status = 404;
      payload = { error: { code: 404, message: 'no route' } };
    }
    entry.status = status;
    fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
    send(res, status, payload);
  });
});
server.listen(0, BIND, () => {
  const { port } = server.address();
  fs.writeFileSync(process.env.FAKE_PORT_FILE ?? 'server.port', String(port));
  process.stdout.write(`listening ${BIND}:${port}\n`);
});
```

`client-common.mjs`:

```javascript
// Shared client bootstrap for the checks. Loads the data-dir install by absolute
// file URL (ESM ignores NODE_PATH) and wraps globalThis.fetch to record every
// origin contacted plus API-key header PRESENCE (never the value).
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
export const sdk = await import(pathToFileURL(process.env.SDK_MJS).href);
export const port = fs.readFileSync(process.env.FAKE_PORT_FILE, 'utf8').trim();
export const baseUrl = `http://127.0.0.1:${port}/v1alpha`;
export const fetchLog = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' ? input : input.url);
  const h = init?.headers ?? {};
  const keyPresent = Object.keys(h).some(
    (k) => k.toLowerCase() === 'x-goog-api-key'
  );
  fetchLog.push({
    origin: u.origin,
    method: init?.method ?? 'GET',
    apiKeyHeaderPresent: keyPresent,
  });
  return realFetch(input, init);
};
export function memoryFactory() {
  return {
    activity: () => new sdk.MemoryStorage(),
    session: () => new sdk.MemorySessionStorage(),
  };
}
export function summarizeFetch() {
  const origins = [...new Set(fetchLog.map((f) => f.origin))];
  return {
    requests: fetchLog.length,
    origins,
    apiKeyPresentOnAll: fetchLog.every((f) => f.apiKeyHeaderPresent),
  };
}
export const out = (o) =>
  process.stdout.write(JSON.stringify(o, null, 2) + '\n');
```

`check-b.mjs`:

```javascript
// Check (b): explicit flag serialization, then reply and approve; default storage.
import {
  sdk,
  baseUrl,
  memoryFactory,
  summarizeFetch,
  out,
} from './client-common.mjs';
const useMemory = process.env.USE_MEMORY === '1';
const client = sdk.connect({
  baseUrl,
  config: { rateLimitRetry: { maxRetryTimeMs: 0 } },
  ...(useMemory ? { storageFactory: memoryFactory() } : {}),
});
const session = await client.session({
  prompt: 'Investigate only. Do not change files.',
  title: 'pr1-check-b',
  source: { github: 'octo/repo', baseBranch: 'main' },
  requireApproval: true,
  autoPr: false,
});
out({ step: 'created', sessionClientId: session.id });
await session.send('reply from check-b');
out({ step: 'sent' });
await session.approve();
out({ step: 'approved' });
const info = await session.info();
out({ step: 'info', state: info.state, name: info.name, id: info.id });
const ids = [];
for await (const a of session.history()) ids.push(a.id);
out({ step: 'history', activityIds: ids, unique: [...new Set(ids)].length });
out({ step: 'fetch-summary', ...summarizeFetch() });
```

`check-c.mjs`:

```javascript
// Check (c): retry disablement. Server scripted 429 then 503 on POST /sessions.
import {
  sdk,
  baseUrl,
  memoryFactory,
  summarizeFetch,
  out,
} from './client-common.mjs';
const maxRetryTimeMs = Number(process.env.MAX_RETRY_TIME_MS ?? '0');
const client = sdk.connect({
  baseUrl,
  config: { rateLimitRetry: { maxRetryTimeMs } },
  storageFactory: memoryFactory(),
});
const cfg = {
  prompt: 'p',
  title: 'pr1-check-c',
  source: { github: 'octo/repo', baseBranch: 'main' },
  requireApproval: true,
  autoPr: false,
};
for (const label of ['first-create', 'second-create']) {
  const before = summarizeFetch().requests;
  const t = Date.now();
  try {
    await client.session(cfg);
    out({ label, outcome: 'unexpected-success' });
  } catch (e) {
    out({
      label,
      errorClass: e.constructor.name,
      status: e.status,
      isRateLimit: e instanceof sdk.JulesRateLimitError,
      isApiError: e instanceof sdk.JulesApiError,
      elapsedMs: Date.now() - t,
      fetchCallsThisCall: summarizeFetch().requests - before,
    });
  }
}
out({ step: 'fetch-summary', ...summarizeFetch() });
```

`check-d.mjs`:

```javascript
// Check (d): in-memory storage isolation + read-after-write inside one invocation.
import {
  sdk,
  baseUrl,
  memoryFactory,
  summarizeFetch,
  out,
} from './client-common.mjs';
const client = sdk.connect({
  baseUrl,
  config: { rateLimitRetry: { maxRetryTimeMs: 0 } },
  storageFactory: memoryFactory(),
});
const session = await client.session({
  prompt: 'p',
  title: 'pr1-check-d',
  source: { github: 'octo/repo', baseBranch: 'main' },
  requireApproval: true,
  autoPr: false,
});
out({ step: 'created', sessionClientId: session.id });
const byClientId = await client.storage.get(session.id);
const byBareId = await client.storage.get('4242424242');
out({
  step: 'storage.get',
  byClientId: byClientId
    ? { id: byClientId.resource.id, state: byClientId.resource.state }
    : null,
  byBareId: byBareId
    ? { id: byBareId.resource.id, state: byBareId.resource.state }
    : null,
});
const selected = await client.select({
  from: 'sessions',
  where: { id: '4242424242' },
});
out({
  step: 'select',
  count: selected.length,
  ids: selected.map((s) => s.id),
  states: selected.map((s) => s.state),
});
const before = summarizeFetch().requests;
const ids = [];
for await (const a of session.history()) ids.push(a.id);
const hist2 = [];
for await (const a of session.history()) hist2.push(a.id);
out({
  step: 'history',
  firstPass: ids,
  secondPass: hist2,
  fetchCallsForTwoPasses: summarizeFetch().requests - before,
});
const local = await session.activities.select({});
out({ step: 'activities.select(local)', ids: local.map((a) => a.id) });
out({ step: 'fetch-summary', ...summarizeFetch() });
```

## Appendix B: commands

```bash
INV="$(mktemp -d)"
mkdir -p "$INV/home" "$INV/xdg/data" "$INV/xdg/config" "$INV/xdg/cache" "$INV/tmp" "$INV/data/runtime"
cd "$INV"
export HOME="$INV/home" XDG_DATA_HOME="$INV/xdg/data" XDG_CONFIG_HOME="$INV/xdg/config" \
  XDG_CACHE_HOME="$INV/xdg/cache" TMPDIR="$INV/tmp" JULES_API_KEY=dummy-not-a-real-key \
  NODE_DISABLE_COMPILE_CACHE=1
unset NODE_PATH

# Step 7: registry, pack, hash, list, extract
npm view @google/jules-sdk@0.2.0 --json > registry.json
npm pack @google/jules-sdk@0.2.0 --pack-destination "$INV" --ignore-scripts
openssl dgst -sha512 -binary google-jules-sdk-0.2.0.tgz | base64 -w0
tar tzf google-jules-sdk-0.2.0.tgz
mkdir -p extract && tar xzf google-jules-sdk-0.2.0.tgz -C extract

# Step 8: clean install, scripts disabled
npm install --prefix "$INV/data/runtime" @google/jules-sdk@0.2.0 \
  --ignore-scripts --no-save --no-audit --no-fund --no-package-lock
npm ls --prefix "$INV/data/runtime"
export SDK_MJS="$INV/data/runtime/node_modules/@google/jules-sdk/dist/index.mjs"

# Step 9: module-strategy load tests (repeated with the nvm-installed v22.22.0 binary)
node --input-type=module -e 'const m = await import(new URL("file://" + process.env.SDK_MJS)); console.log(Object.keys(m))'
node -e 'import(require("node:url").pathToFileURL(process.env.SDK_MJS).href).then(m => console.log(Object.keys(m)))'
node -e 'require(process.env.SDK_MJS)'   # observation only
env -u JULES_API_KEY node --input-type=module -e 'const m = await import(new URL("file://" + process.env.SDK_MJS)); await m.jules.session("s-1").info()'

# Step 11: fake server checks (one server per check; FAKE_SCRIPT only for check c).
# start_server backgrounds the server and polls for the port file (readiness);
# stop_server kills it by pid, which also works in non-interactive shells.
export FAKE_PORT_FILE="$INV/server.port"
start_server() { rm -f "$FAKE_PORT_FILE"; FAKE_LOG="$1" FAKE_SCRIPT="${2:-}" node fake-jules-server.mjs & SRV=$!; for i in $(seq 1 50); do [ -s "$FAKE_PORT_FILE" ] && break; sleep 0.1; done; }
stop_server() { kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; }
touch "$INV/marker-b"; sleep 1
start_server "$INV/requests-b.jsonl"; node check-b.mjs; stop_server
find "$INV/home" "$INV/xdg" "$INV/tmp" "$INV/data" -newer "$INV/marker-b" -type f
touch "$INV/marker-d"; sleep 1
start_server "$INV/requests-d.jsonl"; node check-d.mjs; stop_server
find "$INV/home" "$INV/xdg" "$INV/tmp" "$INV/data" -newer "$INV/marker-d" -type f
start_server "$INV/requests-c.jsonl" "429,503"; MAX_RETRY_TIME_MS=0 node check-c.mjs; stop_server
start_server "$INV/requests-c-control.jsonl" "429,503"; MAX_RETRY_TIME_MS=1500 node check-c.mjs; stop_server
FAKE_BIND=0.0.0.0 node fake-jules-server.mjs   # exits 2: loopback only
```
