---
title: 'Data-Dir Vendor SDK Install Missing --ignore-scripts and a Tarball Integrity Pin'
date: 2026-09-10
category: security-issues
track: knowledge
problem: 'Runtime npm install --prefix <dir> for a vendored third-party SDK omits --ignore-scripts and has no recorded tarball integrity/sha512 pin anywhere in the repo'
tags: [npm-install, ignore-scripts, lifecycle-scripts, supply-chain, tarball-integrity, sha512, yellow-cursor, yellow-jules]
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
lifecycle scripts must be disabled), a review of the existing
`yellow-cursor` provider's `installSdk()` (`plugins/yellow-cursor/src/
sdk-resolver.ts`) found it runs:

```bash
npm install --prefix <runtimeDir> @cursor/sdk@1.0.28 --no-save --no-audit --no-fund
```

without `--ignore-scripts`. A data-dir install of a third-party package
this way still executes that package's `preinstall`/`install`/`postinstall`
lifecycle scripts with the host process's permissions.

Separately, no tarball integrity/sha512 record for `@cursor/sdk` exists
anywhere in the repo (`CLAUDE.md`, `docs/upstream-pins.md`, `CHANGELOG` all
grep to zero hits for `tarball`/`integrity`/`sha512`/`npm pack`). The
existing pin was verified only by `.d.ts` inspection plus limited live
probes, not a recorded hash.

## Guidance

Any runtime `npm install --prefix <dir>` of a third-party SDK into a data
directory (not a normal workspace dependency) should:

1. Include `--ignore-scripts` unless a specific lifecycle script is known
   to be required — and if one is required, that should be a deliberate,
   documented exception, not a default omission.
2. Have a recorded tarball integrity hash (sha512) captured at the moment
   of vendoring/pinning, in a lockfile-equivalent or a companion pins
   document (e.g. `docs/upstream-pins.md`), so later audits have a
   provenance trail rather than "verified once by reading `.d.ts`."

## Why This Matters

`.d.ts` inspection and live-probe verification confirm the *shape* of an
SDK's API, not the *safety* of installing it — those are separate
questions. A pin with no recorded hash cannot be audited for drift on a
later `npm install` of the same "pinned" version. Related: see
[shell-binary-downloader-security-patterns.md](../security-issues/shell-binary-downloader-security-patterns.md)
for the adjacent curl/checksum threat model in binary-download wrappers —
same acquisition-security concern, different mechanism (npm lifecycle
scripts vs. shell `eval`/checksum gaps).

## When to Apply

- Any plugin that installs a vendor SDK into a data directory at runtime
  or install time via `npm install --prefix`.
- Spec/plan review for a new provider plugin that cites an existing
  installer as precedent — check it for `--ignore-scripts` and an
  integrity record before reusing the pattern.

## Examples

**Bad** (current `yellow-cursor` pattern, unpinned):
```bash
npm install --prefix "$RUNTIME_DIR" @cursor/sdk@1.0.28 --no-save --no-audit --no-fund
```

**Good**:
```bash
npm install --prefix "$RUNTIME_DIR" @cursor/sdk@1.0.28 \
  --no-save --no-audit --no-fund --ignore-scripts
# and record the resolved tarball's sha512 in docs/upstream-pins.md
```
