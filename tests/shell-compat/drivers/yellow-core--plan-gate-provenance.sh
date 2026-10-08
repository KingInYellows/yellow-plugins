# Driver for plugins/yellow-core/lib/plan-gate-provenance.sh (sourced by
# /plan:complete). Runs under bash and zsh; output must be identical.
# Env: REPO_ROOT, TMPD. gh and timeout are PATH stubs in $TMPD/bin driven by
# PGP_SCENARIO.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_DATE='2026-01-01T00:00:00Z' GIT_COMMITTER_DATE='2026-01-01T00:00:00Z'
opts_before=$(set +o)
. "$REPO_ROOT/plugins/yellow-core/lib/plan-gate-provenance.sh"

# --- pure helpers ---
for subj in 'feat: x (#808)' 'x (#494) (#556)' 'x (#12) y' 'x (#0)' 'x (#012)' \
  'x (#12345678901)' 'x (#12a)' 'x (# 12)' 'x (#12)   ' 'Revert "x (#9)" (#10)' \
  'Reapply "x (#9)" (#10)' 'Merge branch main into x (#11)' 'Merge pull request #333 from a/b' \
  'Merge the queue (#14)' "$(printf 'x\ty (#7)')" '' 'x $(id) (#7)'; do
  got=$(pgp_pr_from_subject "$subj") && rc=0 || rc=$?
  printf 'subject[%s]=%s rc=%s\n' "$subj" "$got" "$rc"
done
for sha in 0123456789abcdef0123456789abcdef01234567 0123 0123456789ABCDEF0123456789ABCDEF01234567 ''; do
  pgp_sha_is_full "$sha" && rc=0 || rc=$?
  printf 'sha_full[%s]=%s\n' "$sha" "$rc"
done
H40=0123456789abcdef0123456789abcdef01234567
for line in "pr=#1 sha=$H40" "pr=#12 sha=$H40 via=commit-subject" "pr=#0 sha=$H40" "pr=#12 sha=0123" \
  "pr=#12 sha=$H40 via=other" "pr=#12 sha=$H40 via=commit-subject x" "pr=#12 sha=$H40
pr=#13 sha=$H40" ''; do
  pgp_evidence_line_is_valid "$line" && rc=0 || rc=$?
  printf 'evidence[%s]=%s\n' "$(printf '%s' "$line" | tr '\n' '|')" "$rc"
done
for tok in gh-timeout rate-limited pr-open auth not-found no-tie ''; do
  pgp_reason_is_retryable "$tok" && rc=0 || rc=$?
  printf 'retryable[%s]=%s\n' "$tok" "$rc"
done
for msg in 'API rate limit exceeded (HTTP 403)' 'Bad credentials (HTTP 401)' 'gh: Not Found (HTTP 404)' 'HTTP 403: Resource not accessible' 'boom'; do
  printf '%s\n' "$msg" >| "$TMPD/err.txt"
  printf 'class[%s]=%s\n' "$msg" "$(pgp_gh_error_class "$TMPD/err.txt")"
done
# The override validator in complete.md calls pgp_pr_num_is_valid; the old
# inline grep is the reference the table must still agree with.
for v in 1 9 10 1234567890 12345678901 0 01 007 '' 12a ' 1' '1 ' -1 +1 1e3; do
  printf '%s' "$v" | grep -qE '^[1-9][0-9]{0,9}$' && g=0 || g=$?
  pgp_pr_num_is_valid "$v" && p=0 || p=$?
  if [ "$g" -eq "$p" ]; then printf 'prnum[%s]=agree\n' "$v"; else printf 'prnum[%s]=DIVERGE grep=%s lib=%s\n' "$v" "$g" "$p"; fi
done
# Without timeout(1) or gtimeout the call still runs, with exactly one notice.
mkdir -p "$TMPD/empty"
nt_fn() { printf 'ran\n'; }
nt_out=$( PATH="$TMPD/empty" pgp_t 5 nt_fn 2>"$TMPD/notice.txt"; PATH="$TMPD/empty" pgp_t 5 nt_fn 2>>"$TMPD/notice.txt" | tr '\n' '|')
printf 'notimeout[out=%s notices=%s]\n' "$(printf '%s' "$nt_out" | tr '\n' '|')" "$(grep -c 'neither timeout nor gtimeout' "$TMPD/notice.txt" | tr -d ' ')"

