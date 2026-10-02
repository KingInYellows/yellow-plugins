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

@test "rp_sibling_file prefers the source tree sibling" {
  mkdir -p "$BATS_TEST_TMPDIR/plugins/me" "$BATS_TEST_TMPDIR/plugins/other/lib"
  : >| "$BATS_TEST_TMPDIR/plugins/other/lib/x.sh"
  run rp_sibling_file "$BATS_TEST_TMPDIR/plugins/me" other lib/x.sh
  [ "$status" -eq 0 ]
  [ "$output" = "$BATS_TEST_TMPDIR/plugins/me/../other/lib/x.sh" ]
}

@test "rp_sibling_file falls back to the newest numeric version in the cache layout" {
  c="$BATS_TEST_TMPDIR/cache/mkt"
  mkdir -p "$c/me/1.0.0" "$c/other/1.9.0/lib" "$c/other/1.10.0/lib" "$c/other/2.0.0-rc/lib" "$c/other/latest/lib"
  for v in 1.9.0 1.10.0 latest; do : >| "$c/other/$v/lib/x.sh"; done
  run rp_sibling_file "$c/me/1.0.0" other lib/x.sh
  [ "$status" -eq 0 ]
  [ "$output" = "$c/me/1.0.0/../../other/1.10.0/lib/x.sh" ]
}

@test "rp_sibling_file fails when no sibling has the file" {
  mkdir -p "$BATS_TEST_TMPDIR/plugins/me"
  run rp_sibling_file "$BATS_TEST_TMPDIR/plugins/me" other lib/x.sh
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
