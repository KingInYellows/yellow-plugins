#!/usr/bin/env bats
# FU-1 regression tests for the ast-grep CLI recipe (yellow-plugins #1090,
# finding 4213663527, and the #1112 review). Values (pattern, lang, target,
# rule) reach the recipe only as files the agent writes with the Write tool,
# read back with "$(cat -- file)". The only text the agent puts into a block
# is step 1's eight-character token (CLAUDE-91), which selects step 1's record
# in a private 0700 state directory; the values directory comes from that
# record's pointer file, so no value or path becomes shell source. The
# recipe only accepts a values directory under the resolved TMPDIR that holds
# step 1's marker, and cleans up by deleting its own files and rmdir, never
# rm -rf. Each doc's blocks run end to end against a stub ast-grep that
# records its argv and the config it was given, under bash and (when
# installed) zsh -f -o noclobber.

bats_require_minimum_version 1.5.0

PLUGIN_ROOT="$BATS_TEST_DIRNAME/.."
DOCS=("agents/research/code-researcher.md")

setup() {
  WORK="$(mktemp -d)"
  STUB="$(mktemp -d)"
  # A private TMPDIR reached through a symlink, so the tests also cover the
  # recipe resolving TMPDIR before comparing paths.
  mkdir "$WORK/tmp-real"
  ln -s "$WORK/tmp-real" "$WORK/tmp-link"
  export TMPDIR="$WORK/tmp-link"
  # Private per-test state directory for the per-search records.
  mkdir -m 700 "$WORK/run" "$WORK/home"
  export XDG_RUNTIME_DIR="$WORK/run" HOME="$WORK/home"
  STATE="$WORK/run/yellow-ast-grep"
  export ARGV_FILE="$STUB/argv" CFG_COPY="$STUB/cfg-seen" STUB_MODE=normal
  cat > "$STUB/ast-grep" <<'STUB_EOF'
#!/bin/bash
printf '%s\0' "$@" > "$ARGV_FILE"
prev=''
for a in "$@"; do
  if [ "$prev" = "-c" ]; then cat -- "$a" > "$CFG_COPY"; fi
  prev="$a"
done
if [ "$STUB_MODE" = big ]; then
  head -c 5000 /dev/zero | tr '\0' 'A'; printf '\n'
  i=0; while [ $i -lt 500 ]; do printf 'src/a.js:%s:console.log(%s)\n' "$i" "$i"; i=$((i + 1)); done
else
  printf 'src/a.js:1:console.log(1)\n'
fi
STUB_EOF
  chmod +x "$STUB/ast-grep"
  mkdir -p "$WORK/repo/src" "$WORK/repo/markers"
  printf 'console.log(1)\n' > "$WORK/repo/src/a.js"
  cd "$WORK/repo"
}

teardown() {
  cd /
  chmod -R u+w "$WORK" 2>/dev/null || true
  rm -rf "$WORK" "$STUB"
}

have_zsh() { command -v zsh >/dev/null 2>&1; }
require_zsh() {
  have_zsh && return 0
  [ -z "${CI:-}" ] || { echo "zsh is required in CI"; return 1; }
  skip "zsh not installed (bash cases above still ran)"
}

# Print the first ```bash block of $1 that contains the fixed string $2.
extract_block() {
  awk -v want="$2" '
    /^```bash$/ { inb = 1; buf = ""; next }
    /^```$/ && inb { inb = 0; if (index(buf, want)) { printf "%s", buf; exit } next }
    inb { buf = buf $0 "\n" }
  ' "$1"
}
step1_of() { extract_block "$1" 'mktemp -d'; }
recipe_of() { extract_block "$1" 'ast-grep run'; }
# The recipe block with TOKEN replaced by $2, the one edit the agent makes.
recipe_for() { recipe_of "$1" | sed "1s|^k='TOKEN'\$|k='$2'|"; }
# Run step 1 of doc $1 under shell $2; set STEP1_DIR and STEP1_TOKEN.
run_step1() {
  local out
  out="$(env PATH="$STUB:$PATH" ${2:-bash} -c "$(step1_of "$1")")"
  STEP1_DIR="$(printf '%s\n' "$out" | sed -n 's/^dir: //p')"
  STEP1_TOKEN="$(printf '%s\n' "$out" | sed -n 's/^token: //p')"
}
# No per-search record is left in the state directory.
expect_no_records() {
  if [ -n "$(ls -A "$STATE" 2>/dev/null)" ]; then echo "$1: records left: $(ls -A "$STATE")"; return 1; fi
}

