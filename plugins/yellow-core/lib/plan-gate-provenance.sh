#!/usr/bin/env bash
# plan-gate-provenance.sh — Gate C commit-subject provenance for /plan:complete.
#
# Graphite merge-queue PRs stay closed with merged=false, so GitHub's
# commits/{sha}/pulls lookup returns [] for them. This library identifies the
# delivering PR from the squash commit subject's trailing " (#N)" and confirms
# it through the REST API. Sourced by plan/complete.md Phase 4.
#
#   pgp_pr_num_is_valid <n>        bare positive integer, 1-10 digits
#   pgp_pr_from_subject <subject>  print N from the last trailing " (#N)"
#   pgp_sha_is_full <sha>          40 lowercase hex characters
#   pgp_gh_error_class <errfile>   rate-limited | auth | not-found | forbidden | error
#   pgp_provenance_via_subject <owner/repo> <file-sha> <plans/file.md>
#       PASS:         stdout "PASS", "pr=#N sha=<sha> via=commit-subject",
#                     "base=<ref>" (informational); exit 0
#       NO-EVIDENCE:  stdout "NO-EVIDENCE" and one reason line; exit 1
#
# Pass requires: the plan exists at <file-sha>; the subject yields N; PR N is
# closed (merged is NOT consulted, it is permanently false for queue-merged
# PRs; base is recorded, not gated, because stacked PRs have their parent
# branch as base); PR N's files list has the plan with a status other than
# removed and a blob sha equal to the one at <file-sha>; and the PR changed at
# least one file outside plans/ whose blob at <file-sha> equals the PR's, which
# ties the PR to that commit's own content. Every other outcome is NO-EVIDENCE
# so the caller falls through to the strict, loose and override paths.
#
# Subjects, titles and file names are untrusted: only digits, the validated
# SHA and fixed text reach stdout. Error classification mirrors
# plugins/yellow-review/lib/resolve-gh.sh (re-implemented, no cross-plugin
# dependency).
#
# This file is sourced. It MUST NOT alter the caller's shell options (no
# top-level set -e/-u/pipefail) and must stay valid under bash and zsh.

if [ -n "${_PLAN_GATE_PROVENANCE_LOADED:-}" ]; then
  return 0 2>/dev/null || exit 0
fi
_PLAN_GATE_PROVENANCE_LOADED=1

# Same rule as the override validator in complete.md Phase 4:
# ^[1-9][0-9]{0,9}$. Callers strip CR/LF first.
pgp_pr_num_is_valid() {
  case "${1:-}" in
    '' | *[!0-9]* | 0*) return 1 ;;
  esac
  [ "${#1}" -le 10 ]
}

pgp_sha_is_full() {
  case "${1:-}" in
    '' | *[!0123456789abcdef]*) return 1 ;;
  esac
  [ "${#1}" -eq 40 ]
}

# Last trailing " (#N)" wins: GitHub appends its own number last. Revert,
# Reapply and merge-commit subjects, control characters and every other shape
# yield nothing (return 1).
pgp_pr_from_subject() {
  _pgp_ss=${1:-}
  case "$_pgp_ss" in
    *[[:cntrl:]]*) return 1 ;;
    'Revert "'* | 'Reapply "'* | 'Merge '*) return 1 ;;
  esac
  _pgp_ss=${_pgp_ss%"${_pgp_ss##*[! ]}"}
  case "$_pgp_ss" in
    *' (#'[0-9]*')') ;;
    *) return 1 ;;
  esac
  _pgp_sn=${_pgp_ss##*' (#'}
  _pgp_sn=${_pgp_sn%')'}
  pgp_pr_num_is_valid "$_pgp_sn" || return 1
  printf '%s\n' "$_pgp_sn"
}

pgp_gh_error_class() {
  if grep -qiE 'rate limit|abuse|HTTP 429' "${1:-/dev/null}" 2>/dev/null; then
    printf 'rate-limited'
  elif grep -qiE 'HTTP 401|Bad credentials|gh auth login' "${1:-/dev/null}" 2>/dev/null; then
    printf 'auth'
  elif grep -qiE 'HTTP 404|Not Found' "${1:-/dev/null}" 2>/dev/null; then
    printf 'not-found'
  elif grep -qiE 'HTTP 403|Resource not accessible' "${1:-/dev/null}" 2>/dev/null; then
    printf 'forbidden'
  else
    printf 'error'
  fi
}

