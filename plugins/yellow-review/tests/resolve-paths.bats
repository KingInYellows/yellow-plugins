#!/usr/bin/env bats
# Unit tests for lib/resolve-paths.sh (canonical paths, deny list, runners)

bats_require_minimum_version 1.5.0

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
           deploy/Dockerfile .cursor/rules/a.mdc .codex/config.toml .agents/skills/x.md \
           .gemini/settings.json .windsurf/rules/a.md .cline/x.md GEMINI.md .cursorrules \
           .windsurfrules .clinerules copilot-instructions.md pkg/.cursor/x pkg/GEMINI.md; do
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
           src/dockerfiles/a.md src/envfile compose.yml.md \
           src/secrets/a.md src/a.pemx src/a.keys src/a.tfvars.json .mcp.json.bak \
           src/.cursorx/a src/cursor/a src/.codexy/a src/agents/a.md src/.geminis/a src/windsurf/a \
           src/gemini.md.txt src/.cursorrules.bak src/clinerules src/copilot-instructions.txt; do
    run rp_denied "$p"
    [ "$status" -ne 0 ] || { echo "denied: $p"; false; }
  done
}

@test "rp_runner flags files hooks or verify commands execute" {
  for p in package.json web/package.json pnpm-lock.yaml Makefile conftest.py tests/conftest.py \
           vitest.config.ts .pre-commit-config.yaml lefthook.yml .lintstagedrc.json \
           scripts/build.sh .husky/pre-commit web/.husky/pre-push .npmrc .yarnrc.yml \
           justfile Rakefile Taskfile.yml pyproject.toml setup.py tox.ini build.rs \
           .cargo/config.toml .envrc .eslintrc.json .prettierrc \
           build.gradle app/build.gradle.kts settings.gradle settings.gradle.kts gradlew gradlew.bat \
           build.sbt pom.xml Gemfile Gemfile.lock composer.json composer.lock \
           mygem.gemspec Cargo.toml crates/x/Cargo.toml cargo.lock CMakeLists.txt meson.build \
           .rspec spec/spec_helper.rb spec/rails_helper.rb test/test_helper.rb jest.setup.ts \
           src/setupTests.ts vitest.setup.js karma.conf.js phpunit.xml phpunit.xml.dist phpunit.dist.xml \
           BUILD.GRADLE GEMFILE mix.exs Package.swift build.zig build.zig.zon App.csproj lib/x.fsproj \
           y.vbproj Directory.Build.props Directory.Build.targets deno.json deno.jsonc bunfig.toml; do
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
           plugins/x/skills/y/scripts/tool packages/x/scripts/gen.sh \
           go.mod requirements.txt pkg/__init__.py docs/build.gradle.md docs/Gemfile.md \
           src/Cargo.toml.md src/test_helpers.ts src/spec_helper.md src/setup_tests.ts \
           src/jest-setup.ts src/gradle.ts src/pom.xml.md src/phpunit.md \
           xscripts/a.sh src/mix.exs.md src/package.swift.md src/build.zig.md a.csprojx src/deno.json.bak \
           src/bunfig.md src/.huskyx/a src/cargo/a; do
    run rp_runner "$p"
    [ "$status" -ne 0 ] || { echo "runner: $p"; false; }
  done
}

@test "rp_runner flags every remaining table entry" {
  for p in package-lock.json npm-shrinkwrap.json yarn.lock bun.lock bun.lockb .pnpmfile.cjs .yarnrc \
           mise.toml .mise.toml GNUmakefile setup.cfg pytest.ini noxfile.py test/test_helper.exs \
           test_helper.py jest.setup.js jest.setup.mjs jest.setup.cts jest.setup.jsx jest.setup.tsx \
           vitest.setup.cjs vitest.setup.mts vitest.setup.ts vitest.setup.tsx setupTests.js \
           setupTests.mjs setupTests.cts setupTests.jsx setupTests.tsx lefthook.yaml lefthook-local.yml \
           .lintstagedrc .babelrc.json .mocharc.yml .eslintrc a.config.js Taskfile.yaml \
           .husky/x .cargo/x pkg/.cargo/config.toml Cargo.lock scripts/a/b.sh; do
    rp_runner "$p" || { echo "not a runner: $p"; false; }
  done
}

@test "rp_runner fails closed when git config cannot be read" {
  printf '[core\n' >| .git/config
  rp_runner src/a.ts
}

@test "rp_runner treats an unset core.hooksPath as no hooks directory" {
  run rp_runner .githooks/pre-commit
  [ "$status" -eq 1 ]
}

@test "rp_tree_changes lists tracked, staged and untracked changes NUL-delimited" {
  git config user.email t@t && git config user.name t
  printf a >| a.txt && printf b >| 'b c.txt' && git add . && git commit -qm init
  printf a2 >| a.txt
  printf n >| new.txt
  printf s >| staged.txt && git add staged.txt
  rp_tree_changes "$BATS_TEST_TMPDIR/out"
  [ "$(tr '\0' '\n' <"$BATS_TEST_TMPDIR/out" | sort | paste -sd,)" = "a.txt,new.txt,staged.txt" ]
}

