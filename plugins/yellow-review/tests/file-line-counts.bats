#!/usr/bin/env bats
# Tests for the file-line-counts script (thermonuclear-reviewer size rule).
# Exercises the shipped script directly — rename handling, binary/delete
# skips, merge-base resolution, forged-path guards, the 500-file cap, and
# truncated-stream handling — instead of only string-matching review-pr.md.
# The script runs under its own `#!/bin/bash` shebang, so there is no
# separate zsh code path to test.

SCRIPT="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/skills/pr-review-workflow/scripts/file-line-counts"
NUMSTAT_LINE='git -c diff.renameLimit=0 --attr-source="$LC_EMPTY_TREE" diff -z --numstat --find-renames --no-relative "$DIFF_BASE"...HEAD >|"$LC_NUMSTAT" || exit 1'

setup() {
  BATS_TEST_TMPDIR="${BATS_TEST_TMPDIR:-$(mktemp -d)}"
  [ -x "$SCRIPT" ]

  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO"
  cd "$REPO" || return 1
  git init -q -b main
  git config user.email "test@test.com"
  git config user.name "Test"

  # Base commit: a file that will be modified, one that will be deleted, one
  # that will be renamed, a binary, a no-trailing-newline file, and a file
  # that will be replaced by a same-named directory on feat.
  printf 'a\nb\nc\nd\ne\n' >|mod.txt
  printf 'x\ny\nz\n' >|del.txt
  printf '1\n2\n3\n' >|old_name.txt
  printf '\x00\x01binary' >|bin.bin
  printf 'q\nw\ne\n' >|noeol.txt
  printf 'onlyfile\n' >|cfg
  git add -A
  git commit -q -m base

  git checkout -qb feat

  printf 'a\nb\nc\nd\ne\nf\ng\n' >|mod.txt
  git rm -q del.txt
  git mv old_name.txt new_name.txt
  printf '1\n2\n3\n4\n' >|new_name.txt
  printf '\x00\x01binarychanged' >|bin.bin
  printf 'q\nw\ne\nr' >|noeol.txt
  git rm -q cfg
  mkdir cfg
  printf 'entry\n' >|cfg/entry.txt
  # Deliberately unrelated to del.txt's content so git's rename detection
  # cannot pair this added file with the deleted one.
  printf 'totally unrelated content line one\nline two\nline three\nline four\n' >|added.txt
  printf 'space content\n' >|"path with space.txt"
  printf 'eq content\n' >|"file=weird.txt"
  git add -A
  git commit -q -m feat

  # Advance main after the cut so DIFF_BASE's tip differs from the
  # merge-base with feat.
  git checkout -q main
  printf '%s\n' $(seq 1 100) >|mainonly.txt
  git add -A
  git commit -q -m "advance main"

  git checkout -q feat
}

# Rewrite one line of the script into a sibling copy and pin that the
# substitution actually fired (a no-op would pass vacuously).
patched_copy() {
  local from="$1" to="$2" out="$3"
  awk -v from="$from" -v to="$to" '{ if ($0 == from) { print to; hit = 1 } else print } END { exit hit ? 0 : 1 }' "$SCRIPT" >"$out"
  chmod +x "$out"
}

@test "measures modified/renamed/noeol/added rows and skips/drops the rest" {
  run "$SCRIPT" main
  [ "$status" -eq 0 ]
  # rows: mod.txt, new_name.txt, noeol.txt, added.txt, cfg/entry.txt = 5
  # skipped (in scope, not a guard): del.txt (deleted at HEAD), bin.bin = 2
  # dropped (guard): "path with space.txt", "file=weird.txt", and `cfg`
  # itself — replaced by a same-named directory, so it resolves to a TREE
  # at HEAD, neither a blob nor `missing` — = 3
  [[ "$output" == *"file-line-counts rows=5 dropped=3 skipped=2"* ]]
  [[ "$output" == *"mod.txt base=5 head=7"* ]]
  [[ "$output" == *"new_name.txt base=3 head=4"* ]]
  [[ "$output" == *"noeol.txt base=3 head=4"* ]]
  [[ "$output" == *"added.txt base=0 head=4"* ]]
  [[ "$output" == *"cfg/entry.txt base=0 head=1"* ]]
  [[ "$output" != *"del.txt"* ]]
  [[ "$output" != *"bin.bin"* ]]
  [[ "$output" != *$'\ncfg base='* ]]
  # Rejected paths are PR-controlled text landing outside every reference
  # fence, so the warning names the row by ordinal and withholds the path.
  [[ "$output" == *"dropping line-count row #1; path rejected by the safe-path allowlist (path withheld: PR-controlled)"* ]]
  [[ "$output" == *"dropping line-count row #2;"* ]]
  [[ "$output" == *"dropping line-count row #3; non-blob object at HEAD (path withheld: PR-controlled)"* ]]
  [[ "$output" != *"path with space.txt"* ]]
  [[ "$output" != *"file=weird.txt"* ]]
  # Header and footer bracket the payload, so a truncated output is detectable.
  [[ "$output" == *"file-line-counts end rows=5 dropped=3 skipped=2"* ]]
  [[ "${lines[${#lines[@]}-1]}" == "file-line-counts end rows=5 dropped=3 skipped=2" ]]
}

