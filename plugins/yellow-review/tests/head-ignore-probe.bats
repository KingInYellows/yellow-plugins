#!/usr/bin/env bats
# Tests for head-ignore-probe (/review:sweep Step 1b): the PR head's root
# .gitignore, read through a stubbed `gh api`, judged against the local git dir.

bats_require_minimum_version 1.5.0

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/head-ignore-probe"

setup() {
  export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid
  export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
  REPO="$BATS_TEST_TMPDIR/repo"
  HEADREPO="$BATS_TEST_TMPDIR/head"
  FIX="$BATS_TEST_TMPDIR/fix"
  mkdir -p "$REPO" "$HEADREPO" "$FIX/blobs" "$BATS_TEST_TMPDIR/bin"
  git -C "$REPO" init -q -b main
  git -C "$REPO" commit -q --allow-empty -m init
  git -C "$HEADREPO" init -q -b main
  # The stub serves the PR head from $FIX: tree.json (the root listing) and
  # blobs/<sha>. FAKE_FAIL=<kind>:<message> fails that kind of call (pr, tree,
  # blob) with the message on stderr.
  cat >"$BATS_TEST_TMPDIR/bin/gh" <<'STUB'
#!/bin/bash
kind=""
case "$1 $2" in
  "pr view") kind=pr ;;
  api*) case "$*" in *git/trees/*) kind=tree ;; *git/blobs/*) kind=blob ;; esac ;;
esac
if [ -n "${FAKE_FAIL:-}" ] && [ "${FAKE_FAIL%%:*}" = "$kind" ]; then
  [ "${FAKE_FAIL#*:}" != sleep ] || sleep 30
  printf '%s\n' "${FAKE_FAIL#*:}" >&2
  exit 1
fi
case $kind in
  pr) cat "$FIX/oid" ;;
  tree) cat "$FIX/tree.json" ;;
  blob) last=${*: -1}; cat "$FIX/blobs/${last##*/}" ;;
  *) exit 2 ;;
esac
STUB
  chmod +x "$BATS_TEST_TMPDIR/bin/gh"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH" FIX
  unset FAKE_FAIL
  cd "$REPO"
}

# head_commit [path=content]...: commit the files into the head repository and
# write the stub's answers for that commit.
head_commit() {
  local kv
  for kv in "$@"; do
    printf '%b' "${kv#*=}" >|"$HEADREPO/${kv%%=*}"
  done
  git -C "$HEADREPO" add -A
  git -C "$HEADREPO" commit -q --allow-empty -m head
  git -C "$HEADREPO" rev-parse HEAD >|"$FIX/oid"
  write_tree
}

# write_tree: the root listing as the API returns it, and every blob raw.
write_tree() {
  local mode type sha path
  : >|"$FIX/entries"
  while IFS=$'\t' read -r meta path; do
    read -r mode type sha <<<"$meta"
    jq -nc --arg m "$mode" --arg t "$type" --arg s "$sha" --arg p "$path" \
      '{path: $p, mode: $m, type: $t, sha: $s}' >>"$FIX/entries"
    [ "$type" != blob ] || git -C "$HEADREPO" cat-file blob "$sha" >|"$FIX/blobs/$sha"
  done < <(git -C "$HEADREPO" -c core.quotePath=false ls-tree HEAD)
  jq -s '{sha: "x", tree: ., truncated: false}' "$FIX/entries" >|"$FIX/tree.json"
}

probe() { run --separate-stderr "$SCRIPT" 7; }

@test "a head that tracks the file is head=tracked" {
  head_commit 'yellow-plugins.local.md=x\n'
  probe
  [ "$status" -eq 0 ]
  [ "$output" = head=tracked ]
}

@test "a head whose root .gitignore names the file is head=ignored" {
  head_commit '.gitignore=yellow-plugins.local.md\n'
  probe
  [ "$status" -eq 0 ]
  [ "$output" = head=ignored ]
}

@test "a head with no .gitignore is head=unignored" {
  head_commit 'a.txt=a\n'
  probe
  [ "$status" -eq 0 ]
  [ "$output" = head=unignored ]
}

@test "a root negation that re-includes the file is head=unignored" {
  head_commit '.gitignore=*.md\n!yellow-plugins.local.md\n'
  probe
  [ "$status" -eq 0 ]
  [ "$output" = head=unignored ]
}

@test "the local info/exclude still applies" {
  head_commit 'a.txt=a\n'
  printf 'yellow-plugins.local.md\n' >>"$REPO/.git/info/exclude"
  probe
  [ "$status" -eq 0 ]
  [ "$output" = head=ignored ]
}

@test "this branch tracking the file does not hide the head's ignore rule" {
  printf 'x\n' >|yellow-plugins.local.md
  git add yellow-plugins.local.md
  git commit -q -m tracked
  head_commit '.gitignore=yellow-plugins.local.md\n'
  probe
  [ "$status" -eq 0 ]
  [ "$output" = head=ignored ]
}

@test "this branch's .gitignore does not answer for the head" {
  printf 'yellow-plugins.local.md\n' >|.gitignore
  head_commit 'a.txt=a\n'
  probe
  [ "$status" -eq 0 ]
  [ "$output" = head=unignored ]
}