# gh under timeout(1)/gtimeout when available; PGP_GH_TIMEOUT seconds (30).
pgp_gh() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "${PGP_GH_TIMEOUT:-30}" gh "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${PGP_GH_TIMEOUT:-30}" gh "$@"
  else
    gh "$@"
  fi
}

_pgp_no() {
  printf 'NO-EVIDENCE\n%s\n' "$1"
}

# $1 = gh exit code, $2 = stderr file, $3 = what was being fetched (fixed text)
_pgp_gh_fail() {
  if [ "${1:-}" = 124 ]; then
    _pgp_no "gh timed out fetching $3"
    return 0
  fi
  case "$(pgp_gh_error_class "${2:-}")" in
    rate-limited) _pgp_no "GitHub rate limit reached fetching $3" ;;
    auth) _pgp_no "gh is not authenticated; cannot fetch $3" ;;
    not-found) _pgp_no "$3 could not be found in this repository" ;;
    forbidden) _pgp_no "GitHub denied access fetching $3" ;;
    *) _pgp_no "gh failed fetching $3" ;;
  esac
}

# $1 = temp dir, $2 = owner/repo, $3 = file sha, $4 = plans/<file>.md
_pgp_check() {
  _pgp_wd=$1
  _pgp_repo=$2
  _pgp_sha=$3
  _pgp_plan=$4
  if ! pgp_sha_is_full "$_pgp_sha"; then
    _pgp_no 'commit id is not a full 40-hex SHA'
    return 1
  fi
  case "$_pgp_repo" in
    '' | */*/* | */ | /* | *[!A-Za-z0-9._/-]* | . | .. | ./* | ../* | */. | */..)
      _pgp_no 'owner/repo could not be resolved'
      return 1
      ;;
    */*) ;;
    *)
      _pgp_no 'owner/repo could not be resolved'
      return 1
      ;;
  esac
  case "$_pgp_plan" in
    plans/*.md) ;;
    *)
      _pgp_no 'plan path is not under plans/'
      return 1
      ;;
  esac
  case "$_pgp_plan" in
    *..* | *[[:cntrl:]]*)
      _pgp_no 'plan path is not a plain relative path'
      return 1
      ;;
  esac
  if ! git cat-file -e "${_pgp_sha}:${_pgp_plan}" 2>/dev/null; then
    _pgp_no "plan no longer exists on trunk at $_pgp_sha; already archived?"
    return 1
  fi
  _pgp_blob=$(git rev-parse "${_pgp_sha}:${_pgp_plan}" 2>/dev/null) || _pgp_blob=''
  if [ -z "$_pgp_blob" ]; then
    _pgp_no "could not read the plan blob at $_pgp_sha"
    return 1
  fi
  _pgp_subj=$(git log -1 --no-show-signature --format=%s "$_pgp_sha" -- 2>/dev/null) || _pgp_subj=''
  if ! _pgp_n=$(pgp_pr_from_subject "$_pgp_subj"); then
    _pgp_no 'commit subject has no trailing (#N) pull request number'
    return 1
  fi

  _pgp_err=$_pgp_wd/err
  _pgp_out=$_pgp_wd/pr
  if pgp_gh api "repos/$_pgp_repo/pulls/$_pgp_n" --jq '[.state, .base.ref] | @tsv' >| "$_pgp_out" 2>| "$_pgp_err"; then
    :
  else
    _pgp_gh_fail "$?" "$_pgp_err" "pull request #$_pgp_n"
    return 1
  fi
  _pgp_state=$(sed -n 1p "$_pgp_out" | cut -f1)
  _pgp_base=$(sed -n 1p "$_pgp_out" | cut -f2 | tr -d '[:cntrl:]' | cut -c1-100)
  case "$_pgp_state" in
    closed) ;;
    open)
      _pgp_no "pull request #$_pgp_n is still open; retry shortly"
      return 1
      ;;
    *)
      _pgp_no "pull request #$_pgp_n is not closed"
      return 1
      ;;
  esac

  _pgp_files=$_pgp_wd/files
  # Keep only the fields the verdict needs: every file entry otherwise carries
  # its full diff patch. The files endpoint pages 100 at a time (3000 cap), so
  # this call gets its own, longer timeout than a single-object fetch.
  if PGP_GH_TIMEOUT=${PGP_GH_FILES_TIMEOUT:-120} pgp_gh api --paginate "repos/$_pgp_repo/pulls/$_pgp_n/files?per_page=100" \
    --jq '[.[] | {filename, status, sha}]' >| "$_pgp_files" 2>| "$_pgp_err"; then
    :
  else
    _pgp_gh_fail "$?" "$_pgp_err" "the files of pull request #$_pgp_n"
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    _pgp_no 'jq is not installed; cannot read the files list'
    return 1
  fi
  _pgp_verdict=$(jq -s -r --arg p "$_pgp_plan" --arg b "$_pgp_blob" '
    (add // []) as $f
    | if ($f | type) != "array" then "bad-json"
      else [ $f[] | select(.filename == $p and .status != "removed") ] as $m
        | if ($m | length) == 0 then (if ($f | length) >= 3000 then "truncated" else "no-plan-entry" end)
          elif ($m | map(.sha) | any(. == null)) then "null-sha"
          elif ($m | map(.sha) | any(. == $b) | not) then "blob-mismatch"
          elif ([ $f[] | select((.filename | startswith("plans/")) | not) ] | length) == 0 then "plan-only"
          else "ok" end
      end' "$_pgp_files" 2>/dev/null) || _pgp_verdict='bad-json'
  case "$_pgp_verdict" in
    ok) ;;
    truncated)
      _pgp_no "files list of pull request #$_pgp_n is truncated and does not show the plan"
      return 1
      ;;
    no-plan-entry)
      _pgp_no "pull request #$_pgp_n does not add or change the plan"
      return 1
      ;;
    null-sha)
      _pgp_no "pull request #$_pgp_n lists the plan without a blob sha; cannot verify"
      return 1
      ;;
    blob-mismatch)
      _pgp_no "plan content in pull request #$_pgp_n differs from trunk at $_pgp_sha"
      return 1
      ;;
    plan-only)
      _pgp_no "pull request #$_pgp_n changes only plans/ files; no delivered work"
      return 1
      ;;
    *)
      _pgp_no "files list of pull request #$_pgp_n could not be parsed"
      return 1
      ;;
  esac
  # Tie PR N to this commit: at least one non-plans file of the PR must have
  # the same blob at <file-sha>. The plan's text alone is public and could be
  # carried by an unrelated closed PR. Checks at most 20 files; a mismatch
  # (for example a queue rebase over a concurrent change) is NO-EVIDENCE.
  _pgp_others=$_pgp_wd/others
  jq -s -r '(add // []) | [ .[] | select((.filename | startswith("plans/") | not) and .status != "removed" and .sha != null) ] | .[0:20][] | [.sha, .filename] | @tsv' "$_pgp_files" >| "$_pgp_others" 2>/dev/null || :
  _pgp_tied=0
  _pgp_tab=$(printf '\t')
  while IFS=$_pgp_tab read -r _pgp_osha _pgp_ofile; do
    [ -n "$_pgp_ofile" ] || continue
    if [ "$(git rev-parse --verify --quiet "${_pgp_sha}:${_pgp_ofile}" 2>/dev/null)" = "$_pgp_osha" ]; then
      _pgp_tied=1
      break
    fi
  done < "$_pgp_others"
  if [ "$_pgp_tied" -ne 1 ]; then
    _pgp_no "pull request #$_pgp_n has no non-plan file that matches commit $_pgp_sha"
    return 1
  fi
  printf 'PASS\npr=#%s sha=%s via=commit-subject\nbase=%s\n' "$_pgp_n" "$_pgp_sha" "$_pgp_base"
}

pgp_provenance_via_subject() {
  _pgp_tmp=$(mktemp -d 2>/dev/null) || {
    _pgp_no 'could not create a temp directory'
    return 1
  }
  # `&& rc=0 || rc=$?` keeps a caller's errexit from skipping the cleanup.
  _pgp_check "$_pgp_tmp" "${1:-}" "${2:-}" "${3:-}" && _pgp_rc=0 || _pgp_rc=$?
  rm -rf "$_pgp_tmp"
  return "$_pgp_rc"
}