# --- git fixture: deterministic history ---
cd "$TMPD" && git init -q repo && cd repo || exit 1
mkdir plans src
printf 'demo plan\n' >| plans/demo.md
printf 'code\n' >| src/a.txt
printf 'kept\n' >| src/keep.txt
git add plans/demo.md src/a.txt src/keep.txt
git -c user.email=t@example.com -c user.name=t commit -q -m 'feat: deliver demo (#42)' || exit 1
SHA_OK=$(git rev-parse HEAD)
git -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m 'chore: no pull request number' || exit 1
SHA_NONUM=$(git rev-parse HEAD)
git -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m 'Revert "feat: deliver demo (#42)" (#43)' || exit 1
SHA_REVERT=$(git rev-parse HEAD)
# A commit that changes only the plan: a non-plan file unchanged on trunk must
# not tie a PR to this commit.
printf 'demo plan v2\n' >| plans/demo.md
git add plans/demo.md
git -c user.email=t@example.com -c user.name=t commit -q -m 'docs: tweak demo plan (#42)' || exit 1
SHA_TWEAK=$(git rev-parse HEAD)
TWEAK_BLOB=$(git rev-parse "${SHA_TWEAK}:plans/demo.md")
git rm -q plans/demo.md
git -c user.email=t@example.com -c user.name=t commit -q -m 'docs: archive demo (#42)' || exit 1
SHA_GONE=$(git rev-parse HEAD)
# A non-root commit that adds a plan and modifies an existing non-plan file:
# the parent-blob-differs path.
mkdir -p plans
printf 'second plan\n' >| plans/second.md
printf 'code v2\n' >| src/a.txt
git add plans/second.md src/a.txt
git -c user.email=t@example.com -c user.name=t commit -q -m 'feat: second thing (#42)' || exit 1
SHA_NR=$(git rev-parse HEAD)
OK_BLOB=$(git rev-parse "${SHA_OK}:plans/demo.md")
export PGP_BLOB="$OK_BLOB"
export PGP_OBLOB=$(git rev-parse "${SHA_OK}:src/a.txt")
export PGP_KBLOB=$(git rev-parse "${SHA_OK}:src/keep.txt")
export PGP_BLOB2=$(git rev-parse "${SHA_NR}:plans/second.md")
export PGP_OBLOB2=$(git rev-parse "${SHA_NR}:src/a.txt")

mkdir -p "$TMPD/bin"
# gh stub: files calls must use --paginate and per_page=100, and --jq is applied
# with the real jq, to a full-shaped body (patch, extra fields), page by page.
cat >| "$TMPD/bin/gh" <<'GH_EOF'
#!/bin/sh
jqf=''; pag=0; prev=''
for a in "$@"; do
  [ "$prev" = --jq ] && jqf=$a
  [ "$a" = --paginate ] && pag=1
  prev=$a
done
apply() { if [ -n "$jqf" ]; then jq -r "$jqf"; else cat; fi; }
fileobj() { # filename status sha
  jq -nc --arg f "$1" --arg s "$2" --arg h "$3" '{filename: $f, status: $s, sha: $h, additions: 1, deletions: 0, changes: 1, patch: "@@ -0,0 +1 @@\n+x", contents_url: "u", raw_url: "u"}'
}
case "$*" in
  *"/pulls/42/files"*)
    case "$*" in *"per_page=100"*) ;; *) echo 'stub: files call needs per_page=100' >&2; exit 2 ;; esac
    [ "$pag" = 1 ] || { echo 'stub: files call needs --paginate' >&2; exit 2; }
    case "$PGP_SCENARIO" in
      files-notfound) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
      badjson) echo 'not json'; exit 0 ;;
      plan-only) jq -nc --arg h "$PGP_BLOB" '[{filename:"plans/demo.md",status:"added",sha:$h}]' | apply ;;
      blob-mismatch) printf '[%s,%s]' "$(fileobj plans/demo.md added 0000)" "$(fileobj src/a.txt added "$PGP_OBLOB")" | apply ;;
      other-mismatch) printf '[%s,%s]' "$(fileobj plans/demo.md added "$PGP_BLOB")" "$(fileobj src/a.txt added 0000)" | apply ;;
      null-sha) printf '[{"filename":"plans/demo.md","status":"added","sha":null},%s]' "$(fileobj src/a.txt added "$PGP_OBLOB")" | apply ;;
      removed) printf '[%s,%s]' "$(fileobj plans/demo.md removed "$PGP_BLOB")" "$(fileobj src/a.txt added "$PGP_OBLOB")" | apply ;;
      archive-rename) printf '[%s]' "$(fileobj plans/complete/demo.md renamed "$PGP_BLOB")" | apply ;;
      newline-name) printf '[%s,%s]' "$(fileobj 'plans/demo.md