@test "rp_tree_changes fails and keeps git's first error line when git cannot list" {
  # No commits yet: `git diff HEAD` fails.
  run --separate-stderr rp_tree_changes "$BATS_TEST_TMPDIR/out"
  [ "$status" -ne 0 ]
  [[ "$stderr" == "rp_tree_changes: "?* ]]
  [ "$(printf '%s\n' "$stderr" | wc -l)" -eq 1 ]
}

@test "rp_assert_only_listed accepts listed paths and an empty change set" {
  : >| "$BATS_TEST_TMPDIR/c"
  rp_assert_only_listed "$BATS_TEST_TMPDIR/c"
  printf 'a.txt\0dir/b.txt\0' >| "$BATS_TEST_TMPDIR/c"
  rp_assert_only_listed "$BATS_TEST_TMPDIR/c" dir/b.txt a.txt
}

@test "rp_assert_only_listed prints the first unlisted path and fails" {
  printf 'a.txt\0z.txt\0y.txt\0' >| "$BATS_TEST_TMPDIR/c"
  run rp_assert_only_listed "$BATS_TEST_TMPDIR/c" a.txt
  [ "$status" -eq 1 ]
  [ "$output" = z.txt ]
}

@test "rp_assert_only_listed compares names with a newline literally" {
  nl=$'x\ny'
  printf '%s\0' "$nl" >| "$BATS_TEST_TMPDIR/c"
  # The two lines of the name are not separate allowlist entries.
  run rp_assert_only_listed "$BATS_TEST_TMPDIR/c" x y
  [ "$status" -eq 1 ]
  [ "$output" = "$nl" ]
  rp_assert_only_listed "$BATS_TEST_TMPDIR/c" "$nl"
}

@test "rp_assert_only_listed handles a final entry without a trailing NUL" {
  printf 'a.txt\0b.txt' >| "$BATS_TEST_TMPDIR/c"
  run rp_assert_only_listed "$BATS_TEST_TMPDIR/c" a.txt
  [ "$status" -eq 1 ]
  [ "$output" = b.txt ]
}

@test "rp_read_file_list appends non-empty lines, including an unterminated last line" {
  printf 'a.txt\n\nb c.txt\nlast' >| "$BATS_TEST_TMPDIR/l"
  RP_FILES=(pre)
  rp_read_file_list "$BATS_TEST_TMPDIR/l"
  [ "${#RP_FILES[@]}" -eq 4 ]
  [ "${RP_FILES[1]}" = a.txt ] && [ "${RP_FILES[2]}" = "b c.txt" ] && [ "${RP_FILES[3]}" = last ]
}

@test "rp_read_file_list rejects a missing file and a directory" {
  RP_FILES=()
  run rp_read_file_list "$BATS_TEST_TMPDIR/nope"
  [ "$status" -eq 1 ]
  run rp_read_file_list "$BATS_TEST_TMPDIR"
  [ "$status" -eq 1 ]
}

@test "rp_denied matches trusted directory names themselves (tracked symlinks), not only descendants" {
  for d in .github .circleci .git .claude .vscode .devcontainer .idea .cursor .codex .agents .gemini .windsurf .cline; do
    for p in "$d" "x/$d" "x/y/$d" "$(rp_lower "$d" | tr 'a-z' 'A-Z')" "x/${d^^}"; do
      rp_denied "$p" || { echo "not denied: $p"; false; }
    done
  done
}

@test "rp_runner matches .husky and .cargo directory names themselves" {
  for p in .husky x/.husky .cargo x/.cargo .HUSKY; do
    rp_runner "$p" || { echo "not a runner: $p"; false; }
  done
}

@test "rp_runner flags the resolve runtime scripts and libraries" {
  for p in plugins/yellow-review/skills/pr-review-workflow/scripts/commit-resolve-fixes \
           plugins/yellow-review/skills/pr-review-workflow/scripts/run-verify-command \
           plugins/yellow-review/skills/pr-review-workflow/scripts/sub/dir/tool \
           plugins/yellow-review/lib/resolve-paths.sh plugins/yellow-review/lib/verify-run.sh \
           plugins/yellow-review/lib/gh-graphql.sh plugins/yellow-review/lib/review-ledger.sh \
           plugins/yellow-review/hooks/scripts/session-start.sh \
           Plugins/Yellow-Review/Lib/resolve-text.sh; do
    rp_runner "$p" || { echo "not a runner: $p"; false; }
  done
}

@test "rp_runner leaves other yellow-review sources and other plugins' scripts alone" {
  for p in plugins/yellow-review/agents/a.md plugins/yellow-review/commands/review/resolve.md \
           plugins/yellow-review/skills/pr-review-workflow/references/resolve/dispositions.md \
           plugins/yellow-other/lib/x.sh plugins/yellow-other/skills/y/scripts/tool \
           plugins/yellow-reviewer/lib/x.sh; do
    run rp_runner "$p"
    [ "$status" -ne 0 ] || { echo "runner: $p"; false; }
  done
}

