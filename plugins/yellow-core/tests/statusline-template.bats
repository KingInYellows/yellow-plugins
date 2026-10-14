#!/usr/bin/env bats
# Tests for the git segment of references/statusline-setup/statusline-template.py,
# the script /statusline:setup installs as yellow-statusline.py. The statusline
# runs on every refresh, so its git calls must never leave .git/index.lock
# behind, and its cache must not leak one session's branch into another.

bats_require_minimum_version 1.5.0

setup() {
  TEST_HOME="$(mktemp -d)"
  TPL="$BATS_TEST_DIRNAME/../references/statusline-setup/statusline-template.py"
  FIX=$(find "$BATS_TEST_DIRNAME/fixtures/statusline" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -n 1)
  # /statusline:setup fills the REPLACE_WITH_ placeholders; do the same.
  sed -e 's/REPLACE_WITH_ISO_TIMESTAMP/test/' -e 's/REPLACE_WITH_DETECTED_PLUGINS/{}/' \
    -e 's/REPLACE_WITH_ENV_REQUIREMENTS/{}/' -e 's/REPLACE_WITH_BOOLEAN/False/' \
    "$TPL" > "$TEST_HOME/statusline.py"
  export CLAUDE_CONFIG_DIR="$TEST_HOME/config"
  mkdir -p "$CLAUDE_CONFIG_DIR"

  # A stub git that records its argv and answers rev-parse with the branch
  # named by a .stub-branch file in its working directory.
  STUB_DIR="$TEST_HOME/bin"
  GIT_LOG="$TEST_HOME/git-argv.log"
  mkdir -p "$STUB_DIR"
  cat > "$STUB_DIR/git" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$GIT_LOG"
case "\$*" in
  *rev-parse*) cat .stub-branch 2>/dev/null || echo unknown ;;
esac
exit 0
STUB
  chmod +x "$STUB_DIR/git"
}

teardown() {
  [ -n "${TEST_HOME:-}" ] && rm -rf "$TEST_HOME"
}

# Render the statusline for a payload whose cwd is $1, with $2 prepended to PATH.
_render() {
  jq -c --arg c "$1" '.cwd = $c | .workspace.current_dir = $c' "$FIX/mid-session.json" \
    | PATH="$2:$PATH" python3 "$TEST_HOME/statusline.py"
}

@test "git status runs with --no-optional-locks" {
  mkdir -p "$TEST_HOME/repo"
  echo main > "$TEST_HOME/repo/.stub-branch"
  run --separate-stderr _render "$TEST_HOME/repo" "$STUB_DIR"
  [ "$status" -eq 0 ]
  grep -qx -- '--no-optional-locks status --porcelain' "$GIT_LOG"
  run grep -x -- 'status --porcelain' "$GIT_LOG"
  [ "$status" -eq 1 ]
}

@test "each working directory gets its own git cache" {
  mkdir -p "$TEST_HOME/a" "$TEST_HOME/b"
  echo alpha-branch > "$TEST_HOME/a/.stub-branch"
  echo beta-branch > "$TEST_HOME/b/.stub-branch"
  run --separate-stderr _render "$TEST_HOME/a" "$STUB_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *alpha-branch* ]]
  # Within the 5 s cache TTL, a second session elsewhere must still see
  # its own branch, not the first session's cached one.
  run --separate-stderr _render "$TEST_HOME/b" "$STUB_DIR"
  [ "$status" -eq 0 ]
  [[ "$output" == *beta-branch* ]]
  [[ "$output" != *alpha-branch* ]]
  [ "$(find "$CLAUDE_CONFIG_DIR" -maxdepth 1 -name 'yellow-sl-git-*' | wc -l)" -eq 2 ]
  [ ! -e "$CLAUDE_CONFIG_DIR/yellow-sl-git" ]
}

@test "with real git, a stale index is not rewritten (no index.lock taken)" {
  command -v git >/dev/null || skip "git not installed"
  local repo="$TEST_HOME/real"
  mkdir -p "$repo"
  git -C "$repo" init -q
  printf 'x\n' > "$repo/f.txt"
  git -C "$repo" add f.txt
  git -C "$repo" -c user.name=t -c user.email=t@example.invalid commit -q -m init
  # Make the index stale: the file's mtime moves past the index entry, so a
  # plain `git status` would refresh and rewrite .git/index.
  sleep 1.1
  touch "$repo/f.txt"
  local before after
  before=$(stat -c %Y.%y "$repo/.git/index")
  run --separate-stderr _render "$repo" "/nonexistent"
  [ "$status" -eq 0 ]
  after=$(stat -c %Y.%y "$repo/.git/index")
  [ "$before" = "$after" ]
  # Control: a plain `git status` does rewrite it, so the check above can fail.
  git -C "$repo" status --porcelain >/dev/null
  [ "$before" != "$(stat -c %Y.%y "$repo/.git/index")" ]
}
