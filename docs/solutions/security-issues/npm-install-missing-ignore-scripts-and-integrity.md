---
title:
  'Data-Dir Vendor SDK Install Missing --ignore-scripts and a Tarball Integrity
  Pin'
date: 2026-09-10
category: security-issues
track: knowledge
problem:
  'Runtime npm install --prefix <dir> for a vendored third-party SDK omits
  --ignore-scripts and has no recorded tarball integrity/sha512 pin anywhere in
  the repo'
tags:
  [
    npm-install,
    ignore-scripts,
    lifecycle-scripts,
    supply-chain,
    tarball-integrity,
    sha512,
    yellow-cursor,
    yellow-jules,
  ]
components: [plugins/yellow-cursor/src/sdk-resolver.ts]
---

<!--
track note: classified `knowledge` rather than the security-issues default
of `bug` — this documents a reusable installer-hardening pattern found
during /flow:expand-shell planning review (not yet fixed; tracked as a
PR2 follow-up), same shape as the shell-binary-downloader-security-patterns.md
override.
-->

## Context

While planning a new `yellow-jules` remote-agent provider (spec
`plans/specs/yellow-jules-integration.md`, requirement R55: third-party
lifecycle scripts must be disabled), a review of the existing `yellow-cursor`
provider's `installSdk()` (`plugins/yellow-cursor/src/ sdk-resolver.ts`) found
it runs:

```bash
npm install --prefix <runtimeDir> @cursor/sdk@1.0.28 --no-save --no-audit --no-fund
```

without `--ignore-scripts`. A data-dir install of a third-party package this way
still executes that package's `preinstall`/`install`/`postinstall` lifecycle
scripts with the host process's permissions.

Separately, no tarball integrity/sha512 record for `@cursor/sdk` exists anywhere
in the repo (`CLAUDE.md`, `docs/upstream-pins.md`, `CHANGELOG` all grep to zero
hits for `tarball`/`integrity`/`sha512`/`npm pack`). The existing pin was
verified only by `.d.ts` inspection plus limited live probes, not a recorded
hash.

## Guidance

Any runtime `npm install --prefix <dir>` of a third-party SDK into a data
directory (not a normal workspace dependency) should:

1. Include `--ignore-scripts` unless a specific lifecycle script is known to be
   required — and if one is required, that should be a deliberate, documented
   exception, not a default omission.
2. Ship a lockfile (`package-lock.json` or `npm-shrinkwrap.json`) that pins the
   _complete_ resolved dependency tree — transitive packages included — with an
   `integrity` hash per package, captured at the moment of vendoring, and record
   that same pin set in a companion file (e.g. `runtime/pin.json`) so later
   audits have a provenance trail rather than "verified once by reading
   `.d.ts`." A single tarball's sha512 is not enough: `npm install` resolves and
   extracts transitive dependencies too. A plain `npm install` does check each
   tarball against a per-package hash — the `dist.integrity` field it fetches
   from the live registry at install time — so the gap is not a missing check
   but a missing independent record: the hash it trusts comes from the same
   registry response as the tarball, and nothing committed to the repo can be
   audited against it later.
3. Install with `npm ci --ignore-scripts`, not `npm install`, so npm verifies
   every resolved package against the `integrity` hash in the shipped lockfile
   rather than against live registry metadata. The check is not pre-extraction:
   pacote streams each tarball into `tar.x` while hashing it and raises
   `EINTEGRITY` when the stream completes with a mismatch, so a corrupted or
   swapped package may already be partly on disk when the install aborts. The
   installer must therefore delete the whole runtime directory on any failure
   before anything under it is loaded, and never fall through to a partially
   written tree. Keep the lockfile synchronized with the recorded pin set on
   every version bump. `docs/yellow-jules/contract-v1.md`'s
   `JULES_SDK_INTEGRITY` error code is the established precedent for this abort
   path — name the equivalent error consistently in whichever plugin owns the
   installer.

## Why This Matters

`.d.ts` inspection and live-probe verification confirm the _shape_ of an SDK's
API, not the _safety_ of installing it — those are separate questions. A pin
with no recorded hash cannot be audited for drift on a later `npm install` of
the same "pinned" version. Related: see
[shell-binary-downloader-security-patterns.md](../security-issues/shell-binary-downloader-security-patterns.md)
for the adjacent curl/checksum threat model in binary-download wrappers — same
acquisition-security concern, different mechanism (npm lifecycle scripts vs.
shell `eval`/checksum gaps).

## When to Apply

- Any plugin that installs a vendor SDK into a data directory at runtime or
  install time via `npm install --prefix`.
- Spec/plan review for a new provider plugin that cites an existing installer as
  precedent — check it for `--ignore-scripts` and an integrity record before
  reusing the pattern.

## Examples

**Bad** (current `yellow-cursor` pattern, unpinned):

```bash
npm install --prefix "$RUNTIME_DIR" @cursor/sdk@1.0.28 --no-save --no-audit --no-fund
```

**Good**:

```bash
# $RUNTIME_DIR ships a package.json + package-lock.json pinning the full
# resolved tree (every transitive package's integrity hash included),
# captured at vendor time and mirrored into runtime/pin.json
npm ci --prefix "$RUNTIME_DIR" --no-audit --no-fund --ignore-scripts || {
  rm -rf "$RUNTIME_DIR/node_modules"   # EINTEGRITY fires at stream completion,
  exit 1                               # so a partial tree may exist; never load it
}
# `npm ci` verifies every resolved package's integrity hash against the
# lockfile (not against live registry metadata) and aborts on any mismatch;
# keep the lockfile and runtime/pin.json in sync on every version bump (see
# `JULES_SDK_INTEGRITY` in docs/yellow-jules/contract-v1.md for the
# equivalent abort-path convention)
```