# Run step 1 of doc $1 under shell $2, then write the name=value pairs the
# way the Write tool would (verbatim plus a trailing newline), then run the
# recipe block unchanged. Sets RECIPE_DIR.
run_recipe() {
  local doc="$1" sh="$2"; shift 2
  local recipe kv
  if [ -z "$(step1_of "$doc")" ] || [ -z "$(recipe_of "$doc")" ]; then
    echo "recipe blocks not found in $doc"; return 1
  fi
  run_step1 "$doc" "$sh"
  RECIPE_DIR="$STEP1_DIR"
  if [ -z "$RECIPE_DIR" ] || [ ! -d "$RECIPE_DIR" ]; then
    echo "step 1 printed no directory: '$RECIPE_DIR'"; return 1
  fi
  [ "$RECIPE_DIR" = "${RECIPE_DIR%.*}.$STEP1_TOKEN" ]
  recipe="$(recipe_for "$doc" "$STEP1_TOKEN")"
  for kv in "$@"; do
    printf '%s\n' "${kv#*=}" > "$RECIPE_DIR/${kv%%=*}"
  done
  # shellcheck disable=SC2086 # RUN_OPTS is empty or a single bats run flag
  run ${RUN_OPTS:-} env PATH="$STUB:$PATH" $sh -c "$recipe"
}

argv_n() { awk -v n="$1" 'BEGIN{RS="\0"} NR==n{printf "%s", $0}' "$ARGV_FILE"; }
expect_no_markers() {
  if [ -n "$(ls markers)" ]; then echo "$1: payload ran: $(ls markers)"; return 1; fi
}
expect_refused_untouched() {
  if [[ "$output" != *"ast-grep: refused"* ]]; then echo "$1: not refused: $output"; return 1; fi
  if [ -f "$ARGV_FILE" ]; then echo "$1: reached ast-grep"; return 1; fi
}

# A pattern that closes the old template's static heredoc delimiter, runs a
# command, then reopens a heredoc so the rest still parses (Critic repro).
BREAKOUT=$'x\nAST_GREP_PATTERN_NONCE\n)\ntouch markers/HEREDOC\npattern=$(cat <<\'AST_GREP_PATTERN_NONCE\'\nx'

check_breakout() {
  local doc="$1" sh="$2" got
  rm -f "$ARGV_FILE" "$CFG_COPY"
  run_recipe "$doc" "$sh" "pattern=$BREAKOUT" lang=js target=src
  [ "$status" -eq 0 ]
  expect_no_markers "$doc/$sh"
  [ -f "$ARGV_FILE" ]
  got="$(argv_n 5)"
  if [ "$got" != "$BREAKOUT" ]; then echo "$doc/$sh: pattern mangled: $got"; return 1; fi
  [ "$(argv_n 1)" = run ]
  [ "$(argv_n 2)" = -c ]
  [ "$(argv_n 4)" = --pattern ]
  [[ "$output" == *"console.log(1)"* ]]
  [ ! -e "$RECIPE_DIR" ]
  expect_no_records "$doc/$sh"
}

