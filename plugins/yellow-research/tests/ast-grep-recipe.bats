#!/usr/bin/env bats
# FU-1 regression tests for the ast-grep CLI recipe (yellow-plugins #1090,
# finding 4213663527). Values (pattern, lang, target, rule) reach the recipe
# only as files the agent writes with the Write tool, read back with
# "$(cat -- file)": no value is ever shell source, so there is no heredoc
# delimiter for a hostile pattern to close. The recipe is run end to end
# against a stub ast-grep that records its argv, under bash and under
# zsh -f -o noclobber.

bats_require_minimum_version 1.5.0

PLUGIN_ROOT="$BATS_TEST_DIRNAME/.."
DOCS=("agents/research/code-researcher.md")

setup() {
  WORK="$(mktemp -d)"
  STUB="$(mktemp -d)"
  export ARGV_FILE="$STUB/argv"
  cat > "$STUB/ast-grep" <<'STUB_EOF'
#!/bin/bash
printf '%s\0' "$@" > "$ARGV_FILE"
printf 'src/a.js:1:console.log(1)\n'
STUB_EOF
  chmod +x "$STUB/ast-grep"
  mkdir -p "$WORK/src" "$WORK/markers"
  printf 'console.log(1)\n' > "$WORK/src/a.js"
  cd "$WORK"
}

teardown() {
  cd /
  rm -rf "$WORK" "$STUB"
}

require_zsh() {
  command -v zsh >/dev/null 2>&1 && return 0
  [ -z "${CI:-}" ] || { echo "zsh is required in CI"; return 1; }
  skip "zsh not installed"
}

# Print the first ```bash block of $1 that contains the fixed string $2.
extract_block() {
  awk -v want="$2" '
    /^```bash$/ { inb = 1; buf = ""; next }
    /^```$/ && inb { inb = 0; if (index(buf, want)) { printf "%s", buf; exit } next }
    inb { buf = buf $0 "\n" }
  ' "$1"
}

# Run step 1 (mktemp) and step 3 (the recipe) of doc $1 under shell $2,
# writing the value files listed as name=value pairs in between, the way the
# agent's Write tool would (values verbatim, plus a trailing newline).
run_recipe() {
  local doc="$1" sh="$2"; shift 2
  local step1 recipe dir kv
  step1="$(extract_block "$doc" 'ast-grep-values.XXXXXXXX')"
  recipe="$(extract_block "$doc" 'ast-grep run')"
  [ -n "$step1" ] && [ -n "$recipe" ] || { echo "recipe blocks not found in $doc"; return 1; }
  dir="$(PATH="$STUB:$PATH" $sh -c "$step1")"
  for kv in "$@"; do
    printf '%s\n' "${kv#*=}" > "$dir/${kv%%=*}"
  done
  RECIPE_DIR="$dir"
  run env PATH="$STUB:$PATH" $sh -c "${recipe//VALUES_DIR/$dir}"
}

argv_lines() { tr '\0' '\n' < "$ARGV_FILE"; }

# A pattern that closes the old template's static heredoc delimiter, runs a
# command, then reopens a heredoc so the rest still parses (Critic repro).
BREAKOUT=$'x\nAST_GREP_PATTERN_NONCE\n)\ntouch markers/HEREDOC\npattern=$(cat <<\'AST_GREP_PATTERN_NONCE\'\nx'

@test "ast-grep recipe passes values through files, never through a heredoc" {
  local doc block
  for doc in "${DOCS[@]}"; do
    block="$(extract_block "$PLUGIN_ROOT/$doc" 'ast-grep run')"
    [ -n "$block" ] || { echo "no recipe in $doc"; return 1; }
    if printf '%s' "$block" | grep -q '<<'; then
      echo "heredoc in $doc recipe"; return 1
    fi
    for want in 'pattern=$(cat -- "$d/pattern")' 'lang=$(cat -- "$d/lang")' \
      'target=$(cat -- "$d/target")' 'rule=$(cat -- "$d/rule")' \
      "printf 'ruleDirs: []\\n' >| \"\$cfg\"" \
      'ast-grep run -c "$cfg" --pattern "$pattern" --lang "$lang" -- "$target"' \
      'ast-grep scan -c "$cfg" --inline-rules "$rule" --json=stream -- "$target"' \
      'head -n 200 | cut -c 1-2000' 'rm -rf -- "$d"'; do
      printf '%s' "$block" | grep -qF -- "$want" || { echo "$doc missing: $want"; return 1; }
    done
    grep -q 'AST_GREP_[A-Z]*_NONCE' "$PLUGIN_ROOT/$doc" && { echo "stale NONCE in $doc"; return 1; }
  done
  true
}

