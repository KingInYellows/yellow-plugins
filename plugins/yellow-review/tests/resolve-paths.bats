#!/usr/bin/env bats
# Unit tests for lib/resolve-paths.sh (canonical paths, deny list, runners)

LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-paths.sh"

setup() {
  # shellcheck source=../lib/resolve-paths.sh
  . "$LIB"
  cd "$BATS_TEST_TMPDIR" && git init -q repo && cd repo
}

@test "rp_canonical accepts plain repo-relative paths" {
  rp_canonical src/a.ts
  rp_canonical -dash.txt
  rp_canonical 'src/$(x).txt'
}

@test "rp_canonical rejects dot, empty and escaping segments" {
  for p in '' / /etc/passwd ./a a/./b a//b a/ .. ../a a/../b a/.. .; do
    run rp_canonical "$p"
    [ "$status" -ne 0 ] || { echo "accepted: $p"; false; }
  done
  run rp_canonical "$(printf 'a\nb')"
  [ "$status" -ne 0 ]
}

@test "rp_denied matches the deny list case-insensitively" {
  for p in .github/workflows/ci.yml .GitHub/workflows/ci.yml .claude/settings.json .Claude/x \
           yellow-plugins.local.md CLAUDE.md AGENTS.md .mcp.json src/.env config/.env.prod \
           deploy/Dockerfile keys/server.PEM infra/prod.tfvars secrets.yaml Jenkinsfile; do
    rp_denied "$p" || { echo "not denied: $p"; false; }
  done
}

@test "rp_denied allows ordinary files, including nested CLAUDE.md docs" {
  for p in src/a.ts README.md plugins/x/CLAUDE.md docs/environment.md; do
    run rp_denied "$p"
    [ "$status" -ne 0 ] || { echo "denied: $p"; false; }
  done
}

@test "rp_runner flags files hooks or verify commands execute" {
  for p in package.json web/package.json pnpm-lock.yaml Makefile conftest.py tests/conftest.py \
           vitest.config.ts .pre-commit-config.yaml lefthook.yml .lintstagedrc.json \
           scripts/build.sh .husky/pre-commit; do
    rp_runner "$p" || { echo "not a runner: $p"; false; }
  done
  git config core.hooksPath .githooks
  rp_runner .githooks/pre-commit
}

@test "rp_runner leaves ordinary sources alone" {
  for p in src/a.ts src/scripts.ts plugins/x/scripts/tool README.md; do
    run rp_runner "$p"
    [ "$status" -ne 0 ] || { echo "runner: $p"; false; }
  done
}