@test "a symlinked .gitignore on the head is refused as PR-specific" {
  head_commit 'a.txt=a\n'
  sha=$(jq -r '.tree[0].sha' "$FIX/tree.json")
  jq --arg s "$sha" '.tree += [{path: ".gitignore", mode: "120000", type: "blob", sha: $s}]' "$FIX/tree.json" >|"$FIX/t" && mv "$FIX/t" "$FIX/tree.json"
  probe
  [ "$status" -eq 4 ]
  [ "$output" = error=symlink ]
}

@test "a root entry that differs from .gitignore only in case is refused" {
  head_commit '.GITIGNORE=x\n'
  probe
  [ "$status" -eq 4 ]
  [ "$output" = error=case-alias ]
  [[ "$stderr" == *'only in case'* ]]
}

@test "a non-ASCII root entry name is refused as a possible case alias" {
  head_commit "yellow-plugin$(printf '\305\277').local.md=x\n"
  probe
  [ "$status" -eq 4 ]
  [ "$output" = error=case-alias ]
  [[ "$stderr" == *'non-ASCII root entry name'* ]]
}

@test "a content-transforming attribute on .gitignore is refused" {
  head_commit '.gitignore=yellow-plugins.local.md\n' '.gitattributes=.gitignore filter=evil\n'
  probe
  [ "$status" -eq 4 ]
  [ "$output" = error=attributes ]
}

@test "eol=lf on .gitignore is allowed" {
  head_commit '.gitignore=yellow-plugins.local.md\n' '.gitattributes=.gitignore eol=lf\n'
  probe
  [ "$status" -eq 0 ]
  [ "$output" = head=ignored ]
}

@test "a literal filter=unspecified passes only while no filter.unspecified driver is configured" {
  head_commit '.gitignore=yellow-plugins.local.md\n' '.gitattributes=.gitignore filter=unspecified\n'
  probe
  [ "$status" -eq 0 ]
  [ "$output" = head=ignored ]
  git -C "$REPO" config filter.unspecified.clean cat
  probe
  [ "$status" -eq 4 ]
  [ "$output" = error=attributes ]
}

@test "this clone's info/attributes counts toward the .gitignore attribute check" {
  head_commit '.gitignore=yellow-plugins.local.md\n'
  mkdir -p "$REPO/.git/info"
  printf '.gitignore ident\n' >>"$REPO/.git/info/attributes"
  probe
  [ "$status" -eq 4 ]
  [ "$output" = error=attributes ]
}

@test "a rate limit is systemic even when it comes as an HTTP 403" {
  head_commit 'a.txt=a\n'
  FAKE_FAIL='tree:gh: API rate limit exceeded (HTTP 403)' probe
  [ "$status" -eq 3 ]
  [ "$output" = error=rate-limited ]
  [[ "$stderr" == *'API rate limit exceeded'* ]]
}

@test "a 404 is PR-specific" {
  head_commit 'a.txt=a\n'
  FAKE_FAIL='tree:gh: Not Found (HTTP 404)' probe
  [ "$status" -eq 4 ]
  [ "$output" = error=not-found ]
}

@test "a PR that does not exist is PR-specific" {
  FAKE_FAIL='pr:GraphQL: Could not resolve to a PullRequest with the number of 7.' probe
  [ "$status" -eq 4 ]
  [ "$output" = error=not-found ]
}

@test "a 403 that is not a rate limit is PR-specific" {
  head_commit '.gitignore=x\n'
  FAKE_FAIL='blob:gh: Resource not accessible by integration (HTTP 403)' probe
  [ "$status" -eq 4 ]
  [ "$output" = error=forbidden ]
}

@test "an unclassified gh failure is systemic" {
  head_commit 'a.txt=a\n'
  FAKE_FAIL='tree:error connecting to api.github.com' probe
  [ "$status" -eq 3 ]
  [ "$output" = error=network ]
}

@test "a gh call that outlives the timeout is systemic" {
  command -v timeout >/dev/null 2>&1 || command -v gtimeout >/dev/null 2>&1 || skip "no timeout binary"
  head_commit 'a.txt=a\n'
  YELLOW_REVIEW_GH_TIMEOUT=1 FAKE_FAIL='tree:sleep' probe
  [ "$status" -eq 3 ]
  [ "$output" = error=network ]
}

@test "a truncated root listing is refused" {
  head_commit 'a.txt=a\n'
  jq '.truncated = true' "$FIX/tree.json" >|"$FIX/t" && mv "$FIX/t" "$FIX/tree.json"
  probe
  [ "$status" -eq 4 ]
  [ "$output" = error=unreadable ]
}

@test "a malformed head commit id is refused" {
  printf 'not-a-sha\n' >|"$FIX/oid"
  probe
  [ "$status" -eq 4 ]
  [ "$output" = error=unreadable ]
}

@test "a PR number that is not a positive integer is a usage error" {
  run --separate-stderr "$SCRIPT" 07
  [ "$status" -eq 2 ]
  run --separate-stderr "$SCRIPT"
  [ "$status" -eq 2 ]
}
