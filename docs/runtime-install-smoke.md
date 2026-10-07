# Runtime install smoke harness

`scripts/smoke-plugin-install.sh` (also `pnpm smoke:install`) proves that every
plugin in `.claude-plugin/marketplace.json` is **installable in a disposable,
fully-isolated Claude Code environment** — without touching your real
`~/.claude`, plugin cache, credentials, keychain, or marketplace config.

It complements `pnpm validate:schemas` (which checks manifests against the
repo's _local_ schemas) by exercising the _actual_ Claude Code CLI install path
on a throwaway copy of your environment.

## What it proves — and what it does not

| ✅ Proves                                                                                             | ❌ Does NOT prove                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Each manifest passes the **bundled** Claude Code validator (`claude plugin validate`, T0)             | Acceptance by the **remote** validator invoked when a user installs from the **published GitHub** marketplace |
| Each plugin **installs** from the local checkout into an isolated cache (`claude plugin install`, T1) | That MCP servers start or that credentialed tools work (servers start on session-enable, not install)         |
| Credential-bearing plugins install **without credentials**                                            | Runtime behavior of any plugin once enabled                                                                   |
| The harness never mutates real `~/.claude` (asserted before/after)                                    | —                                                                                                             |

> **The remote-validator gap is the one most likely to bite a real user.**
> `claude plugin validate` and a local-checkout `install` both run the CLI's
> _bundled_ validator. The _remote_ validator (only reached when installing from
> the published GitHub marketplace) has historically diverged from local schemas
> — e.g. the `userConfig.pattern` revocation. Treat a clean smoke run as
> necessary, not sufficient: still test a real install from a clean machine
> before publishing breaking schema changes (per `CLAUDE.md`).

## Isolation: how real state stays untouched

Every `claude` invocation runs under a fresh `mktemp -d` with `HOME`,
`CLAUDE_CONFIG_DIR`, and all `XDG_*` dirs pointed inside it. Verified
2026-06-02:

- `CLAUDE_CONFIG_DIR` is the **load-bearing** variable — it relocates both the
  config **and** the plugin install cache
  (`<TMP>/.claude/plugins/cache/<marketplace>/<plugin>/<version>`).
- A full all-18 isolated install leaves the real `claude plugin list` and
  `claude plugin marketplace list` **byte-identical** before and after.

The T1 tier snapshots the real lists before installing and re-checks them
afterward; if they ever differ, it **aborts with exit 2** rather than risk
polluting real state.

## Usage

```bash
pnpm smoke:install                       # T0 validate + T1 install, all 19 plugins
pnpm smoke:install -- --help             # options
pnpm smoke:install -- --dry-run          # print the plan; no claude, no temp dirs
pnpm smoke:install -- --plugin yellow-core   # one plugin only
pnpm smoke:install -- --tier 0           # validate only (fast, no install)
pnpm smoke:install -- --keep-temp        # retain the temp dir for debugging
```

### Tiers

- **T0 — validate** (`claude plugin validate plugins/<name>`): static, no
  network, no auth, no install. Gates on **non-strict** exit 0. It also runs
  `--strict` as **advisory** only: every plugin ships an authoring `CLAUDE.md`
  at its root, which `--strict` reports as a warning-as-error ("CLAUDE.md … not
  loaded as project context"). That is expected and does not fail the harness —
  those `CLAUDE.md` files are contributor context, not plugin runtime context.
  The summary marks such plugins `T0=PASS(warn)`.
- **T1 — install**: isolated `marketplace add <repo>` +
  `plugin install <name>@<marketplace> --scope user`, with the real-state
  invariant guard.

### Flags

| Flag              | Effect                                                                               |
| ----------------- | ------------------------------------------------------------------------------------ |
| `--plugin <name>` | Smoke a single plugin (must be in the marketplace)                                   |
| `--tier <0\|1>`   | `0` = validate only; `1` = install only; omit = both                                 |
| `--dry-run`       | Print the plan and exit 0 without invoking claude                                    |
| `--keep-temp`     | Keep the temp isolation dir and print its path                                       |
| `--ci`            | Treat an absent `claude` CLI as a hard skip (exit 2) instead of a soft skip (exit 0) |
| `-h`, `--help`    | Usage                                                                                |

### Exit codes

- `0` — all selected checks passed, **or** the `claude` CLI is absent in local
  mode (soft skip).
- `1` — one or more selected checks failed.
- `2` — `claude` absent with `--ci`, a usage error, or the real-state isolation
  invariant was violated (safety abort).

## Credential-bearing plugins

Installing a plugin does **not** start its MCP servers or run its SessionStart
hooks (those happen on session-enable). So credential-bearing plugins
(`yellow-devin`, `yellow-morph`, `yellow-research`, `yellow-linear`,
`yellow-chatprd`, `yellow-composio`, `yellow-semgrep`, `yellow-ruvector`,
`gt-workflow`) install cleanly here with **no credentials** — confirmed for all
18 on 2026-06-02. No `userConfig` field is `required: true`, so non-interactive
install never blocks on a missing credential.

## Failure triage

| Symptom                                       | Likely cause / action                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude CLI not found; skipping` (exit 0)     | The CLI isn't installed. Install Claude Code to run the install tiers.                                                                       |
| `T0=FAIL` for a plugin                        | The bundled validator rejected its manifest. Re-run `claude plugin validate plugins/<name>` directly to see the error.                       |
| `T1=FAIL`                                     | Isolated install failed. Re-run with `--plugin <name> --keep-temp` and inspect the temp dir + rerun the install manually under the same env. |
| `T1=FAIL(absent)`                             | Install reported success but the plugin wasn't listed — likely a marketplace-name mismatch.                                                  |
| `SAFETY ABORT … real ~/.claude state CHANGED` | Isolation failed to contain an install. Do **not** ignore — inspect manually; the env vars may not have taken effect.                        |

## CI guidance

This harness depends on the `claude` CLI, which is **not** present on the
project's CI runners, and T1 writes to a plugin cache. **It is intentionally not
part of the required merge gate** (`ci-status` in `validate-schemas.yml`), which
stays deterministic and CLI-free.

- **Primary path:** run locally before submitting changes that touch `plugins/`
  or the marketplace manifest.
- **Optional CI:** a `workflow_dispatch`-only advisory workflow may run the **T0
  validate** tier if it (a) pins a specific `claude` CLI version, (b) soft-skips
  when the CLI is absent (`command -v claude || exit 0`), (c) sets
  `HOME=$RUNNER_TEMP/smoke-home`, and (d) is **never** added to `ci-status`. Do
  not wire T1 (live install) or this harness into required PR checks.

## Codex installation and loaded discovery

Run `pnpm smoke:codex` inside Linux/WSL with **Codex CLI 0.157.0** and the
repository's Node/pnpm versions. This is a separate harness;
`scripts/smoke-plugin-install.sh` and its Claude behavior are unchanged.

The harness creates a disposable project and profile. Each child gets fresh
HOME, CODEX_HOME, XDG config/cache/data/state and temporary directories. An
environment allowlist excludes credentials, SSH agents, proxy variables,
NODE_OPTIONS and desktop keyring buses. Authentication storage is file-only,
remote plugin discovery is disabled, and no existing profile is read or copied.
PATH and the executable selected by CODEX_BIN remain trusted local inputs. This
is profile isolation, not an operating-system network sandbox.

```bash
pnpm smoke:codex --help
pnpm smoke:codex --dry-run
pnpm smoke:codex --plugin yellow-core
pnpm smoke:codex --ci
pnpm smoke:codex --keep-temp
```

Use `node scripts/smoke-codex-plugin-install.js > receipt.json` for a pure JSON
receipt without pnpm's script banner. The report identifies the source revision,
dirty state, CLI/Node platform, installed paths, manifest/skill content hashes,
discovered skills, hook registration/trust and untested runtime boundaries. The
scratch tree is deleted after success or failure unless `--keep-temp` is given.
Interruptions kill the harness's child process groups and may leave the
disposable directory for inspection.

The gate checks installed manifests and every selected SKILL.md/reference
against source bytes, checks both skill trees against catalog allowlists, then
asks the actual app-server for `skills/list` and `hooks/list`. It requires each
expected skill exactly once and rejects additional plugin skills. Built-in
system skills are accepted only from the isolated system-skill root. Hook
events, commands, matchers, paths, timeouts and untrusted hashes must match the
installed hook configuration. MCP declaration files are compared to source; this
is not evidence of MCP registration, connection or authentication.

No thread or model turn starts; hooks are not trusted or run. A passed report
proves installation and discovery only. Direct/indirect/negative skill
activation, trusted/untrusted hook lifecycle and MCP availability are tested
separately by the isolated runtime gates below. A local Responses fixture could
test host hook dispatch, but cannot prove a model's semantic skill selection.

Exit 0 means passed, dry-run, or an explicit local `status: skipped` when the
CLI is absent. `--ci` (or a nonempty CI value other than `0`/`false`) makes a
missing CLI exit 2. Unsupported versions and failed checks exit 1; invalid
arguments exit 2. CLI commands and RPC requests have a 20-second deadline,
adjustable with `--timeout-ms` from 100 to 60000. Child output is bounded and
arbitrary CLI diagnostics are not included in receipts.

Deterministic subprocess-boundary tests run in `pnpm test:integration`. The live
pinned CLI gate stays optional and is not added to required PR CI.

## Codex hook lifecycle and MCP startup

`pnpm smoke:codex:lifecycle` is a separate optional Linux/WSL runtime fixture.
It requires the pinned Codex CLI, Node, `unshare`, `bwrap`, `ip`, and an
installed Graphite CLI package. No dependency installation is performed.

`node scripts/smoke-codex-plugin-lifecycle.js --keep-temp > lifecycle.json`
retains the disposable profiles and JSON receipts. `--dry-run` prints the two
fixed commands without invoking runtime tools. `--help` describes the boundary.
Invalid arguments and missing/incompatible prerequisites fail; there is no
fallback to an unsandboxed run. Exit 0 means the hook controls and actual MCP
initialization/tool listing passed, not full Phase 1 acceptance.

Repository/CLI/package code is mounted read-only into a disconnected
user/mount/PID/network sandbox. Responses traffic stays on loopback;
HOME/CODEX_HOME/XDG are disposable. Git/gt/gh are stubs during hook controls and
installed Graphite MCP is disabled. No real mutation command, credential copy or
real-profile trust/install runs. The untrusted control must reach both command
stubs with zero hook events. The trusted control must emit paired
SessionStart/PreToolUse/PostToolUse events, deny the push before its stub runs,
and warn after the modify stub runs. Only current hashes of the three reviewed
installed hook definitions are trusted.

The separate MCP probe starts a thread without a model turn, enables the
installed Graphite server, and launches the actual CLI through an mcp-only
wrapper. Git supplies synthetic version/repository paths and empty refs; other
reads fail. Registration, startup events, server identity and the two advertised
tools are saved. No MCP tool is called. Stdio `authStatus: unsupported` is not
an authenticated-account result.

Successful runs remove scratch unless `--keep-temp` is supplied. Failed runs
preserve available receipts. RPC/subprocess deadlines are bounded; the outer
deadline kills its sandbox process group. Deterministic integration tests reject
false-pass evidence. The real fixture stays outside required CI.

Model-driven activation and native account prerequisites have separate optional
gates:

```bash
pnpm smoke:codex:activation --use-existing-login --keep-temp
pnpm smoke:codex:graphite-auth --use-existing-login
```

These Linux/WSL commands require explicit native-login selection. Existing
native credential/config files are read-only mounted for CLI use, never copied
or read by the harness. Owner profiles receive no installation/trust changes.
Requires bwrap, Codex 0.157.0 with its bundled code-mode host, and Graphite
1.7.20 for the account probe. Missing credentials/prerequisites fail nonzero.

Activation installs yellow-core into disposable state, discovers installed
plan-status, and runs direct, indirect and unrelated prompts in fresh read-only
threads. Only exact fixture/installed-skill dynamic reads/listing are accepted;
shell, apps, browser, web and delegation are disabled. The CLI contacts its
native model provider; model tools have no network access. JSON dashboard
output, model-requested installed/fixture reads, typed events and immutable
hashes must agree. Owner auth metadata is checked afterward. Mocked Responses
cannot pass.

The separate Graphite gate runs only `gt internal-only check-auth` inside
read-only repository/config mounts. It retains classified account/access status,
excludes credentials/account identity/raw diagnostics, and verifies unchanged
owner metadata. No mutation MCP tool runs. Account proof does not replace MCP
registration or startup evidence.

See [Phase 1 report](research/codex-phase-1-2026-10-05/report.md) for real-model
success, the missing-code-host fixture failure, separate account proof and
current validation.

## Bounded expansion model acceptance

The optional Linux/WSL gate runs actual model turns:

```bash
pnpm smoke:codex:workflows --use-existing-login --corpus tests/fixtures/codex-expansion/policy.json
```

Select a committed JSON corpus from tests/fixtures. Candidate corpora stage
tracked plugin resources and only their selected generated skills into a private
marketplace before catalog enablement. Final corpora use the actual generated
marketplace. No real-profile install, trust, credential copy or remote mutation
runs. Native auth is read-only mounted; shell/apps/browser/delegation are
disabled. Reads resolve only exact project/installed skill/reference paths.

Typed observations distinguish synthetic negative controls from actual installed
Cursor dry-run, installed Python source-snapshot execution, native read-only Git
inventory and sanitized native login probes. Each actual probe runs at most
once. The public research corpus permits only installed DeepWiki read operations
under narrow disposable per-tool approval; actual remote MCP tool completion and
supported answer/sources are required for success. Missing/auth controls never
count as that live gate. JSON output, required reference reads, unrelated
inactivity and unchanged package/fixture hashes are checked. Token usage
notifications are captured when available; source size alone proves no token
savings.

The harness records sanitized JSON results and per-case events in retained
private scratch. Durable before/after, failure/rerun and integrated receipts:
[Phases 2–5 evidence](research/codex-phases-2-5-2026-10-06/report.md). Windows
desktop remains separately unverified. Local installation/refresh and
deliberately deferred public/portable distribution choices are in the
[canonical distribution document](codex-distribution.md).