@test "rp_runner treats every ancestor prefix of a nested core.hooksPath as a runner" {
  for hp in .hooks/bin "$(pwd -P)/.hooks/bin" ./.hooks/bin/; do
    git config core.hooksPath "$hp"
    for p in .hooks .hooks/bin .hooks/bin/pre-commit; do
      rp_runner "$p" || { echo "not a runner: $p (hooksPath=$hp)"; false; }
    done
    for p in .hooksx .hooksx/bin src/a.ts; do
      run rp_runner "$p"
      [ "$status" -ne 0 ] || { echo "runner: $p (hooksPath=$hp)"; false; }
    done
  done
}

@test "rp_runner flags sibling runtime files the commit script executes" {
  for p in plugins/github-workflow/lib/github-stack-runtime.js \
           plugins/github-workflow/lib/sub/x.js \
           Plugins/GitHub-Workflow/Lib/github-stack-runtime.js \
           plugins/yellow-core/lib/compound-staging.sh; do
    rp_runner "$p" || { echo "not a runner: $p"; false; }
  done
}

@test "rp_runner leaves near-miss sibling runtime paths alone" {
  for p in plugins/github-workflowx/lib/x.js plugins/github-workflow/libx/x.js \
           plugins/github-workflow/commands/x.md \
           plugins/yellow-core/lib/stack-operation-registry.js \
           plugins/yellow-core/lib/compound-staging.sh.bak \
           plugins/yellow-corex/lib/compound-staging.sh; do
    run rp_runner "$p"
    [ "$status" -ne 0 ] || { echo "runner: $p"; false; }
  done
}

@test "rp_runner flags the YELLOW_REVIEW_GITHUB_STACK_RUNTIME file inside the repository" {
  mkdir -p tools
  : >| tools/custom-runtime.js
  for ov in "$(pwd -P)/tools/custom-runtime.js" tools/custom-runtime.js ./tools/../tools/custom-runtime.js; do
    export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$ov"
    rp_runner tools/custom-runtime.js || { echo "not a runner with override=$ov"; false; }
    rp_runner Tools/Custom-Runtime.js || { echo "not a runner (case) with override=$ov"; false; }
    run rp_runner tools/other.js
    [ "$status" -ne 0 ] || { echo "runner: tools/other.js with override=$ov"; false; }
    run rp_runner tools/custom-runtime.js.bak
    [ "$status" -ne 0 ]
  done
}

@test "rp_runner follows a symlinked runtime override to the repository file" {
  mkdir -p tools
  : >| tools/custom-runtime.js
  ln -s "$(pwd -P)/tools/custom-runtime.js" "$BATS_TEST_TMPDIR/linked.js"
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$BATS_TEST_TMPDIR/linked.js"
  rp_runner tools/custom-runtime.js
}

@test "rp_runner ignores a runtime override outside the repository or unset" {
  : >| "$BATS_TEST_TMPDIR/runtime.js"
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$BATS_TEST_TMPDIR/runtime.js"
  run rp_runner runtime.js
  [ "$status" -ne 0 ]
  run rp_runner src/a.ts
  [ "$status" -ne 0 ]
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$BATS_TEST_TMPDIR/missing-dir/runtime.js"
  run rp_runner runtime.js
  [ "$status" -ne 0 ]
  unset YELLOW_REVIEW_GITHUB_STACK_RUNTIME
  run rp_runner tools/custom-runtime.js
  [ "$status" -ne 0 ]
}

# hooks_repo: a repository with one commit, cwd at its root.
hooks_repo() {
  git config user.email t@t.com && git config user.name T && git config commit.gpgsign false
  printf 'x\n' >| a.txt
  git add a.txt && git commit -q -m init
  OUT="$BATS_TEST_TMPDIR/hooks.out"
}

@test "rp_hooks_untracked leaves the default hooks directory and a missing one alone" {
  hooks_repo
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 1 ]
  git config core.hooksPath nowhere
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 1 ]
}

@test "rp_hooks_untracked names an in-tree hooks directory holding an ignored or untracked file" {
  hooks_repo
  mkdir -p .hooks/sub
  printf '#!/bin/sh\n' >| .hooks/pre-commit
  git config core.hooksPath .hooks
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 0 ]
  [ "$output" = ".hooks" ]
  printf '.hooks/\n' >> .git/info/exclude
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 0 ]
  [ "$output" = ".hooks" ]
  git config core.hooksPath "$(pwd -P)/.hooks/sub/../"
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 0 ]
  [ "$output" = ".hooks" ]
}

@test "rp_hooks_untracked allows a hooks directory whose files are all tracked" {
  hooks_repo
  mkdir -p .hooks
  printf '#!/bin/sh\n' >| .hooks/pre-commit
  git add .hooks && git commit -q -m hooks
  git config core.hooksPath .hooks
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 1 ]
  # An ignored sibling below it is not.
  mkdir -p .hooks/_
  printf 'x\n' >| .hooks/_/h
  printf '.hooks/_/\n' >> .git/info/exclude
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 0 ]
}

