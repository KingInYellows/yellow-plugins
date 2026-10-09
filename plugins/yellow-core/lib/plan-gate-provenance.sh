#!/usr/bin/env bash
# plan-gate-provenance.sh — Gate C file-provenance tier for /plan:complete.
#
# Graphite merge-queue PRs stay closed with merged=false, so GitHub's
# commits/{sha}/pulls lookup returns [] for them. This library identifies the
# delivering PR from the squash commit subject's trailing " (#N)" and confirms
# it through the REST API. Sourced by plan/complete.md Phase 4 and Phase 7.
#
#   pgp_pr_num_is_valid <n>        bare positive integer, 1-10 digits
#   pgp_pr_from_subject <subject>  print N from the last trailing " (#N)"
#   pgp_sha_is_full <sha>          40 lowercase hex characters
#   pgp_evidence_line_is_valid <l> one evidence line: pr=#N sha=<40 hex> with an
#                                  optional " via=commit-subject" suffix
#   pgp_gh_error_class <errfile>   rate-limited | auth | not-found | forbidden | error
#   pgp_reason_is_retryable <tok>  0 for gh-timeout, rate-limited and pr-open
#   pgp_provenance_via_subject <owner/repo> <file-sha> <plans/file.md>
#       PASS:         exit 0, stdout one line "pr=#N sha=<sha> via=commit-subject"
#       NO-EVIDENCE:  exit 1, stdout "<reason-token>" then one reason line
#   pgp_tier_run <plan-file-name> <trunk>
#       The whole Phase 4 file-provenance tier: always returns 0, prints log
#       lines and the decision lines below, and writes the evidence line to
#       $(git rev-parse --git-path tmp)/plan-complete.provenance only on a pass.
#
# Decision lines (the only text the caller may key on):
#   [plan:complete] GATE_C_PROVENANCE=PASS|FALLTHROUGH
#   [plan:complete] GATE_C_REASON=<token> GATE_C_RETRYABLE=0|1
#
# Before ANY pass, commits-API or commit-subject (pgp_tier_run): the working-tree
# plan must have the same blob as the plan at the commit that last touched it on
# trunk. Gate A reads the working tree, so a plan completed only on an unlanded
# branch must not borrow the evidence of the landed version (for example the PR
# that merely created the plan). A different blob skips the whole tier (reason
# wt-differs).
#
# The commit-subject pass then requires ALL of:
#   1. the plan exists at <file-sha>, and the subject yields N: the last
#      trailing " (#N)", with no control characters and no Revert", Reapply",
#      "Merge pull request " or "Merge branch " subject;
#   2. PR N is closed (merged is NOT consulted, it is permanently false for
#      queue-merged PRs; the base branch is not consulted either, because
#      stacked PRs have their parent branch as base);
#   3. PR N's files list has the plan with a status other than removed and a
#      blob sha equal to the one at <file-sha>;
#   4. the PR changed a file outside plans/ whose blob at <file-sha> equals the
#      PR's and which that commit itself changed (its parent's blob differs),
#      which ties the PR to the commit's own work. Only the first 20 such files
#      are compared; a parent commit that cannot be read (shallow boundary,
#      missing object) is NO-EVIDENCE, never a pass.
# Every other outcome is NO-EVIDENCE, so the caller falls through to the strict,
# loose and override paths.
#
# Reason tokens: no-jq, no-temp, bad-sha, bad-repo, bad-plan-path, plan-missing,
# no-subject-pr, gh-timeout, rate-limited, auth, not-found, forbidden, gh-error,
# pr-open, pr-not-closed, files-truncated, files-unparsed, no-plan-entry,
# null-sha, blob-mismatch, plan-only, parent-unreadable, no-tie. pgp_tier_run
# adds no-commit, fetch-failed, plan-archived, no-repo, lookup-failed,
# ambiguous and wt-differs.
#
# Timeouts (seconds, under timeout(1)/gtimeout): 20 for a single-object fetch,
# 60 for the paginated files list and git fetch. Without either binary the gh
# calls run unbounded and one NOTE says so on stderr. Worst case stays under
# the Bash tool's 2-minute limit.
#
# Subjects, titles, branch and file names are untrusted: only digits, the
# validated SHA and fixed text reach stdout. Error classification mirrors
# plugins/yellow-review/lib/resolve-gh.sh (re-implemented, no cross-plugin
# dependency).
#
# This file is sourced. It MUST NOT alter the caller's shell options (no
# top-level set -e/-u/pipefail) and must stay valid under bash and zsh.