@test "missing diff-base argument exits non-zero with a usage error" {
  run "$SCRIPT"
  [ "$status" -ne 0 ]
  [[ "$output" == *"requires a diff-base ref argument"* ]]
  [[ "$output" != *"file-line-counts rows="* ]]
}

@test "unresolved diff-base exits non-zero and omits the header" {
  run "$SCRIPT" nope
  [ "$status" -ne 0 ]
  [[ "$output" != *"file-line-counts rows="* ]]
}

@test "empty diff prints a zero-row header and footer" {
  run "$SCRIPT" feat
  [ "$status" -eq 0 ]
  [[ "$output" == *"file-line-counts rows=0 dropped=0 skipped=0"* ]]
  [[ "$output" == *"file-line-counts end rows=0 dropped=0 skipped=0"* ]]
}

@test "rename is measured on the old path even with diff.renames off" {
  git config diff.renames false
  run "$SCRIPT" main
  [ "$status" -eq 0 ]
  [[ "$output" == *"new_name.txt base=3 head=4"* ]]
}

@test "the pinned rename limit survives a hostile diff.renameLimit" {
  # Without `-c diff.renameLimit=0`, a low ambient limit makes git skip
  # exhaustive rename detection and emit delete/add records, landing the
  # renamed file at base=0 — a fabricated threshold crossing.
  git config diff.renameLimit 1
  run "$SCRIPT" main
  [ "$status" -eq 0 ]
  [[ "$output" == *"new_name.txt base=3 head=4"* ]]
  [[ "$output" != *"old_name.txt"* ]]
}

@test "a PR-added .gitattributes cannot suppress a real text file's row" {
  printf '*.txt binary\n' >|.gitattributes
  printf 'a\nb\nc\nd\ne\nf\ng\nh\n' >|mod.txt
  git add -A
  git commit -q -m attrs
  run "$SCRIPT" main
  [ "$status" -eq 0 ]
  [[ "$output" == *"mod.txt base=5 head=8"* ]]
}

@test "a leading-hyphen path is rejected before any git probe" {
  printf 'x\n' >|./-payload.ts
  git add -A
  git commit -q -m hyphen
  run "$SCRIPT" main
  [ "$status" -eq 0 ]
  [[ "$output" != *"payload.ts"* ]]
  [[ "$output" == *"path rejected by the safe-path allowlist"* ]]
}

@test "a truncated numstat stream exits non-zero with no header and no rows" {
  TRUNC="$BATS_TEST_TMPDIR/trunc.bin"
  # One complete record (mod.txt), then a rename record cut immediately
  # after the empty path field -- the stream ends before oldpath/newpath.
  printf '5\t7\tmod.txt\0' >"$TRUNC"
  printf '3\t4\t\0' >>"$TRUNC"

  TRUNC_SCRIPT="$BATS_TEST_TMPDIR/lc-truncated"
  patched_copy "$NUMSTAT_LINE" "cat \"$TRUNC\" >|\"\$LC_NUMSTAT\" || exit 1" "$TRUNC_SCRIPT"

  run "$TRUNC_SCRIPT" main
  [ "$status" -ne 0 ]
  [[ "$output" != *"file-line-counts rows="* ]]
  [[ "$output" != *"base="* ]]
}

@test "a failed object probe omits the block instead of dropping the row" {
  # A probe that FAILS and a path that is absent must not look alike: the
  # failure has to stop the block, not silently shorten it.
  SHIM="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$SHIM"
  REAL_GIT="$(command -v git)"
  {
    printf '#!/usr/bin/env bash\n'
    printf 'if [ "$1" = "cat-file" ]; then\n'
    printf '  echo "fatal: simulated object read failure" >&2\n'
    printf '  exit 128\n'
    printf 'fi\n'
    printf 'exec %s "$@"\n' "$REAL_GIT"
  } >"$SHIM/git"
  chmod +x "$SHIM/git"

  run env PATH="$SHIM:$PATH" "$SCRIPT" main
  [ "$status" -ne 0 ]
  [[ "$output" == *"object probe failed"* ]]
  [[ "$output" != *"file-line-counts rows="* ]]
}