@test "ast-grep recipe passes values through files, never through a heredoc" {
  local doc block want
  for doc in "${DOCS[@]}"; do
    block="$(recipe_of "$PLUGIN_ROOT/$doc")"
    [ -n "$block" ]
    if printf '%s' "$block" | grep -q '<<'; then echo "heredoc in $doc recipe"; return 1; fi
    if printf '%s' "$block" | grep -q 'rm -rf'; then echo "rm -rf in $doc recipe"; return 1; fi
    # The token line is the recipe's first line and its only placeholder.
    [ "$(printf '%s\n' "$block" | head -n 1)" = "k='TOKEN'" ]
    if printf '%s\n%s' "$(printf '%s\n' "$block" | tail -n +2)" "$(step1_of "$PLUGIN_ROOT/$doc")" |
      grep -nE "TOKEN|VALUES_DIR|^(PATTERN|LANG|PATH|RULE)$|='[A-Z_]+'|<[A-Za-z_]+>"; then
      echo "placeholder in $doc ast-grep blocks"; return 1
    fi
    for want in 'pattern=$(cat -- "$d/pattern")' 'lang=$(cat -- "$d/lang")' \
      'target=$(cat -- "$d/target")' 'rule=$(cat -- "$d/rule")' \
      'ast-grep run -c "$cfg" --pattern "$pattern" --lang "$lang" -- "$target"' \
      'ast-grep scan -c "$cfg" --inline-rules "$rule" --json=stream -- "$target"' \
      'rmdir -- "$d"' 'd=$(cat -- "$s/dir")'; do
      if ! printf '%s' "$block" | grep -qF -- "$want"; then echo "$doc missing: $want"; return 1; fi
    done
    if grep -q 'AST_GREP_[A-Z]*_NONCE' "$PLUGIN_ROOT/$doc"; then echo "stale NONCE in $doc"; return 1; fi
  done
}

@test "heredoc-breakout pattern stays data (bash, then zsh noclobber)" {
  local doc
  for doc in "${DOCS[@]}"; do check_breakout "$PLUGIN_ROOT/$doc" bash; done
  require_zsh
  for doc in "${DOCS[@]}"; do check_breakout "$PLUGIN_ROOT/$doc" 'zsh -f -o noclobber'; done
}

@test "ast-grep gets the trusted config, written fresh by the recipe" {
  local doc cfg
  for doc in "${DOCS[@]}"; do
    rm -f "$ARGV_FILE" "$CFG_COPY"
    run_recipe "$PLUGIN_ROOT/$doc" bash 'pattern=console.log($A)' lang=js target=src
    [ "$status" -eq 0 ]
    cfg="$(argv_n 3)"
    case "$cfg" in "$RECIPE_DIR"/trusted-sgconfig.*) ;; *) echo "$doc: -c $cfg"; return 1 ;; esac
    [ "$(cat "$CFG_COPY")" = 'ruleDirs: []' ]
  done
}

@test "a planted config file or symlink is never overwritten or followed" {
  local doc recipe f
  for doc in "${DOCS[@]}"; do
    rm -f "$ARGV_FILE" "$CFG_COPY"
    printf 'sentinel\n' > "$WORK/outside"
    run_step1 "$PLUGIN_ROOT/$doc"
    RECIPE_DIR="$STEP1_DIR"
    printf 'console.log($A)\n' > "$RECIPE_DIR/pattern"
    printf 'js\n' > "$RECIPE_DIR/lang"
    printf 'src\n' > "$RECIPE_DIR/target"
    # Plant every name a config could take, pointing outside the directory.
    for f in trusted-sgconfig.yml trusted-sgconfig.XXXXXXXX sgconfig.yml; do
      ln -s "$WORK/outside" "$RECIPE_DIR/$f"
    done
    recipe="$(recipe_for "$PLUGIN_ROOT/$doc" "$STEP1_TOKEN")"
    run env PATH="$STUB:$PATH" bash -c "$recipe"
    [ "$(cat "$WORK/outside")" = sentinel ]
    [ "$(cat "$CFG_COPY")" = 'ruleDirs: []' ]
    [ ! -L "$(argv_n 3)" ] || [ ! -e "$(argv_n 3)" ]
    rm -rf "$RECIPE_DIR"
  done
}

@test "hostile lang and target values are refused before ast-grep runs" {
  local doc v
  for doc in "${DOCS[@]}"; do
    for v in 'lang=js; touch markers/LANG' 'target=src/$(touch markers/PATH).js' \
      "target=src/a'; touch markers/Q; '.js" 'target=--rewrite=x' 'target=../etc' \
      'target=/etc' 'lang=' 'target='; do
      rm -f "$ARGV_FILE"
      run_recipe "$PLUGIN_ROOT/$doc" bash 'pattern=console.log($A)' lang=js target=src "$v"
      expect_no_markers "$doc: $v"
      expect_refused_untouched "$doc: $v"
      [ ! -e "$RECIPE_DIR" ]
    done
  done
}

