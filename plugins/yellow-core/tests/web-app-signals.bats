#!/usr/bin/env bats
# web-app-signals.bats — the web-app signal probe is written twice: the "Web
# App Signals" block in commands/setup/all.md and Step 2.5 of yellow-browser-test's
# commands/browser-test/setup.md. Both are extracted at run time and run against
# positive and negative fixtures under every shell the Bash tool can use; the
# two copies must agree on every fixture.

bats_require_minimum_version 1.5.0

setup() {
  PLUGINS="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ALL_MD="$PLUGINS/yellow-core/commands/setup/all.md"
  SETUP_MD="$PLUGINS/yellow-browser-test/commands/browser-test/setup.md"
  ALL_BLOCK="$BATS_TEST_TMPDIR/all-signals.sh"
  SETUP_BLOCK="$BATS_TEST_TMPDIR/setup-signals.sh"
  # all.md: from `web_signal_count=0` through the count line; repo_top is
  # passed in as $1 (the dashboard sets it earlier).
  { printf 'repo_top="${1:-}"\n'
    sed -n '/^web_signal_count=0$/,/^printf .web_signal_count:/p' "$ALL_MD"
  } > "$BATS_TEST_TMPDIR/all-signals.sh"
  # setup.md: the first bash fence after the Step 2.5 heading.
  awk '/^### Step 2.5/ { s = 1 } s && /^```bash$/ { f = 1; next } f && /^```$/ { exit } f' \
    "$SETUP_MD" > "$SETUP_BLOCK"
  [ "$(wc -l < "$ALL_BLOCK")" -gt 20 ]
  [ "$(wc -l < "$SETUP_BLOCK")" -gt 20 ]
  SHELLS="bash"
  if command -v zsh >/dev/null 2>&1; then
    SHELLS="bash zsh"
  else
    case "${CI:-}" in
      '' | false | 0) ;;
      *) echo "zsh not installed (required in CI)" >&2; return 1 ;;
    esac
  fi
}

# probe <dir> <shell> — sets ALL_OUT and SETUP_OUT for a fixture directory.
probe() {
  ALL_OUT=$(cd "$1" && "$2" "$ALL_BLOCK" "$1")
  SETUP_OUT=$(cd "$1" && "$2" "$SETUP_BLOCK")
}

# fixture <name> — a fresh, empty fixture directory.
fixture() {
  FIX="$BATS_TEST_TMPDIR/fix-$1"
  rm -rf "$FIX"
  mkdir -p "$FIX"
}

# check_web <label> <signal> — the fixture in $FIX is a web app in both copies.
check_web() {
  local sh
  for sh in $SHELLS; do
    probe "$FIX" "$sh"
    [[ "$SETUP_OUT" == "is_web: true (signals: $2;"* ]] || { echo "$sh setup.md [$1]: $SETUP_OUT"; return 1; }
    [[ "$ALL_OUT" != *"web_signal_count:              0"* ]] || { echo "$sh all.md [$1]: $ALL_OUT"; return 1; }
  done
}

# check_not_web <label> — the fixture in $FIX is not a web app in either copy.
check_not_web() {
  local sh
  for sh in $SHELLS; do
    probe "$FIX" "$sh"
    [[ "$SETUP_OUT" == "is_web: false"* ]] || { echo "$sh setup.md [$1]: $SETUP_OUT"; return 1; }
    [[ "$ALL_OUT" == *"web_signal_count:              0"* ]] || { echo "$sh all.md [$1]: $ALL_OUT"; return 1; }
  done
}

