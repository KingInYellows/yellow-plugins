# Runtime install smoke harness

`scripts/smoke-plugin-install.sh` (also `pnpm smoke:install`) proves that every
plugin in `.claude-plugin/marketplace.json` is **installable in a disposable,
fully-isolated Claude Code environment** — without touching your real
`~/.claude`, plugin cache, credentials, keychain, or marketplace config.

It complements `pnpm validate:schemas` (which checks manifests against the
repo's *local* schemas) by exercising the *actual* Claude Code CLI install path
on a throwaway copy of your environment.

## What it proves — and what it does not

| ✅ Proves | ❌ Does NOT prove |
|---|---|
| Each manifest passes the **bundled** Claude Code validator (`claude plugin validate`, T0) | Acceptance by the **remote** validator invoked when a user installs from the **published GitHub** marketplace |
| Each plugin **installs** from the local checkout into an isolated cache (`claude plugin install`, T1) | That MCP servers start or that credentialed tools work (servers start on session-enable, not install) |
| Credential-bearing plugins install **without credentials** | Runtime behavior of any plugin once enabled |
| The harness never mutates real `~/.claude` (asserted before/after) | — |

> **The remote-validator gap is the one most likely to bite a real user.**
> `claude plugin validate` and a local-checkout `install` both run the CLI's
> *bundled* validator. The *remote* validator (only reached when installing from
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
pnpm smoke:install                       # T0 validate + T1 install, all 18 plugins
pnpm smoke:install -- --help             # options
pnpm smoke:install -- --dry-run          # print the plan; no claude, no temp dirs
pnpm smoke:install -- --plugin yellow-core   # one plugin only
pnpm smoke:install -- --tier 0           # validate only (fast, no install)
pnpm smoke:install -- --keep-temp        # retain the temp dir for debugging
```

### Tiers

- **T0 — validate** (`claude plugin validate plugins/<name>`): static, no
  network, no auth, no install. Gates on **non-strict** exit 0. It also runs
  `--strict` as **advisory** only: every plugin ships an authoring
  `CLAUDE.md` at its root, which `--strict` reports as a warning-as-error
  ("CLAUDE.md … not loaded as project context"). That is expected and does not
  fail the harness — those `CLAUDE.md` files are contributor context, not plugin
  runtime context. The summary marks such plugins `T0=PASS(warn)`.
- **T1 — install**: isolated `marketplace add <repo>` + `plugin install
  <name>@<marketplace> --scope user`, with the real-state invariant guard.

### Flags

| Flag | Effect |
|---|---|
| `--plugin <name>` | Smoke a single plugin (must be in the marketplace) |
| `--tier <0\|1>` | `0` = validate only; `1` = install only; omit = both |
| `--dry-run` | Print the plan and exit 0 without invoking claude |
| `--keep-temp` | Keep the temp isolation dir and print its path |
| `--ci` | Treat an absent `claude` CLI as a hard skip (exit 2) instead of a soft skip (exit 0) |
| `-h`, `--help` | Usage |

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

| Symptom | Likely cause / action |
|---|---|
| `claude CLI not found; skipping` (exit 0) | The CLI isn't installed. Install Claude Code to run the install tiers. |
| `T0=FAIL` for a plugin | The bundled validator rejected its manifest. Re-run `claude plugin validate plugins/<name>` directly to see the error. |
| `T1=FAIL` | Isolated install failed. Re-run with `--plugin <name> --keep-temp` and inspect the temp dir + rerun the install manually under the same env. |
| `T1=FAIL(absent)` | Install reported success but the plugin wasn't listed — likely a marketplace-name mismatch. |
| `SAFETY ABORT … real ~/.claude state CHANGED` | Isolation failed to contain an install. Do **not** ignore — inspect manually; the env vars may not have taken effect. |

## CI guidance

This harness depends on the `claude` CLI, which is **not** present on the
project's CI runners, and T1 writes to a plugin cache. **It is intentionally
not part of the required merge gate** (`ci-status` in `validate-schemas.yml`),
which stays deterministic and CLI-free.

- **Primary path:** run locally before submitting changes that touch
  `plugins/` or the marketplace manifest.
- **Optional CI:** a `workflow_dispatch`-only advisory workflow may run the
  **T0 validate** tier if it (a) pins a specific `claude` CLI version, (b)
  soft-skips when the CLI is absent (`command -v claude || exit 0`), (c) sets
  `HOME=$RUNNER_TEMP/smoke-home`, and (d) is **never** added to `ci-status`.
  Do not wire T1 (live install) or this harness into required PR checks.