@test "rp_hooks_untracked reports a tracked in-tree hook hidden from status as unverifiable (4)" {
  hooks_repo
  mkdir -p .hooks
  printf '#!/bin/sh\n' >| .hooks/pre-commit
  printf '#!/bin/sh\n' >| .hooks/commit-msg
  git add .hooks && git commit -q -m hooks
  git config core.hooksPath .hooks
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 1 ]
  for flag in assume-unchanged skip-worktree; do
    git update-index "--$flag" .hooks/pre-commit
    printf 'echo edited\n' >> .hooks/pre-commit
    [ -z "$(git status --porcelain)" ]
    run rp_hooks_untracked "$OUT"
    [ "$status" -eq 4 ] || { echo "status $status for $flag"; false; }
    [ "$output" = ".hooks" ]
    git update-index "--no-$flag" .hooks/pre-commit
    git checkout -q -- .hooks/pre-commit
    run rp_hooks_untracked "$OUT"
    [ "$status" -eq 1 ]
  done
  # An untracked file still wins: it is refused, not just unverified.
  git update-index --assume-unchanged .hooks/commit-msg
  printf 'x\n' >| .hooks/extra
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 0 ]
}

@test "rp_hooks_untracked reports a hook outside the working tree or in .git/hooks as unverifiable (4)" {
  hooks_repo
  mkdir -p "$BATS_TEST_TMPDIR/ext"
  git config core.hooksPath "$BATS_TEST_TMPDIR/ext"
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 1 ]
  printf '#!/bin/sh\n' >| "$BATS_TEST_TMPDIR/ext/pre-commit.sample"
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 1 ]
  printf '#!/bin/sh\n' >| "$BATS_TEST_TMPDIR/ext/pre-commit"
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 4 ]
  [ "$output" = "external" ]
  git config --unset core.hooksPath
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 1 ]
  printf '#!/bin/sh\n' >| .git/hooks/pre-commit
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 4 ]
  [ "$output" = "git-dir" ]
}

@test "rp_hooks_untracked treats a repository-root hooks path as holding untracked files" {
  hooks_repo
  printf '#!/bin/sh\n' >| pre-commit
  git config core.hooksPath .
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 0 ]
  [ "$output" = "." ]
}

@test "rp_hooks_untracked fails closed outside a repository" {
  cd "$BATS_TEST_TMPDIR"
  mkdir plain && cd plain
  GIT_CEILING_DIRECTORIES="$BATS_TEST_TMPDIR" run rp_hooks_untracked "$BATS_TEST_TMPDIR/out"
  [ "$status" -eq 2 ]
}

# rp_ignored_changed_since: times are set with touch -t so the tests do not
# depend on clock granularity. Old files predate the marker; new ones follow it.
ignored_repo() {
  printf 'node_modules/\n*.cache\n' >| .gitignore
  mkdir -p node_modules/.bin src
  printf 'old\n' >| node_modules/.bin/runner
  printf 'old\n' >| src/gen.cache
  touch -t 201901010000 node_modules/.bin/runner src/gen.cache
  MARKER="$BATS_TEST_TMPDIR/marker"
  SCRATCH="$BATS_TEST_TMPDIR/scratch"
  touch -t 202001010000 "$MARKER"
}

@test "rp_ignored_changed_since returns 0 when every ignored file predates the marker" {
  ignored_repo
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "rp_ignored_changed_since returns 1 and names an ignored file newer than the marker" {
  ignored_repo
  printf 'new\n' >| node_modules/.bin/runner
  printf 'new\n' >| src/gen.cache
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [[ "$output" == *node_modules/.bin/runner* ]]
  [[ "$output" == *src/gen.cache* ]]
  [[ "$output" != *new* ]]
}

@test "rp_ignored_changed_since ignores the ruvector coedit-sessions log but not its siblings" {
  ignored_repo
  printf '.ruvector/\n' >> .gitignore
  mkdir -p .ruvector/coedit-sessions
  printf 'old\n' >| .ruvector/coedit-sessions/s1.json
  printf 'old\n' >| .ruvector/hook.sh
  touch -t 201901010000 .ruvector/coedit-sessions/s1.json .ruvector/hook.sh
  printf 'new\n' >| .ruvector/coedit-sessions/s1.json
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  printf 'new\n' >| .ruvector/hook.sh
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$output" = .ruvector/hook.sh ]
}

@test "rp_ignored_changed_since ignores coedit-sessions through a .ruvector symlink but not its siblings" {
  ignored_repo
  printf '.ruvector\n' >> .gitignore
  store="$BATS_TEST_TMPDIR/store"
  mkdir -p "$store/coedit-sessions"
  printf 'old\n' >| "$store/coedit-sessions/s1.json"
  printf 'old\n' >| "$store/hook.sh"
  touch -t 201901010000 "$store/coedit-sessions/s1.json" "$store/hook.sh"
  ln -s "$store" .ruvector
  touch -h -t 201901010000 .ruvector
  printf 'new\n' >| "$store/coedit-sessions/s1.json"
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  printf 'new\n' >| "$store/hook.sh"
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$output" = .ruvector ]
}

@test "rp_ignored_changed_since works from a subdirectory and with a relative marker" {
  ignored_repo
  printf 'new\n' >| node_modules/.bin/runner
  cd src
  run rp_ignored_changed_since ../../marker "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$output" = node_modules/.bin/runner ]
}