' added "$PGP_BLOB")" "$(fileobj src/a.txt added "$PGP_OBLOB")" | apply ;;
      truncated) jq -nc '[range(0;3000) | {filename: "src/f\(.)", status: "added", sha: "x"}]' | apply ;;
      paginated) printf '[%s]\n[%s]\n' "$(fileobj src/a.txt added "$PGP_OBLOB")" "$(fileobj plans/demo.md renamed "$PGP_BLOB")" | while IFS= read -r page; do printf '%s' "$page" | apply; done ;;
      cap21) jq -nc --arg pb "$PGP_BLOB" --arg ob "$PGP_OBLOB" '[{filename:"plans/demo.md",status:"added",sha:$pb}] + [range(0;20) | {filename:"src/n\(.)",status:"added",sha:"x"}] + [{filename:"src/a.txt",status:"added",sha:$ob}]' | apply ;;
      cap20) jq -nc --arg pb "$PGP_BLOB" --arg ob "$PGP_OBLOB" '[{filename:"plans/demo.md",status:"added",sha:$pb}] + [range(0;19) | {filename:"src/n\(.)",status:"added",sha:"x"}] + [{filename:"src/a.txt",status:"added",sha:$ob}]' | apply ;;
      nonroot) printf '[%s,%s]' "$(fileobj plans/second.md added "$PGP_BLOB2")" "$(fileobj src/a.txt modified "$PGP_OBLOB2")" | apply ;;
      nonroot-keep) printf '[%s,%s]' "$(fileobj plans/second.md added "$PGP_BLOB2")" "$(fileobj src/keep.txt modified "$PGP_KBLOB")" | apply ;;
      *) printf '[%s,%s]' "$(fileobj plans/demo.md added "$PGP_BLOB")" "$(fileobj src/a.txt added "$PGP_OBLOB")" | apply ;;
    esac ;;
  *"/pulls/42"*)
    body() { jq -nc --arg s "$1" --arg b "$2" '{number: 42, state: $s, title: "t", merged: false, base: {ref: $b}, html_url: "u"}'; }
    case "$PGP_SCENARIO" in
      open) body open main | apply ;;
      notfound) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
      ratelimit) echo 'gh: API rate limit exceeded (HTTP 403)' >&2; exit 1 ;;
      auth) echo 'gh: Bad credentials (HTTP 401)' >&2; exit 1 ;;
      stacked) body closed feat/parent | apply ;;
      *) body closed main | apply ;;
    esac ;;
  *) echo 'unexpected gh call' >&2; exit 2 ;;
esac
GH_EOF
chmod +x "$TMPD/bin/gh"
# timeout stub: the hang scenario times out at once; every other call just runs.
cat >| "$TMPD/bin/timeout" <<'TO_EOF'
#!/bin/sh
[ "${PGP_SCENARIO:-}" = hang ] && exit 124
shift
exec "$@"
TO_EOF
chmod +x "$TMPD/bin/timeout"
PATH="$TMPD/bin:$PATH"

mask() { sed -e "s/$SHA_OK/<ok>/g" -e "s/$SHA_NONUM/<nonum>/g" -e "s/$SHA_REVERT/<revert>/g" -e "s/$SHA_GONE/<gone>/g" -e "s/$SHA_TWEAK/<tweak>/g" -e "s/$SHA_NR/<nr>/g"; }

run_scenario() { # $1 = scenario name understood by the gh stub
  export PGP_SCENARIO="$1"
  out=$(pgp_provenance_via_subject o/r "$SHA_OK" plans/demo.md) && rc=0 || rc=$?
  printf 'scenario[%s] rc=%s %s\n' "$1" "$rc" "$(printf '%s' "$out" | tr '\n' '|' | mask)"
}
# Literal word lists only: zsh does not split an unquoted variable in `for`.
for sc in ok stacked paginated open notfound ratelimit auth files-notfound badjson \
  plan-only blob-mismatch other-mismatch null-sha removed archive-rename newline-name truncated \
  cap21 cap20 hang; do
  run_scenario "$sc"
