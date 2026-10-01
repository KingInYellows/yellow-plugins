#!/usr/bin/env bats
# Unit tests for lib/resolve-paths.sh (canonical paths, deny list, runners)

LIB="$(cd "$(dirname "${BATS_TEST_DIRNAME}")" && pwd)/lib/resolve-paths.sh"

setup() {
  export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
  # shellcheck source=../lib/resolve-paths.sh
  . "$LIB"
  cd "$BATS_TEST_TMPDIR" && git init -q repo && cd repo
}

@test "rp_canonical accepts plain repo-relative paths" {
  rp_canonical src/a.ts
  rp_canonical 'src/$(x).txt'
  rp_canonical a-dash.txt
}

@test "rp_canonical rejects root-level and nested names starting with a hyphen" {
  for p in -dash.txt -rf src/-dash.txt a/b/-c -a/b; do
    run rp_canonical "$p"
    [ "$status" -ne 0 ] || { echo "accepted: $p"; false; }
  done
}

@test "rp_canonical rejects dot, empty and escaping segments" {
  for p in '' / /etc/passwd ./a a/./b a//b a/ .. ../a a/../b a/.. .; do
    run rp_canonical "$p"
    [ "$status" -ne 0 ] || { echo "accepted: $p"; false; }
  done
  run rp_canonical "$(printf 'a\nb')"
  [ "$status" -ne 0 ]
}

@test "rp_denied matches every deny-list pattern, case-insensitively" {
  for p in .github/workflows/ci.yml .GitHub/workflows/ci.yml .circleci/config.yml .git/config \
           .claude/settings.json .Claude/x .vscode/tasks.json .devcontainer/devcontainer.json \
           .idea/runConfigurations/x.xml yellow-plugins.local.md CLAUDE.md AGENTS.md .mcp.json \
           .gitlab-ci.yml .travis.yml .drone.yml Jenkinsfile azure-pipelines.yml \
           bitbucket-pipelines.yml Dockerfile Dockerfile.prod app.dockerfile \
           docker-compose.yml docker-compose.override.yaml compose.yml compose.yaml \
           .env .env.prod src/.env config/.env.prod secrets.yaml keys/server.PEM \
           keys/a.key certs/a.p12 certs/a.pfx infra/prod.tfvars infra/terraform.tfstate \
           deploy/Dockerfile; do
    rp_denied "$p" || { echo "not denied: $p"; false; }
  done
}

@test "rp_denied matches deny-listed names at any depth" {
  for p in pkg/.github/workflows/ci.yml a/b/.claude/settings.json plugins/x/.claude/x.md \
           web/.vscode/settings.json a/.circleci/config.yml a/.git/hooks/pre-commit \
           a/.devcontainer/x.json a/.idea/x.xml plugins/x/CLAUDE.md docs/AGENTS.md \
           a/b/.mcp.json pkg/yellow-plugins.local.md; do
    rp_denied "$p" || { echo "not denied: $p"; false; }
  done
}

@test "rp_denied allows ordinary files and near misses" {
  for p in src/a.ts README.md docs/environment.md src/github/x.ts src/claude.md.bak \
           docs/CLAUDE.md.txt a/claudex.md src/.githubx/a src/my.claude/a src/vscode/a \
           src/dockerfiles/a.md src/envfile src/.environment compose.yml.md \
           src/secrets/a.md src/a.pemx src/a.keys src/a.tfvars.json .mcp.json.bak; do
    run rp_denied "$p"
    [ "$status" -ne 0 ] || { echo "denied: $p"; false; }
  done
}

@test "rp_runner flags files hooks or verify commands execute" {
  for p in package.json web/package.json pnpm-lock.yaml Makefile conftest.py tests/conftest.py \
           vitest.config.ts .pre-commit-config.yaml lefthook.yml .lintstagedrc.json \
           scripts/build.sh .husky/pre-commit web/.husky/pre-push .npmrc .yarnrc.yml \
           justfile Rakefile Taskfile.yml pyproject.toml setup.py tox.ini build.rs \
           .cargo/config.toml .envrc .eslintrc.json .prettierrc; do
    rp_runner "$p" || { echo "not a runner: $p"; false; }
  done
  git config core.hooksPath .githooks
  rp_runner .githooks/pre-commit
  rp_runner .GitHooks/pre-commit
  git config core.hooksPath "$(pwd -P)/hooks-abs"
  rp_runner hooks-abs/pre-commit
}

@test "rp_runner treats root-level files as hooks when core.hooksPath is the repository root" {
  git config core.hooksPath "$(pwd -P)"
  rp_runner pre-commit
  run rp_runner src/pre-commit
  [ "$status" -ne 0 ]
}

@test "rp_runner normalises a relative core.hooksPath that is the repository root" {
  for hp in . ./ .// ././ "$(pwd -P)/" "$(pwd -P)/."; do
    git config core.hooksPath "$hp"
    rp_runner pre-commit || { echo "not a runner with hooksPath=$hp"; false; }
    run rp_runner src/pre-commit
    [ "$status" -ne 0 ] || { echo "runner (nested) with hooksPath=$hp"; false; }
  done
}

@test "rp_runner normalises ./-prefixed and trailing-slash relative hooks paths" {
  for hp in ./.githooks .githooks/ ./.githooks/ ././.githooks; do
    git config core.hooksPath "$hp"
    rp_runner .githooks/pre-commit || { echo "not a runner with hooksPath=$hp"; false; }
    run rp_runner other/pre-commit
    [ "$status" -ne 0 ] || { echo "runner (other) with hooksPath=$hp"; false; }
  done
}

@test "rp_runner leaves ordinary sources alone" {
  for p in src/a.ts src/scripts.ts README.md src/transcripts/a.md \
           plugins/x/skills/y/scripts/tool packages/x/scripts/gen.sh; do
    run rp_runner "$p"
    [ "$status" -ne 0 ] || { echo "runner: $p"; false; }
  done
}