@test "missing or empty value files fail closed and still clean up" {
  local doc
  for doc in "${DOCS[@]}"; do
    rm -f "$ARGV_FILE"
    run_recipe "$PLUGIN_ROOT/$doc" bash lang=js target=src
    expect_refused_untouched "$doc: missing pattern"
    [ ! -e "$RECIPE_DIR" ]
    run_recipe "$PLUGIN_ROOT/$doc" bash pattern= lang=js target=src
    expect_refused_untouched "$doc: empty pattern"
    [ ! -e "$RECIPE_DIR" ]
  done
}

# Record a search with step 1, then make its pointer file name $2 instead of
# step 1's directory (what a stale or tampered pointer would hold), and run
# the recipe block with step 1's token.
run_with_pointer() {
  local doc="$1" target_dir="$2" own
  run_step1 "$doc"
  own="$STEP1_DIR"
  [ -d "$own" ]
  printf '%s\n' "$target_dir" > "$STATE/search.$STEP1_TOKEN/dir"
  run env PATH="$STUB:$PATH" bash -c "$(recipe_for "$doc" "$STEP1_TOKEN")"
  rmdir "$own/.ast-grep-values" "$own"
}

@test "a look-alike directory is refused and left untouched (no rm -rf)" {
  local doc d real
  real="$(cd "$WORK/tmp-real" && pwd -P)"
  for doc in "${DOCS[@]}"; do
    # 1: the #1112 review repro, a matching name inside the repository.
    # 2: right name under TMPDIR but no step 1 marker directory.
    # 3: right name and marker but reached through the TMPDIR symlink.
    mkdir -p src/ast-grep-values.abcdefgh "$real/ast-grep-values.nomarker" "$real/ast-grep-values.viaLINK1"
    mkdir -p "$real/ast-grep-values.viaLINK1/.ast-grep-values"
    for d in "$WORK/repo/src/ast-grep-values.abcdefgh" "$real/ast-grep-values.nomarker" \
      "$WORK/tmp-link/ast-grep-values.viaLINK1"; do
      printf 'keep\n' > "$d/precious.txt"
      printf 'console.log($A)\n' > "$d/pattern"
      printf 'js\n' > "$d/lang"
      printf 'src\n' > "$d/target"
      rm -f "$ARGV_FILE"
      run_with_pointer "$PLUGIN_ROOT/$doc" "$d"
      expect_refused_untouched "$doc: $d"
      [ "$(cat "$d/precious.txt")" = keep ]
      [ -f "$d/pattern" ]
      # The record is dropped even when the pointed-to directory is refused.
      expect_no_records "$doc: $d"
    done
    for d in "$WORK" VALUES_DIR '/tmp/ast-grep-values.$(touch markers/D)' \
      "$real/ast-grep-values.12345678/../x" ''; do
      rm -f "$ARGV_FILE"
      run_with_pointer "$PLUGIN_ROOT/$doc" "$d"
      expect_refused_untouched "$doc: $d"
      expect_no_markers "$doc: $d"
      expect_no_records "$doc: $d"
    done
    [ -f src/a.js ]
  done
}

@test "codex 4231677565: a quote-breaking directory value never becomes shell source" {
  local doc payload
  # The #1112 repro, with the canary inside the scratch repo instead of /tmp.
  payload="/tmp/x'; touch $WORK/repo/markers/PWN; #"
  for doc in "${DOCS[@]}"; do
    rm -f "$ARGV_FILE"
    run_with_pointer "$PLUGIN_ROOT/$doc" "$payload"
    expect_no_markers "$doc"
    expect_refused_untouched "$doc"
    expect_no_records "$doc"
  done
}