done
# The same library under the caller's set -euo pipefail, on success and failure.
for sc in ok stacked paginated open ratelimit hang; do
  (
    set -euo pipefail
    export PGP_SCENARIO="$sc"
    if eo=$(pgp_provenance_via_subject o/r "$SHA_OK" plans/demo.md); then k=pass; else k=fail; fi
    printf 'errexit[%s] %s %s\n' "$sc" "$k" "$(printf '%s' "$eo" | tr '\n' '|' | mask)"
  )
done
export PGP_SCENARIO=ok
for pair in "nonum:$SHA_NONUM" "revert:$SHA_REVERT" "gone:$SHA_GONE" "short:abc123"; do
  label=${pair%%:*}
  sha=${pair#*:}
  out=$(pgp_provenance_via_subject o/r "$sha" plans/demo.md) && rc=0 || rc=$?
  printf 'commit[%s] rc=%s %s\n' "$label" "$rc" "$(printf '%s' "$out" | tr '\n' '|' | mask)"
done
export PGP_BLOB="$TWEAK_BLOB"
out=$(pgp_provenance_via_subject o/r "$SHA_TWEAK" plans/demo.md) && rc=0 || rc=$?
printf 'commit[tweak] rc=%s %s\n' "$rc" "$(printf '%s' "$out" | tr '\n' '|' | mask)"
export PGP_BLOB="$OK_BLOB"
# Non-root commit: the parent's blob differs, so the PR ties to the commit; an
# unchanged non-plan file does not.
for sc in nonroot nonroot-keep; do
  export PGP_SCENARIO="$sc"
  out=$(pgp_provenance_via_subject o/r "$SHA_NR" plans/second.md) && rc=0 || rc=$?
  printf 'nonroot[%s] rc=%s %s\n' "$sc" "$rc" "$(printf '%s' "$out" | tr '\n' '|' | mask)"
done
export PGP_SCENARIO=ok
git branch at-ok "$SHA_OK"
git branch at-nr "$SHA_NR"
git clone -q --depth 1 --branch at-ok "file://$TMPD/repo" "$TMPD/shallow" 2>/dev/null || exit 1
(
  cd "$TMPD/shallow" || exit 1
  out=$(pgp_provenance_via_subject o/r "$SHA_OK" plans/demo.md) && rc=0 || rc=$?
  printf 'shallow[ok] rc=%s %s\n' "$rc" "$(printf '%s' "$out" | tr '\n' '|' | mask)"
)
# A shallow clone whose tip has a parent it cannot read: never a pass.
git clone -q --depth 1 --branch at-nr "file://$TMPD/repo" "$TMPD/shallow-nr" 2>/dev/null || exit 1
(
  cd "$TMPD/shallow-nr" || exit 1
  export PGP_SCENARIO=nonroot
  out=$(pgp_provenance_via_subject o/r "$SHA_NR" plans/second.md) && rc=0 || rc=$?
  printf 'shallow[nonroot] rc=%s %s\n' "$rc" "$(printf '%s' "$out" | tr '\n' '|' | mask)"
)
for bad in 'o r' 'norepo' '' '../..' './r' 'o/..' 'o/r/x' '/r' 'o/'; do
  out=$(pgp_provenance_via_subject "$bad" "$SHA_OK" plans/demo.md) && rc=0 || rc=$?
  printf 'repo[%s] rc=%s %s\n' "$bad" "$rc" "$(printf '%s' "$out" | tr '\n' '|')"
done
for bad in 'src/a.txt' 'plans/../x.md' 'plans/x.txt'; do
  out=$(pgp_provenance_via_subject o/r "$SHA_OK" "$bad") && rc=0 || rc=$?
  printf 'plan[%s] rc=%s %s\n' "$bad" "$rc" "$(printf '%s' "$out" | tr '\n' '|')"
done

# Under errexit/nounset a NO-EVIDENCE return must still remove the temp dir.
leak_dir="$TMPD/leak"
mkdir -p "$leak_dir"
( set -eu; export TMPDIR="$leak_dir"; pgp_provenance_via_subject o/r "$SHA_NONUM" plans/demo.md >/dev/null ) || true
printf 'leaked_tmp=%s\n' "$(ls -A "$leak_dir" | wc -l | tr -d ' ')"
# Sourcing and calling the lib must not change the caller's shell options.
if [ "$(set +o)" = "$opts_before" ]; then echo opts_unchanged; else echo opts_changed; fi