if [ -n "${_PLAN_GATE_PROVENANCE_LOADED:-}" ]; then
  return 0 2>/dev/null || exit 0
fi
_PLAN_GATE_PROVENANCE_LOADED=1

_pgp_nl='
'

# ^[1-9][0-9]{0,9}$ . Callers strip CR/LF first. complete.md's override block
# calls this directly.
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

# One evidence line, exactly: the form that becomes a commit trailer.
pgp_evidence_line_is_valid() {
  case "${1:-}" in
    '' | *"$_pgp_nl"*) return 1 ;;
  esac
  printf '%s\n' "$1" | grep -qE '^pr=#[1-9][0-9]{0,9} sha=[0-9a-f]{40}( via=commit-subject)?$'
}

# Last trailing " (#N)" wins: GitHub appends its own number last. Revert and
# Reapply subjects, "Merge pull request " and "Merge branch " subjects, control
# characters and every other shape yield nothing (return 1).
pgp_pr_from_subject() {
  _pgp_ss=${1:-}
  case "$_pgp_ss" in
    *[[:cntrl:]]*) return 1 ;;
    'Revert "'* | 'Reapply "'* | 'Merge pull request '* | 'Merge branch '*) return 1 ;;
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

# Transient causes: the caller should stop and retry later, not prompt.
pgp_reason_is_retryable() {
  case "${1:-}" in
    gh-timeout | rate-limited | pr-open) return 0 ;;
  esac
  return 1
}

# pgp_t <seconds> <command...>: under timeout(1)/gtimeout when available.
pgp_t() {
  _pgp_secs=${1:-20}
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$_pgp_secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$_pgp_secs" "$@"
  else
    if [ -z "${_PGP_NOTIMEOUT_NOTED:-}" ]; then
      _PGP_NOTIMEOUT_NOTED=1
      printf '[plan:complete] NOTE: neither timeout nor gtimeout is installed; GitHub calls run without a time limit\n' >&2
    fi
    "$@"
  fi
}

# pgp_gh_t <seconds> <gh args...>
pgp_gh_t() {
  _pgp_gsecs=${1:-20}
  shift
  pgp_t "$_pgp_gsecs" gh "$@"
}

# NO-EVIDENCE output: the fixed token, then one fixed-text reason line.
_pgp_no() {
  printf '%s\n%s\n' "$1" "$2"
}

# $1 = gh exit code, $2 = stderr file, $3 = what was being fetched (fixed text)
_pgp_gh_fail() {
  if [ "${1:-}" = 124 ]; then
    _pgp_no gh-timeout "gh timed out fetching $3"
    return 0
  fi
  case "$(pgp_gh_error_class "${2:-}")" in
    rate-limited) _pgp_no rate-limited "GitHub rate limit reached fetching $3" ;;
    auth) _pgp_no auth "gh is not authenticated; cannot fetch $3" ;;
    not-found) _pgp_no not-found "$3 could not be found in this repository" ;;
    forbidden) _pgp_no forbidden "GitHub denied access fetching $3" ;;
    *) _pgp_no gh-error "gh failed fetching $3" ;;
  esac
}

