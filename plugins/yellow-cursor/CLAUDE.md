# yellow-cursor Plugin

Cursor Cloud Agent integration. All API integration lives in a typed TypeScript
CLI (`src/` → compiled `dist/cli.js`); command markdown files are thin,
confirmation-gated Bash wrappers around that CLI and contain no API client logic
of their own.

## Architecture

```
plugins/yellow-cursor/
  package.json          # yellow-cursor, private, @cursor/sdk "1.0.28" (exact)
  tsconfig.json          # extends ../../tsconfig.base.json, module node16 (CJS emit)
  src/
    cli.ts               # entry: parseArgs, subcommands, JSON->stdout, exit codes
    runtime.ts            # typed operations layer, takes an SdkAdapter via DI
    sdk-adapter.ts         # ONLY file importing @cursor/sdk
    sdk-resolver.ts         # resolve SDK: workspace require -> data-dir install
    config.ts                # credential/config resolution, host-neutral data dir
    validate.ts               # input validation (repo URL, ref, ids, prompt size, paths)
    state.ts                    # local index: <dataDir>/state/agents.json
    errors.ts                    # stable app error codes -> retryable + recoveryAction
    redact.ts                     # centralized redaction on every output path
  dist/                  # committed compiled CJS; drift-checked (rebuild+diff)
  tests/                 # vitest, fake-sdk.ts, no network
  commands/cursor/*.md   # this file's sibling surface: 10 Bash-wrapper commands
  skills/cursor-delegation/SKILL.md  # host-neutral lifecycle reference
```

### sdk-adapter boundary

`sdk-adapter.ts` is the **only** file in this plugin that imports `@cursor/sdk`.
`runtime.ts` depends on an `SdkAdapter` interface injected at construction time,
so tests substitute a fake implementation (`tests/fake-sdk.ts`) and never touch
the network. If you're adding a new operation, it goes through this same seam —
do not reach for `@cursor/sdk` directly from `cli.ts` or `runtime.ts`.

### SDK pin policy

`@cursor/sdk` is pinned to `1.0.28` **exact** (not `^1.0.28`) in `package.json`.
This SDK surface was verified live against that version; treat any bump as a
breaking change requiring re-verification of the `instanceof` error-branching in
`sdk-adapter.ts` (error class shapes are not guaranteed stable across SDK
versions) before merging.

### CLI contract

One JSON object on stdout per invocation, all diagnostics on stderr. Exit `0` on
`{ok:true}`, `1` on a well-formed business-rule/SDK failure, `2` on a CLI usage
error (a `2` still prints a valid `{ok:false,...}` object — only the exit code
and `error.code:CURSOR_INVALID_INPUT` distinguish it). See each
`commands/cursor/*.md` file's Error Handling table for the specific codes it
surfaces, and the CLI's own `error.recoveryAction` field for the canonical
remediation text — command markdown quotes that field rather than re-deriving
it.

### Error catalog

Defined in `src/errors.ts`, each mapped from an SDK error via `instanceof`
(never `.code`, which is loosely typed as `"error"` on the SDK side):

| Code                            | Retryable | Recovery Action                                 |
| ------------------------------- | --------- | ----------------------------------------------- |
| `CURSOR_AUTH_FAILED`            | false     | set `CURSOR_API_KEY` / stored login             |
| `CURSOR_REPO_ACCESS`            | false     | connect the repo's SCM integration in Cursor    |
| `CURSOR_INVALID_INPUT`          | false     | fix input and retry                             |
| `CURSOR_AGENT_BUSY`             | true      | wait for the current run, or `--force`          |
| `CURSOR_RATE_LIMITED`           | true      | wait and retry with backoff                     |
| `CURSOR_SERVICE_UNAVAILABLE`    | true      | retry later (except during `send()`, see below) |
| `CURSOR_NOT_FOUND`              | false     | verify the id                                   |
| `CURSOR_UNSUPPORTED_CAPABILITY` | false     | no retry will help                              |
| `CURSOR_MALFORMED_RESPONSE`     | false     | retry / report                                  |
| `CURSOR_STATE_CORRUPT`          | false     | quarantined; `status --reconcile`               |
| `CURSOR_DUPLICATE_LAUNCH`       | false     | check `status` instead of relaunching           |
| `CURSOR_CONFIRMATION_REQUIRED`  | false     | re-run with `--yes`                             |
| `CURSOR_SDK_MISSING`            | false     | run `/cursor:setup`                             |
| `CURSOR_NESTED_DELEGATION`      | false     | run outside a remote-agent context              |
| `CURSOR_CONCURRENCY_LIMIT`      | false     | wait, or raise `--max-active`                   |
| `CURSOR_UNKNOWN_OUTCOME`        | false     | `status --reconcile`                            |