@test "rp_ignored_changed_since caps the listing at 20 paths" {
  ignored_repo
  for i in $(seq 1 40); do printf 'x\n' >| "node_modules/.bin/f$i"; done
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$(printf '%s\n' "$output" | wc -l)" -le 20 ]
}

@test "rp_ignored_changed_since judges a symlink by its own mtime" {
  ignored_repo
  ln -s runner node_modules/.bin/old-link
  touch -h -t 201901010000 node_modules/.bin/old-link
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  ln -s /nonexistent node_modules/.bin/new-link
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$output" = node_modules/.bin/new-link ]
}

@test "rp_ignored_changed_since skips .git directories inside an ignored tree" {
  ignored_repo
  mkdir -p node_modules/pkg/.git
  printf 'new\n' >| node_modules/pkg/.git/config
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
}

@test "rp_ignored_changed_since shows control characters in a path as ?" {
  ignored_repo
  printf 'x\n' >| "$(printf 'node_modules/a\033b')"
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$output" = 'node_modules/a?b' ]
}

@test "rp_ignored_changed_since ignores a non-regular ignored entry" {
  ignored_repo
  mkfifo node_modules/pipe
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
}

@test "rp_ignored_changed_since fails closed on a missing, non-regular or symlinked marker" {
  ignored_repo
  run rp_ignored_changed_since "$BATS_TEST_TMPDIR/absent" "$SCRATCH"
  [ "$status" -eq 2 ]
  mkdir "$BATS_TEST_TMPDIR/dir-marker"
  run rp_ignored_changed_since "$BATS_TEST_TMPDIR/dir-marker" "$SCRATCH"
  [ "$status" -eq 2 ]
  ln -s "$MARKER" "$BATS_TEST_TMPDIR/link-marker"
  run rp_ignored_changed_since "$BATS_TEST_TMPDIR/link-marker" "$SCRATCH"
  [ "$status" -eq 2 ]
  chmod 000 "$MARKER"
  if [ ! -r "$MARKER" ]; then
    run rp_ignored_changed_since "$MARKER" "$SCRATCH"
    [ "$status" -eq 2 ]
  fi
  chmod 600 "$MARKER"
}

@test "rp_ignored_changed_since fails closed outside a repository" {
  ignored_repo
  cd "$BATS_TEST_TMPDIR"
  mkdir plain && cd plain
  GIT_CEILING_DIRECTORIES="$BATS_TEST_TMPDIR" run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 2 ]
}

# --- A hooks path through a symlink inside the working tree ---
# A resolver can edit through such a link with no change Git reports, to a
# target Git status never lists, and the commit then runs the edit.

# plant_hook_dir <dir>: an executable pre-commit hook in <dir> (created).
plant_hook_dir() {
  mkdir -p "$1"
  printf '#!/bin/sh\n' >| "$1/pre-commit"
  chmod +x "$1/pre-commit"
}

@test "rp_hooks_untracked refuses a relative hooks path that is a symlink to an external directory (3)" {
  hooks_repo
  plant_hook_dir "$BATS_TEST_TMPDIR/ext-hooks"
  ln -s "$BATS_TEST_TMPDIR/ext-hooks" .hooks
  git config core.hooksPath .hooks
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 3 ]
  [ "$output" = ".hooks" ]
  # A tracked symlink is the same: the target is not listed by Git either.
  git add .hooks && git commit -q -m link
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 3 ]
  [ "$output" = ".hooks" ]
}

@test "rp_hooks_untracked refuses an absolute in-tree hooks path through a symlink or a symlinked parent (3)" {
  hooks_repo
  plant_hook_dir "$BATS_TEST_TMPDIR/ext-hooks"
  ln -s "$BATS_TEST_TMPDIR/ext-hooks" .hooks
  git config core.hooksPath "$(pwd -P)/.hooks"
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 3 ]
  [ "$output" = ".hooks" ]
  mkdir "$BATS_TEST_TMPDIR/ext-parent"
  plant_hook_dir "$BATS_TEST_TMPDIR/ext-parent/hooks"
  ln -s "$BATS_TEST_TMPDIR/ext-parent" parent
  git config core.hooksPath "$(pwd -P)/parent/hooks"
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 3 ]
  [ "$output" = "parent" ]
  # The same through a relative path and a `..` segment.
  git config core.hooksPath "parent/hooks/../hooks/"
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 3 ]
  [ "$output" = "parent" ]
}

@test "rp_hooks_untracked refuses a symlink to an in-tree directory too (3)" {
  hooks_repo
  plant_hook_dir real-hooks
  ln -s real-hooks .hooks
  git config core.hooksPath .hooks
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 3 ]
  [ "$output" = ".hooks" ]
}

