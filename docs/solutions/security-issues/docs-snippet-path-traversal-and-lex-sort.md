# Documentation Snippet Path Traversal and Lex-Sort Bugs (PR #295)

**Category:** security-issues  
**PR:** #295 — chore(docs): clear validator INFO + document non-interactive cache refresh  
**Date:** 2026-04-30

## Summary

A "documentation-only" PR introduced a copy-paste shell snippet in `CONTRIBUTING.md` with two P1
findings surfaced by 4-way cross-reviewer agreement:

1. **Path traversal via jq-controlled shell values** — `mp_ver` and `plugin` (basename) flowed
   directly into `rsync --delete` target paths without allowlist validation. A malicious
   `plugin.json` with `version: "../../../"` or a directory named `../evil` could reach arbitrary
   filesystem paths.

2. **Lexicographic sort failure on semver** — `ls -d "$CACHE/$plugin"/*/ | tail -1` selects
   highest directory by locale-dependent byte order, not semantic version. `1.9.0` sorts after
   `1.10.0` lexicographically, so the seed-copy fallback would incorrectly prefer `1.9.x` over
   `1.10.x`.

## Root Cause

Both bugs are invisible to quick review because the snippet was presented as documentation rather
than checked-in code, and neither introduced functional regressions in the happy path. The lex-sort
bug only manifests on double-digit minor/patch versions; the path traversal requires a crafted
marketplace clone.

## Fix Applied

**Path traversal:** Added `case` allowlist guards on both values before any path construction:

```bash
# plugin name: reject anything not matching [a-z0-9-], empty, or hyphen-anchored
case "$plugin" in
  *[!a-z0-9-]* | '' | -* | *-)
    printf '[cache-refresh] Skipping unsafe plugin name: %s\n' "$plugin" >&2
    continue
    ;;
esac

# version: reject empty, path separators, double-dots, leading dot or hyphen
case "$mp_ver" in
  '' | */* | *..* | .* | -*)
    printf '[cache-refresh] Skipping invalid version %s for %s\n' "$mp_ver" "$plugin" >&2
    continue
    ;;
esac
```

**Lex-sort:** Replace `ls | tail -1` with `sort -V | tail -1`:

```bash
# Before (wrong — locale-dependent lex sort)
existing=$(ls -d "$CACHE/$plugin"/*/ 2>/dev/null | tail -1)

# After (correct — semantic version sort)
existing=$(ls -d "$CACHE/$plugin"/*/ 2>/dev/null | sort -V | tail -1)
```

**Additional hardening in same pass:**
- Added `set -euo pipefail` + `command -v rsync/jq` prereq checks
- Added `--` separator before all positional args to rsync and cp
- Added explicit `cp` failure handler (`|| { printf '...\n' >&2; continue; }`)
- Added `[ -d "$MARKETPLACE" ]` guard

## Lessons

1. **Documentation snippets are a real attack surface.** A `CONTRIBUTING.md` code block that users
   run verbatim has identical security requirements to a checked-in script. Apply the same
   path-traversal / lex-sort / error-handling review to prose shell examples.

2. **`ls | tail -1` is always wrong for "highest version."** Use `sort -V | tail -1`. The lex-sort
   bug is silent in CI (test fixtures rarely span `x.9.y` → `x.10.y`) and only manifests in
   production environments with enough version history.

3. **4-way cross-reviewer agreement (anchor 100) is a reliable P1 signal.** The lex-sort finding
   was flagged independently by maintainability-reviewer, correctness-reviewer, security-reviewer,
   and comment-analyzer — cross-reviewer agreement promotion elevated it from P2 → P1 before
   human review. Treat 3+ independent reviewers citing the same fingerprint as a hard finding.

4. **`jq -r '.version // ""'` does not sanitize.** The `// ""` guard only handles `null` — it does
   not prevent `../traversal`, `/abs/path`, or hyphen-prefixed flag strings from entering path
   construction. Always apply a separate allowlist after jq extraction.

## Detection Checklist

When reviewing any shell snippet (docs or code) that:
- Reads a field from external JSON (jq) and uses it in a path
- Selects a "latest" directory with `ls | tail` or `ls | sort | tail`

Apply:
- [ ] Allowlist the jq-extracted value with `case` before path construction
- [ ] Replace `ls | tail` with `ls | sort -V | tail` for semver directories
- [ ] Add `--` before positional args that follow `cp`, `rsync`, `mv`
- [ ] Verify `sort -V` availability (`man sort | grep version-sort` or `sort --help | grep -V`)