@test "the recipe without a matching step 1 record refuses and touches nothing" {
  local doc tok
  for doc in "${DOCS[@]}"; do
    # TOKEN left in place, a well-formed token step 1 never issued, and
    # malformed tokens, with and without another search pending.
    for tok in TOKEN AbCd1234 AbCd123 AbCd12345 'AbCd/../' '../../xx'; do
      rm -f "$ARGV_FILE"
      run env PATH="$STUB:$PATH" bash -c "$(recipe_for "$PLUGIN_ROOT/$doc" "$tok")"
      expect_refused_untouched "$doc: $tok"
      [[ "$output" == *"no pending search"* ]]
    done
    run_step1 "$PLUGIN_ROOT/$doc"
    printf 'console.log($A)\n' > "$STEP1_DIR/pattern"
    for tok in TOKEN AbCd1234; do
      rm -f "$ARGV_FILE"
      run env PATH="$STUB:$PATH" bash -c "$(recipe_for "$PLUGIN_ROOT/$doc" "$tok")"
      expect_refused_untouched "$doc: $tok with a search pending"
      # The other search's record and values are untouched.
      [ -f "$STATE/search.$STEP1_TOKEN/dir" ]
      [ -f "$STEP1_DIR/pattern" ]
    done
    rm -f "$STEP1_DIR/pattern" "$STATE/search.$STEP1_TOKEN/dir"
    rmdir "$STEP1_DIR/.ast-grep-values" "$STEP1_DIR" "$STATE/search.$STEP1_TOKEN"
  done
}

@test "CLAUDE-91: concurrent searches get their own directory and token" {
  local doc step1 i n dirs toks
  for doc in "${DOCS[@]}"; do
    step1="$(step1_of "$PLUGIN_ROOT/$doc")"
    # Eight step 1 runs at once: every one succeeds with a distinct search.
    for i in 1 2 3 4 5 6 7 8; do
      bash -c "$step1" > "$WORK/race.$i" 2>&1 &
    done
    wait
    if grep -h 'ast-grep:' "$WORK"/race.*; then echo "$doc: a step 1 was refused"; return 1; fi
    dirs="$(sed -n 's/^dir: //p' "$WORK"/race.* | sort -u)"
    toks="$(sed -n 's/^token: //p' "$WORK"/race.* | sort -u)"
    [ "$(printf '%s\n' "$dirs" | grep -c .)" -eq 8 ]
    [ "$(printf '%s\n' "$toks" | grep -c .)" -eq 8 ]
    [ "$(ls -A "$STATE" | grep -c '^search\.')" -eq 8 ]
    for n in $toks; do
      [ "$(cat "$STATE/search.$n/dir")" = "$(sed -n "s/^dir: \(.*\.$n\)\$/\1/p" "$WORK"/race.*)" ]
      d="$(cat "$STATE/search.$n/dir")"
      rm -f "$STATE/search.$n/dir"
      rmdir "$d/.ast-grep-values" "$d" "$STATE/search.$n"
    done
    rm -f "$WORK"/race.*
  done
}

@test "CLAUDE-91: interleaved searches each read only their own values" {
  local doc sh a_dir a_tok b_dir b_tok
  for sh in bash 'zsh -f -o noclobber'; do
    if [ "$sh" != bash ]; then require_zsh; fi
    for doc in "${DOCS[@]}"; do
      # Scanner A and scanner B both run step 1 before either runs the recipe.
      run_step1 "$PLUGIN_ROOT/$doc" "$sh"
      a_dir="$STEP1_DIR" a_tok="$STEP1_TOKEN"
      run_step1 "$PLUGIN_ROOT/$doc" "$sh"
      b_dir="$STEP1_DIR" b_tok="$STEP1_TOKEN"
      [ "$a_dir" != "$b_dir" ]
      printf 'aaa($A)\n' > "$a_dir/pattern"
      printf 'js\n' > "$a_dir/lang"
      printf 'src\n' > "$a_dir/target"
      printf 'bbb($B)\n' > "$b_dir/pattern"
      printf 'ts\n' > "$b_dir/lang"
      printf 'src\n' > "$b_dir/target"
      # B finishes first; A's directory and record are left alone.
      rm -f "$ARGV_FILE"
      run env PATH="$STUB:$PATH" $sh -c "$(recipe_for "$PLUGIN_ROOT/$doc" "$b_tok")"
      [ "$status" -eq 0 ]
      [ "$(argv_n 5)" = 'bbb($B)' ]
      [ "$(argv_n 7)" = ts ]
      [ ! -e "$b_dir" ]
      [ ! -e "$STATE/search.$b_tok" ]
      [ -f "$a_dir/pattern" ]
      [ -f "$STATE/search.$a_tok/dir" ]
      rm -f "$ARGV_FILE"
      run env PATH="$STUB:$PATH" $sh -c "$(recipe_for "$PLUGIN_ROOT/$doc" "$a_tok")"
      [ "$status" -eq 0 ]
      [ "$(argv_n 5)" = 'aaa($A)' ]
      [ "$(argv_n 7)" = js ]
      [ ! -e "$a_dir" ]
      expect_no_records "$doc/$sh"
    done
  done
}