@test "heredoc-breakout pattern stays data under bash and zsh noclobber" {
  require_zsh
  local doc sh
  for doc in "${DOCS[@]}"; do
    for sh in bash 'zsh -f -o noclobber'; do
      rm -f "$ARGV_FILE" markers/*
      run_recipe "$PLUGIN_ROOT/$doc" "$sh" "pattern=$BREAKOUT" lang=js target=src
      [ "$status" -eq 0 ] || { echo "$doc/$sh: rc=$status $output"; return 1; }
      [ -z "$(ls markers)" ] || { echo "$doc/$sh: payload ran"; return 1; }
      [ -f "$ARGV_FILE" ] || { echo "$doc/$sh: ast-grep not called"; return 1; }
      # The whole multi-line pattern arrives as one argv element.
      local got
      got="$(awk 'BEGIN{RS="\0"} NR==5{printf "%s", $0}' "$ARGV_FILE")"
      [ "$got" = "$BREAKOUT" ] || { echo "$doc/$sh: pattern mangled: $got"; return 1; }
      [ "$(argv_lines | head -n 4 | tr '\n' ' ')" = "run -c $RECIPE_DIR/trusted-sgconfig.yml --pattern " ] \
        || { echo "$doc/$sh: argv $(argv_lines)"; return 1; }
      [[ "$output" == *"console.log(1)"* ]]
      [ ! -e "$RECIPE_DIR" ] || { echo "$doc/$sh: values dir left behind"; return 1; }
    done
  done
}

@test "hostile lang and target values are refused before ast-grep runs" {
  local doc v
  for doc in "${DOCS[@]}"; do
    for v in 'lang=js; touch markers/LANG' 'target=src/$(touch markers/PATH).js' \
      "target=src/a'; touch markers/Q; '.js" 'target=--rewrite=x' 'target=../etc' \
      'target=/etc' 'lang=' 'target='; do
      rm -f "$ARGV_FILE" markers/*
      run_recipe "$PLUGIN_ROOT/$doc" bash pattern='console.log($A)' lang=js target=src "$v"
      [ -z "$(ls markers)" ] || { echo "$doc: $v ran"; return 1; }
      [ ! -f "$ARGV_FILE" ] || { echo "$doc: $v reached ast-grep"; return 1; }
      [[ "$output" == *"ast-grep: refused"* ]] || { echo "$doc: $v not refused: $output"; return 1; }
      [ ! -e "$RECIPE_DIR" ]
    done
  done
}

@test "missing or empty value files fail closed and still clean up" {
  local doc
  for doc in "${DOCS[@]}"; do
    rm -f "$ARGV_FILE"
    run_recipe "$PLUGIN_ROOT/$doc" bash lang=js target=src
    [[ "$output" == *"ast-grep: refused"* ]] && [ ! -f "$ARGV_FILE" ] && [ ! -e "$RECIPE_DIR" ]
    run_recipe "$PLUGIN_ROOT/$doc" bash pattern= lang=js target=src
    [[ "$output" == *"ast-grep: refused"* ]] && [ ! -f "$ARGV_FILE" ] && [ ! -e "$RECIPE_DIR" ]
  done
}

@test "values directory must be the one step 1 created" {
  local doc recipe d
  for doc in "${DOCS[@]}"; do
    recipe="$(extract_block "$PLUGIN_ROOT/$doc" 'ast-grep run')"
    # The template default and look-alike paths are refused. ($(...) stays
    # literal inside the single quotes, then fails the character guard.)
    for d in "$WORK" "$WORK/src" "VALUES_DIR" '/tmp/ast-grep-values.$(touch markers/D)' \
      "$WORK/ast-grep-values.12345678/../src" '/tmp/ast-grep-values.missing1'; do
      rm -f "$ARGV_FILE"
      run env PATH="$STUB:$PATH" bash -c "${recipe//VALUES_DIR/$d}"
      [[ "$output" == *"ast-grep: refused"* ]] || { echo "$doc: $d accepted: $output"; return 1; }
      [ ! -f "$ARGV_FILE" ] && [ -z "$(ls markers)" ] && [ -f src/a.js ]
    done
  done
}

@test "a rule file switches to a bounded relational scan" {
  local doc rule
  rule=$'id: r\nlanguage: js\nrule:\n  pattern: console.log($A)'
  for doc in "${DOCS[@]}"; do
    rm -f "$ARGV_FILE"
    run_recipe "$PLUGIN_ROOT/$doc" bash "rule=$rule" target=src
    [ "$status" -eq 0 ]
    [ "$(argv_lines | head -n 4 | tr '\n' ' ')" = "scan -c $RECIPE_DIR/trusted-sgconfig.yml --inline-rules " ]
    [ "$(awk 'BEGIN{RS="\0"} NR==5{printf "%s", $0}' "$ARGV_FILE")" = "$rule" ]
    argv_lines | grep -qx -- '--json=stream'
    [ ! -e "$RECIPE_DIR" ]
  done
}
