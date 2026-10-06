# Driver for plugins/yellow-core/lib/plan-gate-provenance.sh (sourced by
# /plan:complete). Runs under bash and zsh; output must be identical.
# Env: REPO_ROOT, TMPD. gh is a PATH stub in $TMPD/bin driven by PGP_SCENARIO.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_DATE='2026-01-01T00:00:00Z' GIT_COMMITTER_DATE='2026-01-01T00:00:00Z'
opts_before=$(set +o)
. "$REPO_ROOT/plugins/yellow-core/lib/plan-gate-provenance.sh"

# --- pure helpers ---
for subj in 'feat: x (#808)' 'x (#494) (#556)' 'x (#12) y' 'x (#0)' 'x (#012)' \
  'x (#12345678901)' 'x (#12a)' 'x (# 12)' 'x (#12)   ' 'Revert "x (#9)" (#10)' \
  'Merge pull request #333 from a/b' '' 'x $(id) (#7)'; do
  got=$(pgp_pr_from_subject "$subj") && rc=0 || rc=$?
  printf 'subject[%s]=%s rc=%s\n' "$subj" "$got" "$rc"
done
for sha in 0123456789abcdef0123456789abcdef01234567 0123 0123456789ABCDEF0123456789ABCDEF01234567 ''; do
  pgp_sha_is_full "$sha" && rc=0 || rc=$?
  printf 'sha_full[%s]=%s\n' "$sha" "$rc"
done
for msg in 'API rate limit exceeded (HTTP 403)' 'Bad credentials (HTTP 401)' 'gh: Not Found (HTTP 404)' 'HTTP 403: Resource not accessible' 'boom'; do
  printf '%s\n' "$msg" >| "$TMPD/err.txt"
  printf 'class[%s]=%s\n' "$msg" "$(pgp_gh_error_class "$TMPD/err.txt")"
done
# The shared PR-number rule must agree with the inline grep in complete.md.
for v in 1 9 10 1234567890 12345678901 0 01 007 '' 12a ' 1' '1 ' -1 +1 1e3; do
  printf '%s' "$v" | grep -qE '^[1-9][0-9]{0,9}$' && g=0 || g=$?
  pgp_pr_num_is_valid "$v" && p=0 || p=$?
  if [ "$g" -eq "$p" ]; then printf 'prnum[%s]=agree\n' "$v"; else printf 'prnum[%s]=DIVERGE grep=%s lib=%s\n' "$v" "$g" "$p"; fi
done

# --- git fixture: deterministic history ---
cd "$TMPD" && git init -q repo && cd repo || exit 1
mkdir plans src
printf 'demo plan\n' >| plans/demo.md
printf 'code\n' >| src/a.txt
git add plans/demo.md src/a.txt
git -c user.email=t@example.com -c user.name=t commit -q -m 'feat: deliver demo (#42)' || exit 1
SHA_OK=$(git rev-parse HEAD)
git -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m 'chore: no pull request number' || exit 1
SHA_NONUM=$(git rev-parse HEAD)
git -c user.email=t@example.com -c user.name=t commit -q --allow-empty -m 'Revert "feat: deliver demo (#42)" (#43)' || exit 1
SHA_REVERT=$(git rev-parse HEAD)
git rm -q plans/demo.md
git -c user.email=t@example.com -c user.name=t commit -q -m 'docs: archive demo (#42)' || exit 1
SHA_GONE=$(git rev-parse HEAD)
export PGP_BLOB=$(git rev-parse "${SHA_OK}:plans/demo.md")
export PGP_OBLOB=$(git rev-parse "${SHA_OK}:src/a.txt")