@test "rp_hooks_untracked refuses a .git/hooks that is a symlink (3)" {
  hooks_repo
  plant_hook_dir "$BATS_TEST_TMPDIR/ext-hooks"
  rm -rf .git/hooks
  ln -s "$BATS_TEST_TMPDIR/ext-hooks" .git/hooks
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 3 ]
  [ "$output" = ".git/hooks" ]
}

@test "rp_hooks_untracked follows a symlink above or outside the working tree" {
  hooks_repo
  plant_hook_dir .hooks
  # A second name for the repository, reached through a symlink outside it.
  ln -s "$(pwd -P)" "$BATS_TEST_TMPDIR/alias"
  git config core.hooksPath "$BATS_TEST_TMPDIR/alias/.hooks"
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 0 ]
  [ "$output" = ".hooks" ]
  # A symlink outside the tree to a directory outside it is still outside.
  plant_hook_dir "$BATS_TEST_TMPDIR/ext-hooks"
  ln -s "$BATS_TEST_TMPDIR/ext-hooks" "$BATS_TEST_TMPDIR/ext-link"
  git config core.hooksPath "$BATS_TEST_TMPDIR/ext-link"
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 4 ]
  [ "$output" = "external" ]
}

@test "rp_hooks_untracked still refuses a plain in-tree untracked hooks directory and allows a tracked one" {
  hooks_repo
  plant_hook_dir .hooks
  git config core.hooksPath .hooks
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 0 ]
  [ "$output" = ".hooks" ]
  git add .hooks && git commit -q -m hooks
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 1 ]
  # The default, real .git/hooks directory is not a symlink either.
  git config --unset core.hooksPath
  run rp_hooks_untracked "$OUT"
  [ "$status" -eq 1 ]
}

# --- rp_ignored_changed_since: the target of an ignored symlink ---
# A write through a symlink changes the target's mtime and not the link's, so
# the target is judged as well. real/ is an untracked, unignored directory:
# only the symlinks are ignored.

link_repo() {
  ignored_repo
  mkdir -p real/dir
  printf 'old\n' >| real/tool
  printf 'old\n' >| real/dir/inner
  touch -t 201901010000 real/tool real/dir/inner
}

# old_link <target> <link>: an ignored symlink that predates the marker.
old_link() {
  ln -s "$1" "$2"
  touch -h -t 201901010000 "$2"
}

@test "rp_ignored_changed_since refuses a symlink whose file target changed after the marker" {
  link_repo
  old_link ../../real/tool node_modules/.bin/tool-link
  old_link ../real/tool src/tool.cache
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  printf 'new\n' >| real/tool
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [[ "$output" == *node_modules/.bin/tool-link* ]]
  [[ "$output" == *src/tool.cache* ]]
  [[ "$output" != *new* ]]
}

@test "rp_ignored_changed_since refuses a symlink to a directory holding a file changed after the marker" {
  link_repo
  old_link ../../real/dir node_modules/.bin/dir-link
  old_link ../real/dir src/dir.cache
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  printf 'new\n' >| real/dir/inner
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [[ "$output" == *node_modules/.bin/dir-link* ]]
  [[ "$output" == *src/dir.cache* ]]
}

@test "rp_ignored_changed_since judges a top-level ignored symlink to an absolute external target" {
  link_repo
  mkdir "$BATS_TEST_TMPDIR/outside"
  printf 'old\n' >| "$BATS_TEST_TMPDIR/outside/tool"
  touch -t 201901010000 "$BATS_TEST_TMPDIR/outside/tool"
  old_link "$BATS_TEST_TMPDIR/outside/tool" src/abs.cache
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  printf 'new\n' >| "$BATS_TEST_TMPDIR/outside/tool"
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$output" = src/abs.cache ]
}

@test "rp_ignored_changed_since follows a chain of symlinks to the final target" {
  link_repo
  old_link ../../real/tool node_modules/.bin/hop2
  old_link hop2 node_modules/.bin/hop1
  printf 'new\n' >| real/tool
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [[ "$output" == *node_modules/.bin/hop1* ]]
}

@test "rp_ignored_changed_since does not follow symlinks nested below a target directory" {
  link_repo
  mkdir "$BATS_TEST_TMPDIR/deep"
  printf 'new\n' >| "$BATS_TEST_TMPDIR/deep/file"
  ln -s "$BATS_TEST_TMPDIR/deep" real/dir/nested
  touch -h -t 201901010000 real/dir/nested
  touch -t 201901010000 real/dir
  old_link ../real/dir src/dir.cache
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
}

