#!/usr/bin/env bats
# FU-1 regression tests for the ast-grep CLI recipe (yellow-plugins #1090,
# finding 4213663527, and the #1112 review). Values (pattern, lang, target,
# rule) reach the recipe only as files the agent writes with the Write tool,
# read back with "$(cat -- file)": no value is ever shell source, so there is
# no heredoc delimiter for a hostile pattern to close. The recipe only accepts
# a values directory under the resolved TMPDIR that holds step 1's marker,
# and cleans up by deleting its own files and rmdir, never rm -rf. Each doc's
# blocks run end to end against a stub ast-grep that records its argv and the
# config it was given, under bash and (when installed) zsh -f -o noclobber.

bats_require_minimum_version 1.5.0

PLUGIN_ROOT="$BATS_TEST_DIRNAME/.."
DOCS=("agents/scanners/duplication-scanner.md" "agents/scanners/complexity-scanner.md")

setup() {
  WORK="$(mktemp -d)"
  STUB="$(mktemp -d)"
  # A private TMPDIR reached through a symlink, so the tests also cover the
  # recipe resolving TMPDIR before comparing paths.
  mkdir "$WORK/tmp-real"
  ln -s "$WORK/tmp-real" "$WORK/tmp-link"
  export TMPDIR="$WORK/tmp-link"
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
step1_of() { extract_block "$1" 'ast-grep-values.XXXXXXXX'; }
recipe_of() { extract_block "$1" 'ast-grep run'; }

# Run step 1 of doc $1 under shell $2, then write the name=value pairs the
# way the Write tool would (verbatim plus a trailing newline), then run the
# recipe with VALUES_DIR replaced by the printed path. Sets RECIPE_DIR.
run_recipe() {
  local doc="$1" sh="$2"; shift 2
  local step1 recipe kv
  step1="$(step1_of "$doc")"
  recipe="$(recipe_of "$doc")"
  if [ -z "$step1" ] || [ -z "$recipe" ]; then
    echo "recipe blocks not found in $doc"; return 1
  fi
  RECIPE_DIR="$(env PATH="$STUB:$PATH" $sh -c "$step1")"
  if [ -z "$RECIPE_DIR" ] || [ ! -d "$RECIPE_DIR" ]; then
    echo "step 1 printed no directory: '$RECIPE_DIR'"; return 1
  fi
  for kv in "$@"; do
    printf '%s\n' "${kv#*=}" > "$RECIPE_DIR/${kv%%=*}"
  done
  # shellcheck disable=SC2086 # RUN_OPTS is empty or a single bats run flag
  run ${RUN_OPTS:-} env PATH="$STUB:$PATH" $sh -c "${recipe//VALUES_DIR/$RECIPE_DIR}"
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
}

@test "ast-grep recipe passes values through files, never through a heredoc" {
  local doc block want
  for doc in "${DOCS[@]}"; do
    block="$(recipe_of "$PLUGIN_ROOT/$doc")"
    [ -n "$block" ]
    if printf '%s' "$block" | grep -q '<<'; then echo "heredoc in $doc recipe"; return 1; fi
    if printf '%s' "$block" | grep -q 'rm -rf'; then echo "rm -rf in $doc recipe"; return 1; fi
    for want in 'pattern=$(cat -- "$d/pattern")' 'lang=$(cat -- "$d/lang")' \
      'target=$(cat -- "$d/target")' 'rule=$(cat -- "$d/rule")' \
      'ast-grep run -c "$cfg" --pattern "$pattern" --lang "$lang" -- "$target"' \
      'ast-grep scan -c "$cfg" --inline-rules "$rule" --json=stream -- "$target"' \
      'rmdir -- "$d"'; do
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
    RECIPE_DIR="$(env PATH="$STUB:$PATH" bash -c "$(step1_of "$PLUGIN_ROOT/$doc")")"
    printf 'console.log($A)\n' > "$RECIPE_DIR/pattern"
    printf 'js\n' > "$RECIPE_DIR/lang"
    printf 'src\n' > "$RECIPE_DIR/target"
    # Plant every name a config could take, pointing outside the directory.
    for f in trusted-sgconfig.yml trusted-sgconfig.XXXXXXXX sgconfig.yml; do
      ln -s "$WORK/outside" "$RECIPE_DIR/$f"
    done
    recipe="$(recipe_of "$PLUGIN_ROOT/$doc")"
    run env PATH="$STUB:$PATH" bash -c "${recipe//VALUES_DIR/$RECIPE_DIR}"
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

@test "a look-alike directory is refused and left untouched (no rm -rf)" {
  local doc recipe d real
  real="$(cd "$WORK/tmp-real" && pwd -P)"
  for doc in "${DOCS[@]}"; do
    recipe="$(recipe_of "$PLUGIN_ROOT/$doc")"
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
      run env PATH="$STUB:$PATH" bash -c "${recipe//VALUES_DIR/$d}"
      expect_refused_untouched "$doc: $d"
      [ "$(cat "$d/precious.txt")" = keep ]
      [ -f "$d/pattern" ]
    done
    for d in "$WORK" VALUES_DIR '/tmp/ast-grep-values.$(touch markers/D)' \
      "$real/ast-grep-values.12345678/../x"; do
      rm -f "$ARGV_FILE"
      run env PATH="$STUB:$PATH" bash -c "${recipe//VALUES_DIR/$d}"
      expect_refused_untouched "$doc: $d"
      expect_no_markers "$doc: $d"
    done
    [ -f src/a.js ]
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
      if [ -n "$output" ] && [ -d "$output" ]; then echo "$doc: TMPDIR=$t accepted: $output"; return 1; fi
      [ "$(find "$WORK" -name 'ast-grep-values.*' | sort)" = "$before" ]
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