@test "a search record older than 15 minutes is treated as abandoned" {
  local doc old old_tok
  for doc in "${DOCS[@]}"; do
    run_step1 "$PLUGIN_ROOT/$doc"
    old="$STEP1_DIR" old_tok="$STEP1_TOKEN"
    touch -t 200001010000 "$STATE/search.$old_tok"
    run_step1 "$PLUGIN_ROOT/$doc"
    [ -d "$STEP1_DIR" ]
    [ "$STEP1_DIR" != "$old" ]
    [ ! -e "$STATE/search.$old_tok" ]
    [ "$(cat "$STATE/search.$STEP1_TOKEN/dir")" = "$STEP1_DIR" ]
    # The abandoned values directory is not deleted by step 1.
    [ -d "$old" ]
    rm -f "$STATE/search.$STEP1_TOKEN/dir"
    rmdir "$old/.ast-grep-values" "$old" "$STEP1_DIR/.ast-grep-values" "$STEP1_DIR" "$STATE/search.$STEP1_TOKEN"
  done
}

@test "an unsafe state directory is refused before anything is created" {
  local doc step1 before
  for doc in "${DOCS[@]}"; do
    step1="$(step1_of "$PLUGIN_ROOT/$doc")"
    # Wrong mode.
    mkdir -m 755 "$STATE"
    run bash -c "$step1"
    [[ "$output" == *"ast-grep: refused"* ]]
    [ -z "$(ls -A "$STATE")" ]
    rmdir "$STATE"
    # A symlink to a directory someone else could control.
    mkdir -m 700 "$WORK/elsewhere"
    ln -s "$WORK/elsewhere" "$STATE"
    run bash -c "$step1"
    [[ "$output" == *"ast-grep: refused"* ]]
    [ -z "$(ls -A "$WORK/elsewhere")" ]
    rm "$STATE"
    rmdir "$WORK/elsewhere"
    # A relative XDG_RUNTIME_DIR.
    before="$(find "$WORK" -name 'ast-grep-values.*' | sort)"
    run env XDG_RUNTIME_DIR=run bash -c "$step1"
    [[ "$output" == *"ast-grep: refused"* ]]
    [ "$(find "$WORK" -name 'ast-grep-values.*' | sort)" = "$before" ]
  done
}

@test "with XDG_RUNTIME_DIR unset the state lives in ~/.cache, created 0700" {
  local doc
  for doc in "${DOCS[@]}"; do
    rm -f "$ARGV_FILE"
    STEP1_DIR='' STEP1_TOKEN=''
    eval "$(env -u XDG_RUNTIME_DIR PATH="$STUB:$PATH" bash -c "$(step1_of "$PLUGIN_ROOT/$doc")" |
      sed -n "s/^dir: \(.*\)/STEP1_DIR='\1'/p; s/^token: \(.*\)/STEP1_TOKEN='\1'/p")"
    RECIPE_DIR="$STEP1_DIR"
    [ -d "$RECIPE_DIR" ]
    [ -d "$HOME/.cache/yellow-ast-grep/search.$STEP1_TOKEN" ]
    case "$(ls -ld "$HOME/.cache/yellow-ast-grep")" in drwx------*) ;; *) return 1 ;; esac
    printf 'console.log($A)\n' > "$RECIPE_DIR/pattern"
    printf 'js\n' > "$RECIPE_DIR/lang"
    printf 'src\n' > "$RECIPE_DIR/target"
    run env -u XDG_RUNTIME_DIR PATH="$STUB:$PATH" bash -c "$(recipe_for "$PLUGIN_ROOT/$doc" "$STEP1_TOKEN")"
    [ "$status" -eq 0 ]
    [[ "$output" == *"console.log(1)"* ]]
    [ ! -e "$RECIPE_DIR" ]
    [ -z "$(ls -A "$HOME/.cache/yellow-ast-grep")" ]
  done
}

