# Upstream Package Pins

Every MCP server or external binary that yellow-plugins invokes via `npx`, `uvx`,
or a bundled path is listed here with its current pinned version. Review on a
monthly cadence (or before cutting a release) to decide whether to bump.

Drift is checked by `scripts/check-upstream-pins.js`, which queries the npm
registry and prints any pin that lags the `latest` tag. Run it manually with
`pnpm check:pins` (advisory — exits 0 even when drift exists; pass `--strict` or
`--threshold N` to make it fail on drift), or rely on the weekly advisory
workflow `.github/workflows/upstream-pins-advisory.yml` (runs Mondays and on
manual dispatch; the drift report appears in the Actions run summary). It is
intentionally NOT part of the blocking `validate:schemas` / `ci-status` gate —
the per-pin `npm view` network calls would add registry flakiness to every PR.

## Policy

- **Pin exact versions** (`@scope/pkg@X.Y.Z`, not `^X.Y.Z`) so every session
  resolves the same artifact. Version floats reintroduce the cold-start race
  the plugin system works hard to avoid.
- **Pin git MCPs by commit SHA** (via `uvx --from git+<url>@<sha>`). Moving
  tags are not acceptable.
- **Bump requires a verification step**: install the new version locally and
  probe the MCP's `tools/list` (and any critical env vars) before updating.
  See the 0.8.110 → 0.8.165 bump for an example (`ENABLED_TOOLS` turned out
  to be non-functional; the pin bump surfaced the bug).

## Current Pins

| Plugin           | Package                          | Pinned   | Registry | Notes                                                                   |
| ---------------- | -------------------------------- | -------- | -------- | ----------------------------------------------------------------------- |
| yellow-morph     | `@morphllm/morphmcp`             | `0.8.181`| npm      | Bumped 2026-05-29 from 0.8.165 (tools/list verified: exposes `edit_file` + `codebase_search` + `github_codebase_search`; bump removes/renames nothing the plugin uses). No public changelog; verify empirically. **Pin tracked in `plugins/yellow-morph/package.json` deps (wrapper-based); NOT in `plugin.json` args.** |
| yellow-research  | `@perplexity-ai/mcp-server`      | `0.8.2`  | npm      | Perplexity MCP. Requires `PERPLEXITY_API_KEY`.                          |
| yellow-research  | `tavily-mcp`                     | `0.2.17` | npm      | Tavily research MCP. Requires `TAVILY_API_KEY`.                         |
| yellow-research  | `exa-mcp-server`                 | `3.1.8`  | npm      | Exa MCP. Requires `EXA_API_KEY`. Tool whitelist passed as positional arg.|
| yellow-research  | `ast-grep-mcp`                   | `674272f`| git SHA  | Installed via `uvx` from `github.com/ast-grep/ast-grep-mcp`. No npm release. |
| yellow-ruvector  | `ruvector`                       | _latest_ | npm      | No version pin — ruvector handles its own DB migration. Consider pinning after v1.0 cut. |

## Cursor Distribution Pins

Two kinds of Cursor pin, tracked separately from the npm/uvx table above
since neither is a runtime `npx`/`uvx` invocation:

**Upstream schema snapshots** (local mirrors, not installed packages):

| Local mirror                                | Upstream source                                                                             | Snapshot date | Divergence |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------- | ---------- |
| `schemas/cursor-plugin.schema.json`          | `https://raw.githubusercontent.com/cursor/plugins/main/schemas/plugin.schema.json`            | 2026-08-21    | None       |
| `schemas/cursor-marketplace.schema.json`     | `https://raw.githubusercontent.com/cursor/plugins/main/schemas/marketplace.schema.json`       | 2026-08-21    | None       |

Both were fetched and quoted directly (not paraphrased) and cross-checked
against real examples in the same upstream repo. Re-fetch and diff both
URLs before any structural change to `scripts/lib/generate/emit-cursor.js`
or the generated `.cursor-plugin/` shape; see `docs/cursor-distribution.md`
"Upstream schema provenance" for the three known differences from this
repo's own (locally-invented, non-upstream) Codex schemas.

**yellow-goal engine tarball** — pinned engine identity `0.1.0`
(`plugins/yellow-goal/src/pin.ts`). This is **not** an npm registry pin:
consumers install `goal-gen-0.1.0.tgz` from the yellow-goal GitHub Release
once tag `v0.1.0` exists. The blocking check is `/goal:setup` /
`node dist/cli.js setup` (fail-closed on missing binary or
`engineVersion` mismatch), not `pnpm check:pins`. Do not treat this as
advisory.

**`@cursor/sdk`** — pinned `1.0.28` **exact** (not `^1.0.28`) in
`plugins/yellow-cursor/package.json`. The SDK's type surface and error
classes were verified against that exact installed version during contract
research (installed `.d.ts` inspection plus a handful of authenticated and
unauthenticated API probes) — NOT an end-to-end live delegate flow; the full
live smoke remains pending per `docs/cursor-distribution.md` "Limitations"
(see also `plugins/yellow-cursor/CLAUDE.md` "SDK pin policy"). Treat any
bump as a breaking change requiring re-verification of
the `instanceof` error-branching in `sdk-adapter.ts` before merging, since
the SDK's error class shapes are not guaranteed stable across versions.

## Bump Checklist

When bumping a pin:

1. Read the upstream changelog. If none exists (e.g., `@morphllm/morphmcp`),
   install the new version in a disposable workspace and compare
   `tools/list` + env-var surface vs the prior pin.
2. Update the pin in the plugin's `.claude-plugin/plugin.json` `args` array.
   **Exception — wrapper-based plugins (e.g., yellow-morph):** the version pin
   lives in `plugins/<name>/package.json` (under `dependencies`) and
   `plugins/<name>/package-lock.json`. Run `npm install @scope/pkg@X.Y.Z` inside
   the plugin directory to update both files. The `plugin.json` `args` array
   invokes the wrapper script and does NOT contain the package version.
3. Update the matching row in this file.
4. Bump the plugin's `version` (minor for behavior-preserving bumps, major
   for breaking changes in the MCP's tool surface).
5. Update the plugin's `CHANGELOG.md` with "Changed" or "Breaking" entries.
6. Run `node scripts/check-upstream-pins.js` — it should report zero drift
   for the bumped package.

## Why exact pins?

Cold-start reliability: a floating version (`latest`) means each fresh install
resolves whatever was published most recently, possibly seconds before the
user's session. That's a supply-chain attack surface AND a reliability
problem — an upstream regression lands the moment a user boots Claude Code,
with no warning. Exact pins decouple plugin behavior from upstream publishing
cadence and give us a deterministic upgrade path.
