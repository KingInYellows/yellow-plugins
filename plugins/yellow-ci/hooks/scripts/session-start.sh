#!/bin/bash
# session-start.sh — Detect CI context and check for recent failures
# NOTE: SessionStart hooks run in parallel across plugins. This hook must be independent.
# Budget: 3s total (filesystem 1ms, cache check 5ms, gh API 2s, parse 50ms, buffer 500ms)
# Output: system reminder if failures detected, empty otherwise

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "$0")" 2>/dev/null && pwd -P)"

# shellcheck source=lib/validate.sh
. "${SCRIPT_DIR}/lib/validate.sh"

# --- Early exits for non-CI projects ---

# Check if this is a GitHub project with workflows
if [ ! -d ".github/workflows" ]; then
  exit 0
fi

# Check if gh CLI is available and authenticated (silent)
if ! command -v gh >/dev/null 2>&1; then
  exit 0
fi

if ! gh auth status >/dev/null 2>&1; then
  exit 0
fi

# --- Cache check (60s TTL) ---

cache_dir="${HOME}/.cache/yellow-ci"
if ! mkdir -p "$cache_dir" 2>/dev/null; then
  printf '[yellow-ci] Warning: Cannot create cache directory %s\n' "$cache_dir" >&2
  exit 0
fi

# Create cache key from current directory
cache_key=$(printf '%s' "$PWD" | tr '/' '_')
cache_file="${cache_dir}/last-check${cache_key}"

# Check cache freshness (60s TTL)
if [ -f "$cache_file" ]; then
  cache_age=0
  if stat_mtime=$(stat -c '%Y' "$cache_file" 2>/dev/null); then
    now=$(date +%s)
    cache_age=$(( now - stat_mtime ))
  fi

  if [ "$cache_age" -lt 60 ]; then
    # Cache hit — output cached result
    cat "$cache_file"
    exit 0
  fi
fi

# --- Cache miss: fetch from GitHub API ---

# Fetch recent failed runs with 2s timeout
failed_json=""
if ! failed_json=$(timeout 2 gh run list --status failure --limit 3 \
  --json databaseId,headBranch,displayTitle,conclusion,updatedAt \
  -q '[.[] | select(.conclusion == "failure")]' 2>/dev/null); then
  # gh failed (network, auth, rate limit) — exit silently
  exit 0
fi

# Parse results
failure_count=0
if [ -n "$failed_json" ] && [ "$failed_json" != "[]" ] && [ "$failed_json" != "null" ]; then
  if command -v jq >/dev/null 2>&1; then
    if printf '%s' "$failed_json" | jq -e 'type == "array"' >/dev/null 2>&1; then
      failure_count=$(printf '%s' "$failed_json" | jq -r 'length') || {
        printf '[yellow-ci] Warning: Failed to parse CI failure count\n' >&2
        failure_count=0
      }
    else
      printf '[yellow-ci] Warning: Unexpected GitHub API response format\n' >&2
      failure_count=0
    fi
  fi
fi

# --- Generate output ---

output=""
if [ "$failure_count" -gt 0 ] 2>/dev/null; then
  # Extract branch info for context
  branches=""
  if command -v jq >/dev/null 2>&1; then
    branches=$(printf '%s' "$failed_json" | jq -r '[.[].headBranch] | unique | join(", ")') || branches=""
  fi

  if [ -n "$branches" ]; then
    output="[yellow-ci] CI: ${failure_count} recent failure(s) on branch(es): ${branches}. Use /ci:diagnose to investigate."
  else
    output="[yellow-ci] CI: ${failure_count} recent failure(s) detected. Use /ci:diagnose to investigate."
  fi
fi

# Write to cache (atomic via tmp + mv)
if printf '%s' "$output" > "${cache_file}.tmp" 2>/dev/null; then
  if ! mv "${cache_file}.tmp" "$cache_file" 2>/dev/null; then
    printf '[yellow-ci] Warning: Cache write failed for %s\n' "$cache_file" >&2
    rm -f "${cache_file}.tmp" 2>/dev/null
  fi
else
  printf '[yellow-ci] Warning: Cannot write cache to %s\n' "${cache_file}.tmp" >&2
fi

# Output result
if [ -n "$output" ]; then
  printf '%s\n' "$output"
fi