@test "cleanup removes only the recipe's files, never extra ones" {
  local doc
  for doc in "${DOCS[@]}"; do
    rm -f "$ARGV_FILE"
    run_recipe "$PLUGIN_ROOT/$doc" bash 'pattern=console.log($A)' lang=js target=src extra=keep
    [ "$status" -eq 0 ]
    [ -f "$RECIPE_DIR/extra" ]
    [ "$(ls -A "$RECIPE_DIR")" = extra ]
    expect_no_records "$doc"
    rm -rf "$RECIPE_DIR"
  done
}

@test "step 1 refuses an unusable TMPDIR and leaves nothing behind" {
  local doc t before
  for doc in "${DOCS[@]}"; do
    mkdir -p "$WORK/repo/rel" "$WORK/sp ace"
    for t in rel "$WORK/sp ace" "$WORK/missing"; do
      before="$(find "$WORK" -name 'ast-grep-values.*' | sort)"
      run env TMPDIR="$t" PATH="$STUB:$PATH" bash -c "$(step1_of "$PLUGIN_ROOT/$doc")"
      if [[ "$output" == *"dir: "* ]]; then echo "$doc: TMPDIR=$t accepted: $output"; return 1; fi
      [ "$(find "$WORK" -name 'ast-grep-values.*' | sort)" = "$before" ]
      expect_no_records "$doc: $t"
    done
  done
}

@test "output is capped at 200 lines of at most 2000 bytes" {
  local doc longest
  export STUB_MODE=big
  # Count stdout only: when SIGPIPE is ignored (as on CI runners) the stub's
  # writes after head exits report "Broken pipe" on stderr.
  RUN_OPTS=--separate-stderr
  for doc in "${DOCS[@]}"; do
    run_recipe "$PLUGIN_ROOT/$doc" bash 'pattern=console.log($A)' lang=js target=src
    [ "$status" -eq 0 ]
    [ "${#lines[@]}" -eq 200 ]
    longest="$(printf '%s\n' "$output" | awk '{ if (length($0) > m) m = length($0) } END { print m }')"
    [ "$longest" -eq 2000 ]
    run_recipe "$PLUGIN_ROOT/$doc" bash $'rule=id: r\nlanguage: js\nrule:\n  pattern: x' target=src
    [ "$status" -eq 0 ]
    [ "${#lines[@]}" -eq 200 ]
    longest="$(printf '%s\n' "$output" | awk '{ if (length($0) > m) m = length($0) } END { print m }')"
    [ "$longest" -eq 2000 ]
  done
}

@test "a rule file switches to a bounded relational scan" {
  local doc rule
  rule=$'id: r\nlanguage: js\nrule:\n  pattern: console.log($A)'
  for doc in "${DOCS[@]}"; do
    rm -f "$ARGV_FILE"
    run_recipe "$PLUGIN_ROOT/$doc" bash "rule=$rule" target=src
    [ "$status" -eq 0 ]
    [ "$(argv_n 1)" = scan ]
    [ "$(argv_n 2)" = -c ]
    [ "$(argv_n 4)" = --inline-rules ]
    [ "$(argv_n 5)" = "$rule" ]
    tr '\0' '\n' < "$ARGV_FILE" | grep -qx -- '--json=stream'
    [ ! -e "$RECIPE_DIR" ]
  done
}

@test "write-permission trust boundary is documented" {
  local root="$PLUGIN_ROOT/../.."
  grep -q 'Write permission and temp files' "$PLUGIN_ROOT/CLAUDE.md"
  grep -q 'Write' "$PLUGIN_ROOT/README.md"
  grep -q '^## ast-grep value files' "$root/docs/security.md"
  grep -q 'ast-grep value files' "$root/plugins/yellow-debt/CLAUDE.md"
}