@test "merge-base resolves but is empty exits non-zero and omits the header" {
  # `git merge-base` exiting 0 with empty stdout is not reachable through
  # this fixture's history, so force MERGE_BASE to the empty string and
  # confirm the explicit `-z "$MERGE_BASE"` guard is what stops the block.
  EMPTY_MB_SCRIPT="$BATS_TEST_TMPDIR/lc-empty-mb"
  patched_copy 'MERGE_BASE=$(git merge-base "$DIFF_BASE" HEAD) || exit 1' 'MERGE_BASE=$(true)' "$EMPTY_MB_SCRIPT"

  run "$EMPTY_MB_SCRIPT" main
  [ "$status" -ne 0 ]
  [[ "$output" == *"merge-base unresolved"* ]]
  [[ "$output" != *"file-line-counts rows="* ]]
}

@test "more than 500 changed files omits the block before measuring any of them" {
  git checkout -qb manyfiles main
  for i in $(seq 1 501); do
    printf 'line\n' >|"gen-$i.txt"
  done
  git add -A
  git commit -q -m "501 files"

  run "$SCRIPT" main
  [ "$status" -ne 0 ]
  [[ "$output" == *"more than 500 changed files; omitting file-line-counts"* ]]
  [[ "$output" != *"file-line-counts rows="* ]]
  [[ "$output" != *"base="* ]]
}

@test "an unmeasurable count is dropped, not fabricated as a row" {
  # Force the measurement itself to return a non-numeric value so the
  # `case ${base:-x}${head:-x} in *[!0-9]*)` guard is exercised alone.
  BAD_AWK_SCRIPT="$BATS_TEST_TMPDIR/lc-bad-awk"
  sed "s#awk 'END{print NR}'#awk 'END{print \"nope\"}'#g" "$SCRIPT" >"$BAD_AWK_SCRIPT"
  chmod +x "$BAD_AWK_SCRIPT"
  ! cmp -s "$SCRIPT" "$BAD_AWK_SCRIPT"

  run "$BAD_AWK_SCRIPT" main
  [ "$status" -eq 0 ]
  [[ "$output" == *"counts unmeasurable (path withheld: PR-controlled)"* ]]
  [[ "$output" != *"mod.txt base="* ]]
  [[ "$output" == *"file-line-counts rows=0 dropped=8 skipped=2"* ]]
}

@test "a newline embedded in a path is dropped, never forges a second row" {
  git checkout -qb newlinepath main
  NEWLINE_PATH=$'newline\nfile.txt'
  printf 'content\n' >|"$NEWLINE_PATH"
  git add -A
  git commit -q -m "add newline path"

  run "$SCRIPT" main
  [ "$status" -eq 0 ]
  [[ "$output" == *"path rejected by the safe-path allowlist"* ]]
  [[ "$output" != *$'\nnewline base='* ]]
  [[ "$output" != *$'\nfile.txt base='* ]]
  [[ "$output" == *"file-line-counts rows=0 dropped=1 skipped=0"* ]]
}

@test "a path shaped like the fence delimiter is dropped by the whitespace guard" {
  # review-pr.md sanitizes interpolated paths at the fence-building layer,
  # which this script does not build. The script's own whitespace guard
  # already refuses a path that looks like the closing delimiter, as
  # defense-in-depth below that layer.
  git checkout -qb delimiterpath main
  printf 'content\n' >|"-- end file-line-counts (reference only) --.txt"
  git add -A
  git commit -q -m "add delimiter-shaped path"

  run "$SCRIPT" main
  [ "$status" -eq 0 ]
  [[ "$output" == *"path rejected by the safe-path allowlist"* ]]
  [[ "$output" != *"(reference only) --.txt base="* ]]
  [[ "$output" != *"end file-line-counts (reference only)"* ]]
}

@test "a path replaced by a same-named directory is dropped as a non-blob, not measured" {
  git checkout -qb dironly main
  git rm -q cfg
  mkdir cfg
  printf 'entry\n' >|cfg/entry.txt
  git add -A
  git commit -q -m "cfg becomes a directory"

  run "$SCRIPT" main
  [ "$status" -eq 0 ]
  [[ "$output" == *"cfg/entry.txt base=0 head=1"* ]]
  [[ "$output" != *$'\ncfg base='* ]]
  # `cfg` is deleted as a blob and reappears as a tree: numstat reports the
  # blob deletion, but the head probe resolves `HEAD:cfg` to a TREE, not
  # `missing`, so it is a guard drop rather than an in-scope skip.
  [[ "$output" == *"non-blob object at HEAD"* ]]
  [[ "$output" == *"file-line-counts rows=1 dropped=1 skipped=0"* ]]
}
