# Shell Binary Downloader Security Patterns

**Source:** PR #241 review (2026-04-03) — `.codacy/cli.sh`
**Agents:** code-reviewer, security-sentinel, silent-failure-hunter

## Context

Shell scripts that download and execute remote binaries are common in CLI tool wrappers (Codacy, Semgrep, etc.). These scripts have a concentrated attack surface: they fetch code from the internet, extract it, and run it with the user's permissions.

## Patterns Found

### 1. `eval "$command $*"` — Command Injection

**Problem:** `eval` re-parses the entire string as shell code. `$*` concatenates all positional parameters into one string without preserving boundaries. Any argument containing `;`, `$(...)`, backticks, or `|` executes as shell code.

**Fix:** `"$command" "$@"` — no `eval`, and `"$@"` preserves argument boundaries.

### 2. `set -e +o pipefail` — Pipefail Confusion

**Problem:** In bash `set`, `+o` **disables** an option and `-o` **enables** it. This is the opposite of what most developers expect. `+o pipefail` silently allows pipeline failures.

**Fix:** `set -eo pipefail` (or `set -Eeuo pipefail` for maximum strictness).

### 3. `local version=$(...)` — Exit Code Masking

**Problem:** `local` is a command that always returns 0. When combined with a command substitution on the same line, the exit code of the substitution is masked.

**Fix:** Split into two lines: `local version; version=$(...)`.

### 4. `curl ... 2>/dev/null` — Silent Network Failures

**Problem:** Redirecting curl's stderr to /dev/null hides TLS errors, DNS failures, timeouts, and connection refused. The caller gets an empty response with no indication of failure.

**Fix:** Remove `2>/dev/null`. Add `|| fatal "Failed to reach API"` after the curl command.

### 5. Missing `--fail` on Download Curl

**Problem:** Without `-f`/`--fail`, curl saves HTTP error pages (404, 500) as the output file. Subsequent `tar` extraction fails with cryptic "not in gzip format" instead of "download failed: HTTP 404".

**Fix:** Add `-f` to curl flags: `curl -f -# -LS "$url" -O`.

### 6. Empty API Response → Poisoned Cache

**Problem:** If the GitHub API returns no `tag_name` (rate limit body, changed schema, empty JSON), the version variable is empty. Writing `version: ""` to a cache file poisons all subsequent runs — they read the empty version, fail silently, and the user must manually delete the cache.

**Fix:** Guard before writing: `[ -n "$version" ] || fatal "Could not determine version"`.

### 7. `fatal` Called but Never Defined

**Problem:** Calling an undefined function in bash produces `fatal: command not found` (exit 127) instead of the intended error message. Under `set -e`, the script exits, but the real error context is lost.

**Fix:** Define early: `fatal() { echo "FATAL: $*" >&2; exit 1; }`.

## Checklist for Shell Binary Downloaders

- [ ] No `eval` — use `"$command" "$@"` for argument passing
- [ ] `set -eo pipefail` (not `+o`)
- [ ] All helper functions defined before first call
- [ ] `local` and assignment on separate lines
- [ ] No `2>/dev/null` on network calls
- [ ] `--fail` flag on download curl
- [ ] Guard empty values before writing to cache/config files
- [ ] Validate version strings against expected pattern
- [ ] Verify checksums after download (SHA256)
