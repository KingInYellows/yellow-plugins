# yellow-jules Plugin

Google Jules integration, **experimental**, the third member of the
`remote-agent` capability group (yellow-cursor is preferred). All vendor
integration lives in a typed TypeScript CLI (`src/` → compiled `dist/cli.js`);
command markdown files are thin wrappers with no API logic.

This release ships the **read-only** surface only: `setup`, `list`, `status`,
`collect`. `delegate`, `reply`, and `approve` arrive together with `authorize`
in a later release; until then `/linear:delegate` recognizes Jules but stops
before contacting it. The binding contract — subcommands, JSON shapes, error
catalog, redaction layers, identifier allowlist, local state — is
[`docs/yellow-jules/contract-v1.md`](../../docs/yellow-jules/contract-v1.md);
this file does not restate it.

## Architecture

```
plugins/yellow-jules/
  package.json          # private; @google/jules-sdk "0.2.0" (exact); engines.node >=22.22
  tsconfig.json         # extends ../../tsconfig.base.json, module node16 (CJS emit)
  runtime/              # data-dir install manifest + lockfile (npm ci source)
  src/
    cli.ts              # entry: strict parseArgs, one JSON line on stdout, exit 0/1/2
    runtime.ts          # setup / list / status / collect over an injected SdkAdapter
    activity-walk.ts    # the single bounded activity-walk unit
    sdk-adapter.ts      # ONLY file touching the SDK API (plus the resolver's location work)
    sdk-resolver.ts     # locate, verify, and dynamically import the ESM-only SDK
    fetch-guard.ts      # pins the vendor origin, refuses redirects, 30 s reads
    test-seam.ts        # the only loopback baseUrl path; tests only
    config.ts           # data dir resolution + owner-only checks
    state.ts            # journal, lock, reservations
    deadline.ts         # absolute deadlines + bounded read retry
    errors.ts redact.ts validate.ts types.ts
  dist/                 # committed compiled CJS; drift-checked in CI
  commands/jules/       # setup, list, status, collect
  tests/                # vitest; fake adapter, fake HTTP server, packed-SDK suite
```

### sdk-adapter boundary

`sdk-adapter.ts` is the only file that uses the SDK API (R2); `sdk-resolver.ts`
only locates and loads the package. `runtime.ts` depends on the `SdkAdapter`
port in `types.ts`, which exposes **reads only** in this release — adding a
mutating method is PR3 work and changes the adapter prototype test in
`unsupported-capability.test.ts`. The adapter builds the client with
`config.requestTimeoutMs: 60000`, `config.rateLimitRetry.maxRetryTimeMs: 0`
(nested — a top-level key is silently ignored), and a recording in-memory
`storageFactory` whose bindings it asserts after `connect()` and on first
per-session use. `buildCreateSessionConfig` is a pure builder used only by the
packed-SDK tests.

### SDK pin policy

`@google/jules-sdk` is pinned to `0.2.0` exact, in `package.json` (workspace)
and in `runtime/package.json` + `runtime/package-lock.json` (the data-dir
install, every package carrying an integrity hash). `setup --install-sdk` copies
both into `<dataDir>/runtime/` and runs `npm ci --ignore-scripts`; on any
failure it removes the install. Every later load re-verifies `runtime/pin.json`
(entry-file sha256 and the installed tree). Treat any SDK bump as a
re-verification of the four R3 criteria recorded in
`docs/yellow-jules/sdk-investigation.md` §10 — load, explicit create flags,
count-proven retry disablement, isolatable storage — and of the `@internal`
`storageFactory` and `baseUrl` options, before the pin moves. Regenerate the
lockfile with `npm install --package-lock-only --ignore-scripts` inside
`runtime/`, and update `docs/upstream-pins.md`.

### CLI contract and error catalog

See `contract-v1.md` "Output envelope", "Exit codes", and "Error catalog". In
short: one JSON object on stdout, diagnostics on stderr, exit `0`/`1`/`2`; every
degraded success carries `requiresAttention` plus an `attention` list; `JULES_*`
codes each carry `retryable` and a default `recoveryAction`.

## Local state

`YELLOW_JULES_DATA_DIR` > `$XDG_DATA_HOME/yellow-jules` > platform default,
never under a git work tree containing the cwd or under the plugin directory.
Directories are `0700` and files `0600`; a group- or world-writable or non-owned
data dir, `state/`, `sdk-scratch/`, or `runtime/` is refused with
`JULES_DATA_DIR` on every invocation. Layout: `state/journal.json`,
`state/.lock`, `artifacts/<local-id>/`, `sdk-scratch/` (must stay empty),
`runtime/`. A corrupt journal is never replaced (`JULES_JOURNAL_CORRUPT`); a
stale lock is never taken over (`JULES_STALE_LOCK`) — both need a human.

## Testing

`pnpm --filter yellow-jules test` (also run by root `pnpm test:unit`). Layers:

- fake-adapter suites (`runtime-*.test.ts`) over `tests/fake-sdk.ts`;
- `packed-sdk-transport.test.ts` — installs the real `0.2.0` artifact through
  the shipped `npm ci` path (needs npm registry access) and drives it against
  `tests/fake-http-server.ts`; the only place the SDK's mutating surface runs;
- `cli-json-contract.test.ts` and `offline-coverage.test.ts` — the CLI built
  with `tsc --outDir <mkdtemp>` into a temp "plugin cache", spawned with
  `tests/support/loopback-preload.cjs`; includes the negative test that every
  shipped subcommand issues zero POST/PATCH/PUT/DELETE.

Real tools on `PATH` are replaced by failing traps
(`tests/support/path-traps.ts`). Fake-server response bodies are illustrative: a
pass proves request shape, count, and side effects, not vendor compatibility.

## Build discipline

`dist/` is committed. After any `src/` change run
`pnpm --filter yellow-jules run build`; CI fails on any tracked or untracked
difference under `plugins/yellow-jules/dist`. The units copied from
yellow-cursor (`validateRef`, `validateIdempotencyKey`,
`assertNoSecretShapedValues`, `redactDeep`, `resolveDataDir`, the `AppError`
shape, `makeAppError`) sit between `// replica:<unit>:start/end` markers in both
plugins; `pnpm validate:jules` fails on drift. Change both sides together.

## Component catalog

### Commands (4)

- `/jules:setup` — credential presence, SDK location and verification, a
  one-page sources probe; installs the pinned SDK only with consent
- `/jules:list` — one page of sessions with normalized condition and local ids
- `/jules:status` — fresh session read plus a bounded activity walk
- `/jules:collect` — stage patches, generated files, and PR references under
  `artifacts/<local-id>/`; never touches a checkout