@test "rp_ignored_changed_since treats a dangling symlink target as no change" {
  link_repo
  old_link /nonexistent-target-dir/tool node_modules/.bin/dangling
  old_link ../real/missing src/dangling.cache
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "rp_ignored_changed_since ignores a symlink target that is not a regular file or directory" {
  link_repo
  mkfifo real/pipe
  old_link ../real/pipe src/pipe.cache
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
}

@test "rp_ignored_changed_since fails closed when a symlink target directory cannot be walked" {
  link_repo
  mkdir real/locked
  printf 'x\n' >| real/locked/f
  touch -t 201901010000 real/locked/f real/locked
  old_link ../real/locked src/locked.cache
  chmod 000 real/locked
  if [ -r real/locked ]; then
    chmod 755 real/locked
    skip "directory permissions are not enforced (running as root?)"
  fi
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  chmod 755 real/locked
  [ "$status" -eq 2 ]
}

@test "rp_ignored_changed_since fails closed when a symlink target hides behind a directory that cannot be searched" {
  link_repo
  mkdir real/hidden
  printf 'x\n' >| real/hidden/tool
  old_link ../real/hidden/tool src/hidden.cache
  old_link ../../real/hidden/tool node_modules/.bin/hidden
  chmod 000 real/hidden
  if [ -x real/hidden ]; then
    chmod 755 real/hidden
    skip "directory permissions are not enforced (running as root?)"
  fi
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  chmod 755 real/hidden
  [ "$status" -eq 2 ]
}

@test "rp_ignored_changed_since shows control characters in a symlink path as ? and caps the listing" {
  link_repo
  old_link ../real/tool "$(printf 'src/a\033b.cache')"
  printf 'new\n' >| real/tool
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$output" = 'src/a?b.cache' ]
  for i in $(seq 1 30); do old_link ../../real/tool "node_modules/.bin/l$i"; done
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$(printf '%s\n' "$output" | wc -l)" -le 20 ]
}

@test "rp_ignored_changed_since leaves no scratch file behind" {
  link_repo
  old_link ../../real/tool node_modules/.bin/tool-link
  export TMPDIR="$BATS_TEST_TMPDIR/tmp"
  mkdir -p "$TMPDIR"
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  [ -z "$(find "$TMPDIR" -type f)" ]
}

# --- Symlinked ancestors of the runtime override ---

# override_link_repo: tools -> real-tools (a symlinked directory) holding rt.js.
override_link_repo() {
  mkdir -p real-tools evil src
  : >| real-tools/rt.js
  : >| evil/rt.js
  ln -s real-tools tools
}

@test "rp_runner flags a symlinked ancestor directory of the runtime override" {
  override_link_repo
  for ov in "$(pwd -P)/tools/rt.js" tools/rt.js ./src/../tools/rt.js; do
    export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$ov"
    rp_runner tools || { echo "tools not a runner with override=$ov"; false; }
    rp_runner Tools || { echo "Tools not a runner (case) with override=$ov"; false; }
    rp_runner real-tools/rt.js || { echo "real-tools/rt.js not a runner with override=$ov"; false; }
    run rp_runner evil/rt.js
    [ "$status" -ne 0 ] || { echo "runner: evil/rt.js with override=$ov"; false; }
    run rp_runner src/a.ts
    [ "$status" -ne 0 ]
  done
}

@test "rp_runtime_override_rels lists each lexical node and symlink hop inside the repository" {
  override_link_repo
  ln -s ../tools/rt.js src/rt-link.js
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="src/rt-link.js"
  run rp_runtime_override_rels
  [ "$status" -eq 0 ]
  [ "$output" = $'src\nsrc/rt-link.js\ntools\nreal-tools\nreal-tools/rt.js' ] || { echo "$output"; false; }
}

@test "rp_runtime_override_rels follows an in-repo symlink chain through an outside directory without printing it" {
  override_link_repo
  ln -s "$(pwd -P)/tools" "$BATS_TEST_TMPDIR/outside-link"
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$BATS_TEST_TMPDIR/outside-link/rt.js"
  run rp_runtime_override_rels
  [ "$status" -eq 0 ]
  [ "$output" = $'tools\nreal-tools\nreal-tools/rt.js' ] || { echo "$output"; false; }
}

@test "rp_runtime_override_rels prints nothing for an override outside the repository" {
  mkdir -p "$BATS_TEST_TMPDIR/ext/real"
  : >| "$BATS_TEST_TMPDIR/ext/real/rt.js"
  ln -s real "$BATS_TEST_TMPDIR/ext/dir"
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$BATS_TEST_TMPDIR/ext/dir/rt.js"
  run rp_runtime_override_rels
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "rp_runtime_override_rels stops at a symlink loop" {
  ln -s b a && ln -s a b
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="a/rt.js"
  run rp_runtime_override_rels
  [ "$status" -eq 0 ]
}

@test "rp_runtime_override_rels keeps a plain in-repo file working" {
  mkdir -p tools
  : >| tools/rt.js
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  run rp_runtime_override_rels
  [ "$output" = $'tools\ntools/rt.js' ]
  rp_runner tools/rt.js
}

# --- rp_runtime_override_rels raw mode, rp_runtime_override_untrusted, lgit_nohooks ---

commit_repo() {
  git config user.email test@test.com
  git config user.name Test
  git config commit.gpgsign false
  git add -A && git commit -q -m "chore: initial"
}

@test "rp_runtime_override_rels raw keeps the case of each node" {
  mkdir -p Tools && : >| Tools/Rt.js
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="Tools/Rt.js"
  run rp_runtime_override_rels raw
  [ "$status" -eq 0 ]
  [ "$output" = $'Tools\nTools/Rt.js' ]
  run rp_runtime_override_rels
  [ "$output" = $'tools\ntools/rt.js' ]
}

@test "rp_runtime_override_untrusted is quiet and 1 when the variable is unset" {
  unset YELLOW_REVIEW_GITHUB_STACK_RUNTIME
  run rp_runtime_override_untrusted
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "rp_runtime_override_untrusted is 1 for an override outside the repository" {
  : >| "$BATS_TEST_TMPDIR/outside.js"
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="$BATS_TEST_TMPDIR/outside.js"
  run rp_runtime_override_untrusted
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "rp_runtime_override_untrusted is 1 for a clean tracked file in a tracked directory" {
  mkdir -p Tools && printf '// rt\n' >| Tools/Rt.js
  commit_repo
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="Tools/Rt.js"
  run rp_runtime_override_untrusted
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "rp_runtime_override_untrusted prints the path and exits 0 for an ignored, untracked, modified or staged file" {
  mkdir -p tools && printf '// rt\n' >| tools/rt.js && : >| keep
  commit_repo
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  # modified
  printf '// edited\n' >> tools/rt.js
  run rp_runtime_override_untrusted
  [ "$status" -eq 0 ]
  [ "$output" = tools/rt.js ]
  # staged
  git add tools/rt.js
  run rp_runtime_override_untrusted
  [ "$status" -eq 0 ]
  [ "$output" = tools/rt.js ]
  # untracked and ignored
  git rm -q --cached tools/rt.js
  run rp_runtime_override_untrusted
  [ "$status" -eq 0 ]
  [ "$output" = tools/rt.js ]
  printf 'tools/\n' >> .git/info/exclude
  run rp_runtime_override_untrusted
  [ "$status" -eq 0 ]
  [ "$output" = tools/rt.js ]
}

@test "rp_runtime_override_untrusted refuses an assume-unchanged or skip-worktree edit" {
  mkdir -p tools && printf '// rt\n' >| tools/rt.js
  commit_repo
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  printf '// edited\n' >> tools/rt.js
  git update-index --assume-unchanged tools/rt.js
  run rp_runtime_override_untrusted
  [ "$status" -eq 0 ]
  [ "$output" = tools/rt.js ]
  git update-index --no-assume-unchanged --skip-worktree tools/rt.js
  run rp_runtime_override_untrusted
  [ "$status" -eq 0 ]
  [ "$output" = tools/rt.js ]
}

@test "rp_runtime_override_untrusted judges an in-repo symlink on the way, not only the final file" {
  mkdir -p real && printf '// rt\n' >| real/rt.js
  ln -s real tools
  commit_repo
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  run rp_runtime_override_untrusted
  [ "$status" -eq 1 ]
  # Repoint the tracked symlink: modified, so refused and named.
  mkdir -p evil && printf '// evil\n' >| evil/rt.js
  ln -sfn evil tools
  run rp_runtime_override_untrusted
  [ "$status" -eq 0 ]
  [ "$output" = tools ]
}

@test "rp_runtime_override_untrusted judges an ignored file behind a tracked symlink" {
  mkdir -p real && : >| real/keep
  ln -s real tools
  commit_repo
  printf '// rt\n' >| real/rt.js
  printf 'real/rt.js\n' >> .git/info/exclude
  export YELLOW_REVIEW_GITHUB_STACK_RUNTIME="tools/rt.js"
  run rp_runtime_override_untrusted
  [ "$status" -eq 0 ]
  [ "$output" = real/rt.js ]
}

@test "lgit_nohooks runs no hook, from .git/hooks or an ignored core.hooksPath, where lgit does" {
  printf 'a\n' >| f.txt
  commit_repo
  for dir in .git/hooks .hooks; do
    mkdir -p "$dir"
    printf '#!/bin/sh\necho ran >> "%s/hook.log"\n' "$BATS_TEST_TMPDIR" >| "$dir/post-checkout"
    chmod +x "$dir/post-checkout"
  done
  printf '.hooks/\n' >> .git/info/exclude
  for hp in "" .hooks; do
    [ -z "$hp" ] || git config core.hooksPath "$hp"
    rm -f "$BATS_TEST_TMPDIR/hook.log"
    printf 'b\n' >| f.txt
    lgit_nohooks checkout -q HEAD -- f.txt
    [ ! -e "$BATS_TEST_TMPDIR/hook.log" ]
    [ "$(cat f.txt)" = a ]
    printf 'b\n' >| f.txt
    lgit checkout -q HEAD -- f.txt
    [ -e "$BATS_TEST_TMPDIR/hook.log" ]
  done
}

@test "lgit_nohooks keeps pathspecs literal" {
  mkdir -p src && printf 'a\n' >| 'src/*' && printf 'b\n' >| src/real.txt
  run lgit_nohooks add -n -- 'src/*'
  [ "$status" -eq 0 ]
  [[ "$output" == *"'src/*'"* ]]
  [[ "$output" != *real.txt* ]]
}