@test "positive fixtures are web apps in both copies, under bash and zsh" {
  local n=0 spec file content signal
  while IFS='|' read -r file content signal; do
    n=$((n + 1))
    fixture "pos$n"
    printf '%b\n' "$content" >| "$FIX/$file"
    check_web "$file: $content" "$signal"
  done <<'SPECS'
package.json|{"dependencies":{"react":"18"}}|node
Gemfile|gem 'rails', '~> 7'|rails
requirements.txt|fastapi==0.110|python
pyproject.toml|dependencies = ["Django>=4"]|python
go.mod|require github.com/gin-gonic/gin v1.9.1|go
Cargo.toml|[dependencies]\naxum = "0.7"|rust
Cargo.toml|[dependencies.axum]\nversion = "0.7"|rust
Cargo.toml|[dependencies.axum] # web server\nversion = "0.7"|rust
Cargo.toml|[dependencies.axum]# web server\nversion = "0.7"|rust
Cargo.toml|[dependencies]\naxum.workspace = true|rust
Cargo.toml|[dependencies]\nwarp.version = "0.3"|rust
Cargo.toml|[dependencies]\nweb = { package = "axum", version = "0.7" }|rust
Cargo.toml|[dev-dependencies]\nactix-web = "4"|rust
fly.toml|app = "x"|paas(fly.toml)
vercel.json|{}|paas(vercel.json)
SPECS
}

@test "negative fixtures are not web apps in either copy, under bash and zsh" {
  local n=0 file content
  while IFS='|' read -r file content; do
    n=$((n + 1))
    fixture "neg$n"
    printf '%b\n' "$content" >| "$FIX/$file"
    check_not_web "$file: $content"
  done <<'SPECS'
package.json|{"dependencies":{"lodash":"4"}}
Gemfile|gem 'sinatra'
requirements.txt|requests==2.31
go.mod|require github.com/spf13/cobra v1.8.0
Cargo.toml|[dependencies]\n# axum = "0.7"\ntower = "0.4"
Cargo.toml|[package]\nname = "my-axum-app"
Cargo.toml|[package.metadata.warp.config]\nx = 1
Cargo.toml|[dependencies.axum] garbage\nversion = "0.7"
compose.yaml|services:\n  db:\n    ports:\n      - "5432:5432"
SPECS
  fixture empty
  check_not_web "empty directory"
}

@test "each of the four compose filenames with an HTTP port is a web app" {
  local f n=0
  for f in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    n=$((n + 1))
    fixture "compose$n"
    printf 'services:\n  web:\n    ports:\n      - "8080:80"\n' >| "$FIX/$f"
    check_web "$f" docker_http
  done
}

@test "outside a git repository setup.md checks the current directory" {
  fixture nogit
  printf '{"dependencies":{"vue":"3"}}\n' >| "$FIX/package.json"
  local sh
  for sh in $SHELLS; do
    probe "$FIX" "$sh"
    [[ "$SETUP_OUT" == *"checked: $FIX)" ]] || { echo "$sh: $SETUP_OUT"; return 1; }
  done
  fixture nogit-empty
  probe "$FIX" bash
  [[ "$SETUP_OUT" == "is_web: false (checked: $FIX)" ]]
}

@test "inside a git repository setup.md checks the repository root" {
  fixture git
  git -C "$FIX" init -q
  mkdir -p "$FIX/sub"
  printf '{"dependencies":{"vue":"3"}}\n' >| "$FIX/package.json"
  local sh root
  root=$(cd "$FIX" && git rev-parse --show-toplevel)
  for sh in $SHELLS; do
    SETUP_OUT=$(cd "$FIX/sub" && "$sh" "$SETUP_BLOCK")
    [[ "$SETUP_OUT" == "is_web: true (signals: node; checked: $root)" ]] || { echo "$sh: $SETUP_OUT"; return 1; }
  done
}

@test "the two copies agree on a repository with several signals" {
  fixture multi
  printf '{"dependencies":{"express":"4"}}\n' >| "$FIX/package.json"
  printf 'gem "rails"\n' >| "$FIX/Gemfile"
  printf 'app = "x"\n' >| "$FIX/fly.toml"
  local sh
  for sh in $SHELLS; do
    probe "$FIX" "$sh"
    [[ "$SETUP_OUT" == "is_web: true (signals: node rails paas(fly.toml);"* ]] || { echo "$sh: $SETUP_OUT"; return 1; }
    [[ "$ALL_OUT" == *"web_signal_count:              3"* ]] || { echo "$sh: $ALL_OUT"; return 1; }
  done
}