# $1 = temp dir, $2 = owner/repo, $3 = file sha, $4 = plans/<file>.md
_pgp_check() {
  _pgp_wd=$1
  _pgp_repo=$2
  _pgp_sha=$3
  _pgp_plan=$4
  if ! command -v jq >/dev/null 2>&1; then
    _pgp_no no-jq 'jq is not installed; cannot read the files list'
    return 1
  fi
  if ! pgp_sha_is_full "$_pgp_sha"; then
    _pgp_no bad-sha 'commit id is not a full 40-hex SHA'
    return 1
  fi
  case "$_pgp_repo" in
    '' | */*/* | */ | /* | *[!A-Za-z0-9._/-]* | . | .. | ./* | ../* | */. | */..)
      _pgp_no bad-repo 'owner/repo could not be resolved'
      return 1
      ;;
    */*) ;;
    *)
      _pgp_no bad-repo 'owner/repo could not be resolved'
      return 1
      ;;
  esac
  case "$_pgp_plan" in
    plans/*.md) ;;
    *)
      _pgp_no bad-plan-path 'plan path is not under plans/'
      return 1
      ;;
  esac
  case "$_pgp_plan" in
    *..* | *[[:cntrl:]]*)
      _pgp_no bad-plan-path 'plan path is not a plain relative path'
      return 1
      ;;
  esac
  _pgp_blob=$(git rev-parse --verify --quiet "${_pgp_sha}:${_pgp_plan}" 2>/dev/null) || _pgp_blob=''
  if [ -z "$_pgp_blob" ]; then
    _pgp_no plan-missing "plan no longer exists on trunk at $_pgp_sha; already archived?"
    return 1
  fi
  _pgp_subj=$(git log -1 --no-show-signature --format=%s "$_pgp_sha" -- 2>/dev/null) || _pgp_subj=''
  if ! _pgp_n=$(pgp_pr_from_subject "$_pgp_subj"); then
    _pgp_no no-subject-pr 'commit subject has no trailing (#N) pull request number'
    return 1
  fi

  _pgp_err=$_pgp_wd/err
  _pgp_out=$_pgp_wd/pr
  if pgp_gh_t 20 api "repos/$_pgp_repo/pulls/$_pgp_n" --jq '.state' >| "$_pgp_out" 2>| "$_pgp_err"; then
    :
  else
    _pgp_gh_fail "$?" "$_pgp_err" "pull request #$_pgp_n"
    return 1
  fi
  _pgp_state=$(sed -n 1p "$_pgp_out")
  case "$_pgp_state" in
    closed) ;;
    open)
      _pgp_no pr-open "pull request #$_pgp_n is still open; retry shortly"
      return 1
      ;;
    *)
      _pgp_no pr-not-closed "pull request #$_pgp_n is not closed"
      return 1
      ;;
  esac

  _pgp_files=$_pgp_wd/files
  # Keep only the fields the verdict needs: every file entry otherwise carries
  # its full diff patch. The files endpoint pages 100 at a time (3000 cap), so
  # this call gets its own, longer timeout than a single-object fetch.
  if pgp_gh_t 60 api --paginate "repos/$_pgp_repo/pulls/$_pgp_n/files?per_page=100" \
    --jq '[.[] | {filename, status, sha}]' >| "$_pgp_files" 2>| "$_pgp_err"; then
    :
  else
    _pgp_gh_fail "$?" "$_pgp_err" "the files of pull request #$_pgp_n"
    return 1
  fi
  # One jq pass: the verdict on line 1; for "ok", the number of non-plan
  # candidates on line 2, then at most 20 "<blob sha><TAB><file>" rows. @tsv
  # escapes tabs, newlines and backslashes in file names, so such names never
  # match: a false negative, never a false pass. A jq failure is "files-unparsed".
  _pgp_res=$(jq -s -r --arg p "$_pgp_plan" --arg b "$_pgp_blob" '
    (add // []) as $f
    | if ($f | type) != "array" then "bad-json"
      else [ $f[] | select(.filename == $p and .status != "removed") ] as $m
        | if ($m | length) == 0 then (if ($f | length) >= 3000 then "truncated" else "no-plan-entry" end)
          elif ($m | map(.sha) | any(. == null)) then "null-sha"
          elif ($m | map(.sha) | any(. == $b) | not) then "blob-mismatch"
          else
            [ $f[] | select((.filename | startswith("plans/") | not) and .status != "removed" and .sha != null) ] as $o
            | if ($o | length) == 0 then "plan-only"
              else "ok", ($o | length), ($o[0:20][] | [.sha, .filename] | @tsv)
              end
          end
      end' "$_pgp_files" 2>/dev/null) || _pgp_res='bad-json'
  _pgp_verdict=$(printf '%s\n' "$_pgp_res" | sed -n 1p)
  case "$_pgp_verdict" in
    ok) ;;
    truncated)
      _pgp_no files-truncated "files list of pull request #$_pgp_n is truncated and does not show the plan"
      return 1
      ;;
    no-plan-entry)
      _pgp_no no-plan-entry "pull request #$_pgp_n does not add or change the plan"
      return 1
      ;;
    null-sha)
      _pgp_no null-sha "pull request #$_pgp_n lists the plan without a blob sha; cannot verify"
      return 1
      ;;
    blob-mismatch)
      _pgp_no blob-mismatch "plan content in pull request #$_pgp_n differs from trunk at $_pgp_sha"
      return 1
      ;;
    plan-only)
      _pgp_no plan-only "pull request #$_pgp_n changes only plans/ files; no delivered work"
      return 1
      ;;
    *)
      _pgp_no files-unparsed "files list of pull request #$_pgp_n could not be parsed"
      return 1
      ;;
  esac
  _pgp_total=$(printf '%s\n' "$_pgp_res" | sed -n 2p)
  _pgp_others=$_pgp_wd/others
  printf '%s\n' "$_pgp_res" | sed '1,2d' >| "$_pgp_others"

  # The parent decides "the commit changed this file". An unreadable parent (a
  # shallow boundary or a missing object) must not read as "no such file
  # before": every file would then look changed by this commit.
  _pgp_par=$(git rev-parse --verify --quiet "${_pgp_sha}^" 2>/dev/null) || _pgp_par=''
  if [ -n "$_pgp_par" ]; then
    if ! git cat-file -e "${_pgp_par}^{tree}" 2>/dev/null; then
      _pgp_no parent-unreadable "the parent of commit $_pgp_sha cannot be read; cannot tell what the commit changed"
      return 1
    fi
  else
    _pgp_shallow=$(git rev-parse --git-path shallow 2>/dev/null) || _pgp_shallow=''
    if [ -n "$_pgp_shallow" ] && [ -f "$_pgp_shallow" ] && grep -qx "$_pgp_sha" "$_pgp_shallow" 2>/dev/null; then
      _pgp_no parent-unreadable "commit $_pgp_sha is at a shallow boundary; cannot tell what it changed"
      return 1
    fi
  fi

  # Tie PR N to this commit: at least one of the (at most 20) non-plans files
  # must have the same blob at <file-sha> and be changed by that commit. The
  # plan's text alone is public and could be carried by an unrelated closed PR.
  _pgp_tied=0
  _pgp_tab=$(printf '\t')
  while IFS=$_pgp_tab read -r _pgp_osha _pgp_ofile; do
    [ -n "$_pgp_ofile" ] || continue
    # The commit's blob must exist and equal the PR's (an empty sha never
    # matches), and the parent's blob must differ: a file that merely sits
    # unchanged on trunk proves nothing about this commit.
    _pgp_here=$(git rev-parse --verify --quiet "${_pgp_sha}:${_pgp_ofile}" 2>/dev/null || :)
    _pgp_before=$(git rev-parse --verify --quiet "${_pgp_sha}^:${_pgp_ofile}" 2>/dev/null || :)
    if [ -n "$_pgp_here" ] && [ "$_pgp_here" = "$_pgp_osha" ] && [ "$_pgp_before" != "$_pgp_osha" ]; then
      _pgp_tied=1
      break
    fi
  done < "$_pgp_others"
  if [ "$_pgp_tied" -ne 1 ]; then
    if [ "${_pgp_total:-0}" -gt 20 ] 2>/dev/null; then
      _pgp_no no-tie "pull request #$_pgp_n has no non-plan file that matches commit $_pgp_sha (checked the first 20 of $_pgp_total)"
    else
      _pgp_no no-tie "pull request #$_pgp_n has no non-plan file that matches commit $_pgp_sha"
    fi
    return 1
  fi
  printf 'pr=#%s sha=%s via=commit-subject\n' "$_pgp_n" "$_pgp_sha"
}

pgp_provenance_via_subject() {
  _pgp_tmp=$(mktemp -d 2>/dev/null) || {
    _pgp_no no-temp 'could not create a temp directory'
    return 1
  }
  # `&& rc=0 || rc=$?` keeps a caller's errexit from skipping the cleanup.
  _pgp_check "$_pgp_tmp" "${1:-}" "${2:-}" "${3:-}" && _pgp_rc=0 || _pgp_rc=$?
  rm -rf "$_pgp_tmp"
  return "$_pgp_rc"
}

# _pgt_done <PASS|FALLTHROUGH> <token> : the decision lines.
_pgt_done() {
  if pgp_reason_is_retryable "$2"; then _pgt_retry=1; else _pgt_retry=0; fi
  printf '[plan:complete] GATE_C_PROVENANCE=%s\n' "$1"
  printf '[plan:complete] GATE_C_REASON=%s GATE_C_RETRYABLE=%s\n' "$2" "$_pgt_retry"
}

# pgp_tier_run <plan-file-name> <trunk>
pgp_tier_run() {
  _pgt_arg=${1:-}
  _pgt_trunk=${2:-main}
  _pgt_dir=$(git rev-parse --git-path tmp 2>/dev/null) || _pgt_dir=''
  if [ -z "$_pgt_dir" ] || ! mkdir -p -- "$_pgt_dir" 2>/dev/null; then
    printf '[plan:complete] WARNING: could not create the git tmp directory; provenance tier skipped\n' >&2
    _pgt_done FALLTHROUGH no-commit
    return 0
  fi
  _pgt_prov=$_pgt_dir/plan-complete.provenance
  # This function owns the clear: a stale file from an aborted run must never
  # reach the Phase 7 trailer.
  rm -f -- "$_pgt_prov"
  # A timed-out or rate-limited repo lookup is a retryable stop, not no-repo.
  _pgt_oerr=$(mktemp 2>/dev/null) || _pgt_oerr=/dev/null
  _pgt_orc=0
  _pgt_owner=$(pgp_gh_t 20 repo view --json nameWithOwner -q .nameWithOwner 2>|"$_pgt_oerr") || _pgt_orc=$?
  _pgt_noowner=no-repo
  if [ "$_pgt_orc" = 124 ]; then
    _pgt_noowner=gh-timeout
  elif [ "$_pgt_orc" != 0 ] && [ "$(pgp_gh_error_class "$_pgt_oerr")" = rate-limited ]; then
    _pgt_noowner=rate-limited
  fi
  [ "$_pgt_oerr" = /dev/null ] || rm -f -- "$_pgt_oerr"
  [ "$_pgt_orc" = 0 ] || _pgt_owner=''
  _pgt_ownersafe=$(printf '%s' "$_pgt_owner" | tr -d '[:cntrl:]')
  _pgt_reason=no-commit
  _pgt_fsha=''
  # origin/<trunk>, not local HEAD: the local checkout may be stale or on an
  # unrelated branch. A failed fetch must not fall through to a stale
  # origin/<trunk> that could still produce an outdated unique match.
  if ! pgp_t 60 git fetch origin "$_pgt_trunk" --quiet 2>/dev/null; then
    printf '[plan:complete] WARNING: git fetch origin %s failed; provenance tier skipped (stale history risk)\n' "$_pgt_trunk" >&2
    _pgt_reason=fetch-failed
  else
    _pgt_fsha=$(git log -1 --format=%H "origin/$_pgt_trunk" -- "plans/$_pgt_arg" 2>/dev/null || :)
  fi
  # A stale local checkout can still hold a plan that trunk already archived;
  # then the commit is the archive commit and its PR is no evidence of delivery.
  if [ -n "$_pgt_fsha" ] && ! git cat-file -e "${_pgt_fsha}:plans/${_pgt_arg}" 2>/dev/null; then
    printf '[plan:complete] WARNING: plans/%s no longer exists on %s at %s (already archived?); provenance tier skipped\n' "$_pgt_arg" "$_pgt_trunk" "$_pgt_fsha" >&2
    _pgt_fsha=''
    _pgt_reason=plan-archived
  fi
  # Gate A read the working-tree plan; the evidence is about the plan on trunk.
  # Different bytes mean the plan was completed on a branch that has not landed,
  # so the landed version's PR proves nothing about it. This guards both the
  # commits-API pass and the commit-subject pass.
  if [ -n "$_pgt_fsha" ]; then
    _pgt_wt=$(git hash-object -- "plans/$_pgt_arg" 2>/dev/null || :)
    _pgt_tk=$(git rev-parse --verify --quiet "${_pgt_fsha}:plans/${_pgt_arg}" 2>/dev/null || :)
    if [ -z "$_pgt_wt" ] || [ "$_pgt_wt" != "$_pgt_tk" ]; then
      printf '[plan:complete] WARNING: the working-tree plans/%s differs from the plan on %s at %s; provenance tier skipped\n' "$_pgt_arg" "$_pgt_trunk" "$_pgt_fsha" >&2
      _pgt_fsha=''
      _pgt_reason=wt-differs
    fi
  fi
  _pgt_pcount=0
  _pgt_lookup=skipped
  _pgt_pulls='[]'
  if [ -n "$_pgt_fsha" ] && [ -z "$_pgt_owner" ]; then
    _pgt_reason=$_pgt_noowner
  fi
  if [ -n "$_pgt_fsha" ] && [ -n "$_pgt_owner" ]; then
    _pgt_err=$(mktemp 2>/dev/null) || _pgt_err=/dev/null
    # commits/{sha}/pulls returns every PR a commit is associated with. Filter
    # on state == "closed", not merged_at: a merge-queue merge can leave
    # merged_at null for a short window after the commit landed on origin/<trunk>
    # (the git log above already proves that). A closed PR whose exact SHA is on
    # trunk is de facto merged; PCOUNT >= 2 (rebase/cherry-pick history) is
    # never an auto-pass. Graphite merge-queue PRs are never associated at all
    # (empty result, permanently): _pgt_lookup=ok separates that empty-but-
    # successful result from a failed lookup, and only it reaches the
    # commit-subject path.
    if _pgt_pulls=$(pgp_gh_t 20 api "repos/$_pgt_owner/commits/$_pgt_fsha/pulls" \
      --jq '[.[] | select(.state == "closed") | {number, title, url: .html_url}]' 2>|"$_pgt_err"); then
      if _pgt_pcount=$(printf '%s' "$_pgt_pulls" | jq 'length' 2>/dev/null); then
        _pgt_lookup=ok
        _pgt_reason=ambiguous
      else
        # A garbled result is a failed lookup, never an empty one.
        _pgt_lookup=failed
        _pgt_pcount=0
        _pgt_pulls='[]'
        _pgt_reason=lookup-failed
        printf '[plan:complete] WARNING: gh api commits/pulls returned text that is not JSON\n' >&2
      fi
    else
      _pgt_rc=$?
      _pgt_lookup=failed
      _pgt_pulls='[]'
      if [ "$_pgt_rc" = 124 ]; then
        _pgt_reason=gh-timeout
      else
        case "$(pgp_gh_error_class "$_pgt_err")" in
          rate-limited) _pgt_reason=rate-limited ;;
          auth) _pgt_reason=auth ;;
          *) _pgt_reason=lookup-failed ;;
        esac
      fi
      printf '[plan:complete] WARNING: gh api commits/pulls lookup failed: %s\n' "$(tr -d '[:cntrl:]' < "$_pgt_err" | cut -c1-300)" >&2
    fi
    [ "$_pgt_err" = /dev/null ] || rm -f -- "$_pgt_err"
  fi
  printf '[plan:complete] Gate C provenance tier: %d closed PR(s) associated with the commit that last touched plans/%s (lookup: %s)\n' "$_pgt_pcount" "$_pgt_arg" "$_pgt_lookup"
  if [ "$_pgt_pcount" -ge 1 ]; then
    # Strip control characters from GitHub-controlled title/url fields: an
    # untrusted PR title could otherwise smuggle terminal escape sequences.
    printf '%s\n' '--- begin PR titles (reference only) ---'
    printf '%s\n' "$_pgt_pulls" | jq -r '.[] | "  #\(.number) — \(.title | gsub("[[:cntrl:]]"; ""))\n    \(.url | gsub("[[:cntrl:]]"; ""))"'
    printf '%s\n' '--- end PR titles ---'
  fi
  if [ "$_pgt_pcount" -eq 1 ]; then
    # Build the line first so a jq failure cannot leave an empty evidence file.
    _pgt_line=$(printf '%s\n' "$_pgt_pulls" | jq -r --arg sha "$_pgt_fsha" '.[0] | "pr=#\(.number) sha=\($sha)"' 2>/dev/null || :)
    if pgp_evidence_line_is_valid "$_pgt_line"; then
      printf '%s\n' "$_pgt_line" >| "$_pgt_prov"
    else
      _pgt_reason=lookup-failed
    fi
  fi
  # Commit-subject path: only after a SUCCESSFUL lookup that returned nothing.
  # A failed lookup and PCOUNT >= 2 never reach it.
  if [ "$_pgt_lookup" = ok ] && [ "$_pgt_pcount" -eq 0 ]; then
    if _pgt_res=$(pgp_provenance_via_subject "$_pgt_owner" "$_pgt_fsha" "plans/$_pgt_arg"); then
      # Re-validate before anything reaches the commit trailer.
      if pgp_evidence_line_is_valid "$_pgt_res"; then
        printf '%s\n' "$_pgt_res" >| "$_pgt_prov"
        printf '[plan:complete] Gate C provenance PASS (commit-subject): %s repo=%s\n' "$_pgt_res" "$_pgt_ownersafe"
      else
        printf '[plan:complete] Gate C commit-subject path: no evidence (the library returned a malformed evidence line) repo=%s\n' "$_pgt_ownersafe"
        _pgt_reason=lookup-failed
      fi
    else
      _pgt_reason=$(printf '%s\n' "$_pgt_res" | sed -n 1p | tr -cd 'a-z-')
      [ -n "$_pgt_reason" ] || _pgt_reason=lookup-failed
      printf '[plan:complete] Gate C commit-subject path: no evidence (%s) repo=%s\n' "$(printf '%s\n' "$_pgt_res" | sed -n 2p | tr -d '[:cntrl:]')" "$_pgt_ownersafe"
    fi
  fi
  # One fixed decision for the caller. PR titles above are untrusted text, so
  # never key anything on them.
  if [ -f "$_pgt_prov" ]; then
    _pgt_done PASS none
  else
    _pgt_done FALLTHROUGH "$_pgt_reason"
  fi
  return 0
}