mkdir -p "$TMPD/bin"
cat >| "$TMPD/bin/gh" <<'GH_EOF'
#!/bin/sh
case "$*" in
  *"/pulls/42/files"*)
    case "$PGP_SCENARIO" in
      files-notfound) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
      badjson) echo 'not json'; exit 0 ;;
      hang) exec sleep 5 ;;
      plan-only) printf '[{"filename":"plans/demo.md","status":"added","sha":"%s"}]' "$PGP_BLOB" ;;
      blob-mismatch) printf '[{"filename":"plans/demo.md","status":"added","sha":"0000"},{"filename":"src/a.txt","status":"added","sha":"%s"}]' "$PGP_OBLOB" ;;
      other-mismatch) printf '[{"filename":"plans/demo.md","status":"added","sha":"%s"},{"filename":"src/a.txt","status":"added","sha":"0000"}]' "$PGP_BLOB" ;;
      null-sha) printf '[{"filename":"plans/demo.md","status":"added","sha":null},{"filename":"src/a.txt","status":"added","sha":"%s"}]' "$PGP_OBLOB" ;;
      removed) printf '[{"filename":"plans/demo.md","status":"removed","sha":"%s"},{"filename":"src/a.txt","status":"added","sha":"%s"}]' "$PGP_BLOB" "$PGP_OBLOB" ;;
      archive-rename) printf '[{"filename":"plans/complete/demo.md","status":"renamed","previous_filename":"plans/demo.md","sha":"%s"}]' "$PGP_BLOB" ;;
      newline-name) printf '[{"filename":"plans/demo.md\\n","status":"added","sha":"%s"},{"filename":"src/a.txt","status":"added","sha":"%s"}]' "$PGP_BLOB" "$PGP_OBLOB" ;;
      truncated) awk 'BEGIN { printf "["; for (i = 0; i < 3000; i++) { if (i) printf ","; printf "{\"filename\":\"src/f%d\",\"status\":\"added\",\"sha\":\"x\"}", i } printf "]" }' ;;
      paginated) printf '[{"filename":"src/a.txt","status":"added","sha":"%s"}][{"filename":"plans/demo.md","status":"renamed","sha":"%s"}]' "$PGP_OBLOB" "$PGP_BLOB" ;;
      *) printf '[{"filename":"plans/demo.md","status":"added","sha":"%s"},{"filename":"src/a.txt","status":"added","sha":"%s"}]' "$PGP_BLOB" "$PGP_OBLOB" ;;
    esac ;;
  *"/pulls/42"*)
    case "$PGP_SCENARIO" in
      open) printf 'open\tmain\n' ;;
      notfound) echo 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;
      ratelimit) echo 'gh: API rate limit exceeded (HTTP 403)' >&2; exit 1 ;;
      auth) echo 'gh: Bad credentials (HTTP 401)' >&2; exit 1 ;;
      stacked) printf 'closed\tfeat/parent\n' ;;
      *) printf 'closed\tmain\n' ;;
    esac ;;
  *) echo 'unexpected gh call' >&2; exit 2 ;;
esac
GH_EOF
chmod +x "$TMPD/bin/gh"
PATH="$TMPD/bin:$PATH"

mask() { sed -e "s/$SHA_OK/<ok>/g" -e "s/$SHA_NONUM/<nonum>/g" -e "s/$SHA_REVERT/<revert>/g" -e "s/$SHA_GONE/<gone>/g"; }

run_scenario() { # $1 = scenario name understood by the gh stub
  export PGP_SCENARIO="$1" PGP_GH_TIMEOUT=30 PGP_GH_FILES_TIMEOUT=30
  [ "$1" = hang ] && export PGP_GH_TIMEOUT=1 PGP_GH_FILES_TIMEOUT=1
  out=$(pgp_provenance_via_subject o/r "$SHA_OK" plans/demo.md) && rc=0 || rc=$?
  printf 'scenario[%s] rc=%s %s\n' "$1" "$rc" "$(printf '%s' "$out" | tr '\n' '|' | mask)"
}
# Literal word lists only: zsh does not split an unquoted variable in `for`.
for sc in ok stacked paginated open notfound ratelimit auth files-notfound badjson \
  plan-only blob-mismatch other-mismatch null-sha removed archive-rename newline-name truncated; do
  run_scenario "$sc"
done
# hang needs a real timeout(1)/gtimeout to be cut off; skip it elsewhere.
if command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1; then
  run_scenario hang
fi
export PGP_SCENARIO=ok PGP_GH_TIMEOUT=30 PGP_GH_FILES_TIMEOUT=30
for pair in "nonum:$SHA_NONUM" "revert:$SHA_REVERT" "gone:$SHA_GONE" "short:abc123"; do
  label=${pair%%:*}
  sha=${pair#*:}
  out=$(pgp_provenance_via_subject o/r "$sha" plans/demo.md) && rc=0 || rc=$?
  printf 'commit[%s] rc=%s %s\n' "$label" "$rc" "$(printf '%s' "$out" | tr '\n' '|' | mask)"
done
git branch at-ok "$SHA_OK"
git clone -q --depth 1 --branch at-ok "file://$TMPD/repo" "$TMPD/shallow" 2>/dev/null || exit 1
(
  cd "$TMPD/shallow" || exit 1
  out=$(pgp_provenance_via_subject o/r "$SHA_OK" plans/demo.md) && rc=0 || rc=$?
  printf 'shallow[ok] rc=%s %s\n' "$rc" "$(printf '%s' "$out" | tr '\n' '|' | mask)"
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