**Ambiguous-outcome design**: `Agent.create()` is lazy — the real create+auth
round trip happens on the first `send()`. A `send()` failure whose SDK error is
`NetworkError`/unclassified is remapped to `CURSOR_UNKNOWN_OUTCOME` rather than
`CURSOR_SERVICE_UNAVAILABLE` / `CURSOR_MALFORMED_RESPONSE`, because once a real
mutating call has been dispatched, a network-level failure genuinely cannot tell
you whether the run was created server-side. This distinction applies only to
the `send()` step inside `delegate`/`follow-up`, never to reads. Bounded retries
(max 2, exponential backoff from 500ms, same `idempotencyKey`) apply only around
`send()`, and only when the SDK error's `isRetryable` flag is true.

### Local state

`<dataDir>/state/agents.json`, keyed by **idempotency key**, not agent id — a
delegate reservation is written before `Agent.create()` resolves, before an
agent id exists. Atomic tmp+rename same-dir writes, `0600` file / `0700` dir. A
corrupt file is quarantined to `.corrupt-<timestamp>` and reading continues with
an empty index. `promptDigest` is a sha256 hex digest — the raw prompt is never
persisted. Any field that looks secret-shaped (or is named
`apiKey`/`token`/`secret`/`password`/`prompt`) is refused at write time, not
just redacted at read time.

## Testing

`vitest run` against `tests/`, no network. `tests/fake-sdk.ts` implements the
same `SdkAdapter` interface `sdk-adapter.ts` wraps around the real
`@cursor/sdk`, so `runtime.ts` is tested through its real seam rather than
mocked at the function level. Coverage areas: config resolution, redaction,
input validation, error mapping, state store (atomicity, quarantine),
idempotency, agent/run lifecycle, concurrency, and the CLI's JSON contract
itself (`cli-json-contract.test.ts` — exit codes, `ok` discriminator,
`idempotencyKey` echo on every path).

## Build discipline

`dist/` is **committed**, not gitignored — this plugin ships no build step at
install time, so the compiled CJS must already be correct in the repo. After any
`src/` change: `pnpm --filter yellow-cursor run build`, then verify `dist/`
reflects it (a drift check rebuilds and diffs at CI/release time). Never
hand-edit `dist/cli.js`.

## Component catalog

### Commands (10)

- `/cursor:setup` — credential/SDK detection, optional `@cursor/sdk` install
- `/cursor:delegate` — dry-run validate → confirm → billable launch
- `/cursor:list` — merged live + local agent listing
- `/cursor:status` — live status + reconciliation
- `/cursor:follow-up` — confirm → billable send to an existing agent
- `/cursor:cancel` — confirm → cancel a run (TOCTOU-safe, idempotent on
  terminal)
- `/cursor:artifacts` — list/download run artifacts (capability-gated)
- `/cursor:usage` — per-agent token usage and cost (capability-gated)
- `/cursor:archive` — confirm → hide agent (idempotent, `--force` for busy)
- `/cursor:unarchive` — confirm → restore agent (idempotent)

### Skills (1)

- `cursor-delegation` — host-neutral delegation-lifecycle reference,
  `user-invokable: false`. Not wired into the commands via the `Skill` tool —
  the commands are full implementations, not thin wrappers around this skill. It
  exists as the twin surface a future Cursor/Codex distribution can expose on
  its own, so it deliberately avoids any Claude-specific mechanism (no
  `$ARGUMENTS`, `.claude/` paths, `CLAUDE_*` env, `subagent_type`,
  `mcp__plugin_*` names, or slash-command references).

## Conventions

- Every command builds its CLI invocation as a bash array
  (`args=(...); node "$CLI" "${args[@]}"`) — never string-interpolated — and
  quotes every variable.
- Mutating operations (`delegate`, `follow-up`, `cancel`, `archive`,
  `unarchive`) always confirm via `AskUserQuestion` before the command itself
  supplies `--yes`; no command in this plugin passes `--yes` unconditionally.
- `delegate` always dry-runs first; the dry run's `idempotencyKey` is captured
  and reused verbatim for the real launch and for any user-driven retry — never
  regenerated mid-attempt.
- No command ever echoes a credential value; only `credentialSource` /
  `sdkResolution` (from `setup`) are surfaced.
- No command exposes a delete operation — `Agent.delete` exists on the SDK but
  is intentionally unreachable from this entire surface (CLI included).
