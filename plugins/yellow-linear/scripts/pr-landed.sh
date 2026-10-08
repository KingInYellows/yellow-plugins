#!/usr/bin/env bash
# pr-landed.sh — did a CLOSED, unmerged PR land on the default branch?
#
# Graphite's merge queue lands a PR by pushing its squash commit to the default
# branch and then closing the PR, so GitHub reports state CLOSED with
# mergedAt null for work that did land. This script answers for one PR:
#
#   pr-landed.sh <owner/name> <pr-number>
#
# stdout: exactly one line, landed=yes | landed=no | landed=unknown
# stderr: for unknown, one "[pr-landed] <reason>" line (never a URL or token)
# exit:   0 for every classification; 2 for a usage error
#
# landed=yes  the default branch has a commit whose subject ends in "(#<n>)",
#             the form Graphite's squash commits take. This is a heuristic:
#             a cherry-pick or a re-land carries the same suffix, so callers
#             keep every status change behind the user's confirmation.
# landed=no   the scan ran to the end of a complete history and found none.
# landed=unknown  anything that could make "no" wrong: origin is not <owner/name>,
#             origin/HEAD is unset, the clone is shallow, the fetch or git log
#             failed. Callers report "closed, landing unverified" and propose
#             nothing.
#
# Self-contained: it takes the PR number as an argument, fetches, scans and
# prints, so no shell variable has to survive between Bash calls.

set -uo pipefail

usage() {
  printf 'usage: pr-landed.sh <owner/name> <pr-number>\n' >&2
  exit 2
}

repo=${1:-}
pr=${2:-}
[ "$#" -eq 2 ] || usage
case "$repo" in
  '' | */*/* | /* | */ | *[!A-Za-z0-9._/-]*) usage ;;
  */*) ;;
  *) usage ;;
esac
case "$pr" in
  '' | 0* | *[!0-9]*) usage ;;
esac
[ "${#pr}" -le 10 ] || usage

unknown() {
  printf 'landed=unknown\n'
  printf '[pr-landed] %s\n' "$1" >&2
  exit 0
}

# t <command...>: bounded when timeout(1)/gtimeout exists.
t() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 30 "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout 30 "$@"
  else
    "$@"
  fi
}

# The fetch and the log read origin, so origin must be the repository the PR
# came from. The URL is never printed: it can carry credentials.
origin_url=$(git remote get-url origin 2>/dev/null) || unknown 'no origin remote'
# GitHub paths are case-insensitive, so compare lowercased copies.
origin_lc=$(printf '%s' "$origin_url" | tr '[:upper:]' '[:lower:]')
repo_lc=$(printf '%s' "$repo" | tr '[:upper:]' '[:lower:]')
case "$origin_lc" in
  *"/$repo_lc" | *"/$repo_lc.git" | *":$repo_lc" | *":$repo_lc.git") ;;
  *) unknown "origin is not $repo, so the default-branch check would read a different repository" ;;
esac

default_branch=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) || default_branch=''
default_branch=${default_branch#origin/}
[ -n "$default_branch" ] || unknown 'origin/HEAD is not set (run: git remote set-head origin --auto)'
case "$default_branch" in
  -* | *[!A-Za-z0-9._/-]*) unknown 'the default branch name is not usable' ;;
esac

# A shallow history can hide the squash commit, which would read as "no".
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" != false ]; then
  unknown 'this clone is shallow (or its depth cannot be read); history may be truncated'
fi

# git's own error text can carry the remote URL, so only fixed text is reported.
GIT_TERMINAL_PROMPT=0 t git fetch --quiet origin "$default_branch" >/dev/null 2>&1 \
  || unknown "git fetch origin $default_branch failed"

ref="refs/remotes/origin/$default_branch"
git rev-parse --verify --quiet "$ref^{commit}" >/dev/null 2>&1 || unknown "$ref does not resolve after the fetch"

# --grep narrows the scan to commits that mention the number at all; the exact
# check below is on the subject, so a body line ending in the number does not
# count. The log's own status is checked: a git failure is never "no match".
matches=$(git log "$ref" --fixed-strings --grep="(#${pr})" --format=%s 2>/dev/null) \
  || unknown 'git log failed'

# No -q: grep must read all input, or pipefail would turn SIGPIPE into a miss.
if printf '%s\n' "$matches" | grep -E "\(#${pr}\)[[:space:]]*\$" >/dev/null; then
  printf 'landed=yes\n'
else
  printf 'landed=no\n'
fi
