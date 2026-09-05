#!/usr/bin/env bats
# Executes the file-line-counts shell block embedded in review-pr.md (Step 5
# item 6) against real git fixtures, instead of only string-matching the
# markdown. A parse regression in the embedded script (rename handling,
# binary/delete skips, merge-base resolution, forged-path guards, truncated
# stream handling) would otherwise pass CI silently.

COMMAND_FILE="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/commands/review/review-pr.md"

setup() {
  BATS_TEST_TMPDIR="${BATS_TEST_TMPDIR:-$(mktemp -d)}"
  LC="$BATS_TEST_TMPDIR/lc.sh"

  # Extract the fenced ```bash block whose first line is the
  # `# `git diff A...HEAD`` comment, stripping the markdown list's 3-space
  # indent. Do not edit the block itself; this only reproduces it.
  awk '
  {
    if (capturing) {
      if ($0 ~ /^   ```$/) { capturing = 0; exit }
      line = $0
      sub(/^   /, "", line)
      print line
      prev = $0
      next
    }
    if (prev ~ /^   ```bash$/ && $0 ~ /^   # `git diff A\.\.\.HEAD`/) {
      capturing = 1
      line = $0
      sub(/^   /, "", line)
      print line
    }
    prev = $0
  }
  ' "$COMMAND_FILE" >"$LC"

  [ -s "$LC" ]

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

@test "bash: measures modified/renamed/noeol/added rows and drops the rest" {
  run env DIFF_BASE=main bash "$LC"
  [ "$status" -eq 0 ]
  [[ "$output" == *"file-line-counts rows=5 dropped=2"* ]]
  [[ "$output" == *"mod.txt base=5 head=7"* ]]
  [[ "$output" == *"new_name.txt base=3 head=4"* ]]
  [[ "$output" == *"noeol.txt base=3 head=4"* ]]
  [[ "$output" == *"added.txt base=0 head=4"* ]]
  [[ "$output" == *"cfg/entry.txt base=0 head=1"* ]]
  [[ "$output" != *"del.txt"* ]]
  [[ "$output" != *"bin.bin"* ]]
  [[ "$output" != *$'\ncfg base='* ]]
  [[ "$output" == *"Warning: skipping line-count row for path with space.txt"* ]]
  [[ "$output" == *"Warning: skipping line-count row for file=weird.txt"* ]]
}

@test "zsh: same measurement as bash" {
  if ! command -v zsh >/dev/null 2>&1; then
    skip "zsh not available"
  fi
  run env DIFF_BASE=main zsh "$LC"
  [ "$status" -eq 0 ]
  [[ "$output" == *"file-line-counts rows=5 dropped=2"* ]]
  [[ "$output" == *"mod.txt base=5 head=7"* ]]
  [[ "$output" == *"new_name.txt base=3 head=4"* ]]
  [[ "$output" == *"noeol.txt base=3 head=4"* ]]
}

@test "unresolved DIFF_BASE exits non-zero and omits the header" {
  run env DIFF_BASE=nope bash "$LC"
  [ "$status" -ne 0 ]
  [[ "$output" != *"file-line-counts rows="* ]]
}

@test "empty diff prints a zero-row header" {
  run env DIFF_BASE=feat bash "$LC"
  [ "$status" -eq 0 ]
  [[ "$output" == *"file-line-counts rows=0 dropped=0"* ]]
}

@test "rename is measured on the old path even with diff.renames off" {
  git config diff.renames false
  run env DIFF_BASE=main bash "$LC"
  [ "$status" -eq 0 ]
  [[ "$output" == *"new_name.txt base=3 head=4"* ]]
}

@test "a truncated numstat stream exits non-zero with no header and no rows" {
  TRUNC="$BATS_TEST_TMPDIR/trunc.bin"
  # One complete record (mod.txt), then a rename record cut immediately
  # after the empty path field -- the stream ends before oldpath/newpath.
  printf '5\t7\tmod.txt\0' >"$TRUNC"
  printf '3\t4\t\0' >>"$TRUNC"

  TRUNC_LC="$BATS_TEST_TMPDIR/lc-truncated.sh"
  sed "s#^git diff -z --numstat --find-renames \"\$DIFF_BASE\"\\.\\.\\.HEAD >|\"\$LC_NUMSTAT\" || exit 1#cat \"$TRUNC\" >|\"\$LC_NUMSTAT\" || exit 1#" "$LC" >"$TRUNC_LC"

  run env DIFF_BASE=main bash "$TRUNC_LC"
  [ "$status" -ne 0 ]
  [[ "$output" != *"file-line-counts rows="* ]]
  [[ "$output" != *"base="* ]]
}
