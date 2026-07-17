# Catalog / Release track gap — follow-up note

**Status:** resolved 2026-07-16 (see Outcome) · **Logged:** 2026-06-03 · **Trigger:** PR #566 → Version PR #567

## Outcome (2026-06-10)

Questions 1 and 2 from the kickoff prompt below were settled by the v2.0.0
release:

- **Cadence (Q1):** confirmed working as designed — the catalog snapshot is a
  deliberate, infrequent act. PR #580 (chatprd removal) ran
  `catalog-version.js` for the 2.0.0 major as part of the breaking change, and
  when Version PR #582 merged the publish phase armed correctly.
- **Catch-up tags (Q2):** the v2.0.0 publish swept up the previously untagged
  plugins — `yellow-core@1.20.2`, `yellow-composio@2.0.2`,
  `yellow-research@3.2.2`, `yellow-morph@1.3.0`, etc. all have tags and
  GitHub Releases as of 2026-06-10. (The first publish attempt failed on a
  latent `packages/infrastructure` type error — fixed in PR #583 — and was
  recovered via `workflow_dispatch` + `force_publish=true`, validating the
  documented recovery path.)

**Q3 resolved (2026-07-16, PR #644):** the CI guard now exists —
`scripts/validate-catalog-track.js` fails when any plugin version moved past
the last catalog tag (`v<root-version>`) while the root `package.json` did
not advance. It is wired into `pnpm release:check` and into
`version-packages.yml`'s Detect-phase "nothing to do" branch, so "plugins
changed but catalog didn't" now fails loudly instead of silently skipping
the publish phase. Known residual: the guard is bypassed on the documented
`force_publish=true` manual-recovery path (pre-existing override mechanism).

## Summary

Merging the Version Packages PR (#567) shipped three plugin bumps to `main`
(`yellow-core` 1.20.1, `yellow-composio` 2.0.2, `yellow-research` 3.2.2) but cut
**no per-plugin git tags and no GitHub Release**. This is a consequence of how
the release pipeline is wired, not a one-off failure.

## Root cause

The repo runs **two independent version tracks**:

| Track | Bumped by | Drives |
| --- | --- | --- |
| **Plugin versions** (`yellow-core` 1.20.1, …) | `pnpm changeset` naming the plugins → 3-way synced to `plugin.json` + `marketplace.json` | What `/plugin marketplace add` serves (live on `main`) |
| **Catalog version** (root `package.json`, `vX.Y.Z`) | `node scripts/catalog-version.js <patch\|minor\|major>` (a **separate, manual** step) | The marketplace-snapshot GitHub Release + the publish-phase trigger |

`.changeset/config.json` has `fixed: []` / `linked: []` and never names the root
package, so **plugin changesets do not bump the catalog version.**

`.github/workflows/version-packages.yml` "Detect phase" runs the publish phase
(per-plugin tags + Release via `scripts/ci/release-tags.sh`) **only when the
catalog tag `v<root-version>` does not already exist.** For #567 the catalog
stayed at `1.2.7`, `v1.2.7` already existed → "nothing to do" → publish skipped
(and the Build/Release + Release Notification jobs skipped).

The `catalog-version.js` step was not run as part of #566, so the release never
"armed." `docs/CLAUDE.md` (~L48–82) documents the step as *"bump root catalog
version (required for release tags)"* but at the time (pre-2026-07-16) **no CI
guard failed the build when a release bumped plugins without a catalog bump**
— so the skip was silent. Resolved by the Q3 guard — see Outcome above.

## Is it actually broken?

Likely **working as designed.** The catalog (`v1.2.7`) is far behind the plugins
(`1.20.x` / `2.0.x` / `3.2.x`), which indicates catalog/marketplace-snapshot
Releases are cut **deliberately and infrequently**, batching per-plugin tags
when they happen. The plugins are released the moment they land on `main`; the
tags + GitHub Release are an archival/snapshot layer cut at the next catalog
bump. The genuine gap was the **silent** nature of the skip (no guard, easy to
assume a Release cut when it didn't) — closed by the Q3 guard, see Outcome
above.

## Options (pick one)

_Historical (pre-2026-07-16) decision point. Option 2 was the one implemented
— see Outcome above._

1. **Cut the snapshot now** — small PR running `node scripts/catalog-version.js
   patch` (`1.2.7` → `1.2.8`); on merge it arms the publish phase the blessed
   way and tags all caught-up plugins. One-shot alternative:
   `workflow_dispatch` on `version-packages.yml` with `force_publish=true`.
2. **Add a CI guard** — fail (or auto-bump) when a release changes any
   `plugins/*/package.json` version without a corresponding catalog bump.
   **Implemented 2026-07-16 (PR #644)** as `scripts/validate-catalog-track.js`.
3. **Leave it** — document that the current infrequent-snapshot cadence is
   intentional; no action.

**Verify a cut release with:** tags `yellow-core@1.20.1` (etc.) present +
`gh release list` shows the new Releases.

## Key files

`.github/workflows/version-packages.yml` · `scripts/catalog-version.js` ·
`scripts/validate-catalog-track.js` · `scripts/ci/release-tags.sh` ·
`scripts/generate-release-notes.js` · `docs/CLAUDE.md` ·
`.changeset/config.json` · root `package.json` · `CONTRIBUTING.md`

## Next-session kickoff prompt

_Historical — all three questions below are now resolved (Q1/Q2: 2026-06-10;
Q3: 2026-07-16, PR #644). Retained for reference on how the investigation was
originally scoped._

```
Sort out the catalog/Release versioning track in yellow-plugins
(KingInYellows/yellow-plugins). Investigate first, then implement the agreed
fix. Confirm any irreversible action (cutting tags/Releases, force-publish)
with me before running it. Full background + options are in
docs/maintenance/catalog-release-gap.md — read it first.

Resolve: (1) intended cadence — should per-plugin tags + Releases fire on every
plugin bump or only on deliberate catalog snapshots? (2) do the already-shipped
yellow-core 1.20.1 / yellow-composio 2.0.2 / yellow-research 3.2.2 need
tags+Releases now (catalog-version.js patch PR vs force_publish=true)? (3) add a
CI guard so a plugin bump without a catalog bump can't silently skip the
release?

DONE = a recorded + implemented decision: snapshot cut and verified (tags
`yellow-core@1.20.1` etc. + `gh release list`), and/or a CI-guard PR merged, OR
a documented decision that the infrequent-snapshot cadence is intentional. Use
Graphite (gt) for branch/PR work.
```
