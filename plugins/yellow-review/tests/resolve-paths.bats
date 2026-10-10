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

# A full temporary filesystem: the collector's output file (the third mktemp
# call, after the hits file and the symlink list) is a symlink to
# /dev/full, so every write to it fails. A lost write must not read as "no
# change".
full_outfile_shim() {
  [ -c /dev/full ] || skip "needs /dev/full"
  mkdir -p "$BATS_TEST_TMPDIR/shim"
  REAL_MKTEMP=$(type -P mktemp)
  cat >| "$BATS_TEST_TMPDIR/shim/mktemp" <<SH
#!/bin/sh
n=\$(cat "$BATS_TEST_TMPDIR/shim/count" 2>/dev/null || echo 0)
n=\$((n + 1)); echo "\$n" >| "$BATS_TEST_TMPDIR/shim/count"
if [ "\$n" -eq 3 ]; then
  ln -s /dev/full "$BATS_TEST_TMPDIR/full.\$n" && echo "$BATS_TEST_TMPDIR/full.\$n"
else
  exec "$REAL_MKTEMP" "\$@"
fi
SH
  chmod +x "$BATS_TEST_TMPDIR/shim/mktemp"
}

@test "rp_ignored_changed_since fails closed when a changed name in an ignored directory cannot be recorded" {
  ignored_repo
  printf 'new\n' >| node_modules/.bin/runner
  full_outfile_shim
  PATH="$BATS_TEST_TMPDIR/shim:$PATH" run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 2 ]
}

@test "rp_ignored_changed_since fails closed when a changed ignored file cannot be recorded" {
  ignored_repo
  printf 'new\n' >| src/gen.cache
  full_outfile_shim
  PATH="$BATS_TEST_TMPDIR/shim:$PATH" run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 2 ]
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

@test "rp_ignored_changed_since ignores the ruvector coedit.json pair store but not its siblings" {
  ignored_repo
  printf '.ruvector/\n' >> .gitignore
  mkdir -p .ruvector
  printf '{}\n' >| .ruvector/coedit.json
  printf 'old\n' >| .ruvector/intelligence.json
  touch -t 201901010000 .ruvector/coedit.json .ruvector/intelligence.json
  printf '{"version":1}\n' >| .ruvector/coedit.json
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  # A same-named file elsewhere is not the hook's store.
  mkdir -p node_modules/.ruvector
  printf 'new\n' >| node_modules/.ruvector/coedit.json
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$output" = node_modules/.ruvector/coedit.json ]
  rm -rf node_modules/.ruvector
  printf 'new\n' >| .ruvector/intelligence.json
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$output" = .ruvector/intelligence.json ]
}

@test "rp_ignored_changed_since still judges a symlink at .ruvector/coedit.json" {
  ignored_repo
  printf '.ruvector/\n' >> .gitignore
  mkdir -p .ruvector
  ln -s ../node_modules/.bin/runner .ruvector/coedit.json
  touch -h -t 201901010000 .ruvector/coedit.json
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  # A write through the link lands on an executable: it must still count.
  printf 'new\n' >| node_modules/.bin/runner
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [[ "$output" == *node_modules/.bin/runner* ]]
}

@test "rp_ignored_changed_since ignores coedit.json listed on its own, not as part of .ruvector/" {
  ignored_repo
  # Only the file is ignored, so git lists it rather than the directory.
  printf '.ruvector/coedit.json\n' >> .gitignore
  mkdir -p .ruvector
  printf 'new\n' >| .ruvector/coedit.json
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "rp_ignored_changed_since ignores vitest's results cache but not the rest of node_modules" {
  ignored_repo
  mkdir -p node_modules/.vite/vitest node_modules/.vite/deps pkg/node_modules/.vite/vitest
  printf '{}\n' >| node_modules/.vite/vitest/results.json
  printf '{}\n' >| pkg/node_modules/.vite/vitest/results.json
  printf 'old\n' >| node_modules/.vite/deps/chunk.js
  touch -t 201901010000 node_modules/.vite/vitest/results.json pkg/node_modules/.vite/vitest/results.json node_modules/.vite/deps/chunk.js
  # What a vitest run leaves behind (root and workspace package).
  printf '{"version":"1.6.0","results":{}}\n' >| node_modules/.vite/vitest/results.json
  printf '{"version":"1.6.0","results":{}}\n' >| pkg/node_modules/.vite/vitest/results.json
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  # vitest's pre-bundled deps are code: still the ignored-file stop.
  printf 'new\n' >| node_modules/.vite/deps/chunk.js
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$output" = node_modules/.vite/deps/chunk.js ]
}

@test "rp_ignored_changed_since still judges a symlink at vitest's results cache" {
  ignored_repo
  mkdir -p node_modules/.vite/vitest
  ln -s ../../.bin/runner node_modules/.vite/vitest/results.json
  touch -h -t 201901010000 node_modules/.vite/vitest/results.json
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  printf 'new\n' >| node_modules/.bin/runner
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [[ "$output" == *node_modules/.bin/runner* ]]
}

@test "rp_ignored_changed_since ignores co-edit state through a .ruvector symlink but not its siblings" {
  ignored_repo
  printf '.ruvector\n' >> .gitignore
  store="$BATS_TEST_TMPDIR/store"
  mkdir -p "$store/coedit-sessions"
  printf 'old\n' >| "$store/coedit-sessions/s1.json"
  printf 'old\n' >| "$store/hook.sh"
  touch -t 201901010000 "$store/coedit-sessions/s1.json" "$store/hook.sh"
  ln -s "$store" .ruvector
  printf '{}\n' >| "$store/coedit.json"
  touch -t 201901010000 "$store/coedit.json"
  touch -h -t 201901010000 .ruvector
  printf 'new\n' >| "$store/coedit-sessions/s1.json"
  printf '{"version":1}\n' >| "$store/coedit.json"
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

@test "harden_git_config returns and forces fsmonitor, untrackedCache and safe.bareRepository" {
  marker="$BATS_TEST_TMPDIR/fsm-ran"
  printf '#!/bin/sh\ntouch "%s"\nexit 0\n' "$marker" >| "$BATS_TEST_TMPDIR/fsm.sh"
  chmod +x "$BATS_TEST_TMPDIR/fsm.sh"
  git config core.fsmonitor "$BATS_TEST_TMPDIR/fsm.sh"
  set -e
  harden_git_config 2>"$BATS_TEST_TMPDIR/harden.err"
  [ "$(git config --get core.fsmonitor)" = false ]
  [ "$(git config --get core.untrackedCache)" = false ]
  [ "$(git config --get safe.bareRepository)" = explicit ]
  [ -z "$(git config --get core.hooksPath 2>/dev/null || true)" ]
  [ ! -s "$BATS_TEST_TMPDIR/harden.err" ]
  git status --porcelain >/dev/null
  [ ! -e "$marker" ]
  GIT_CONFIG_COUNT=zz
  if harden_git_config; then
    echo "a non-numeric GIT_CONFIG_COUNT returned success"
    return 1
  fi
  set +e
  [[ "$YR_HARDEN_MSG" == *"GIT_CONFIG_COUNT is not a number, so core.fsmonitor cannot be disabled"* ]]
}

@test "harden_git_config full refuses a local transport, credential or non-LFS filter key; revert scope refuses only the filter" {
  for kv in core.sshCommand core.askPass core.gitProxy credential.helper 'credential.https://user:pw@example.com.helper' filter.evil.clean filter.evil.smudge filter.evil.process; do
    git config --local "$kv" 'touch /never'
    ( rc=0; harden_git_config full || rc=$?; [ "$rc" -eq 1 ] \
        && [[ "$YR_HARDEN_MSG" != *"touch /never"* && "$YR_HARDEN_MSG" != *pw@* ]] ) \
      || { echo "full did not refuse (or leaked a value): $kv"; false; }
    case "$kv" in
      filter.*) want=1 ;;
      *) want=0 ;;
    esac
    ( rc=0; harden_git_config revert || rc=$?; [ "$rc" -eq "$want" ] ) \
      || { echo "revert scope returned the wrong status for $kv (want $want)"; false; }
    git config --local --unset "$kv"
  done
}

@test "harden_git_config names a credential URL key without its userinfo" {
  git config --local 'credential.https://user:secretpw@example.com.helper' x
  rc=0; harden_git_config full || rc=$?
  [ "$rc" -eq 1 ]
  [[ "$YR_HARDEN_MSG" == *"credential.<url>.helper"* ]]
  [[ "$YR_HARDEN_MSG" != *secretpw* ]]
}

@test "harden_git_config redacts a credential key whose URL contains a space" {
  git config --local 'credential.https://user:secretpw@example.com/a b.helper' x
  rc=0; harden_git_config full || rc=$?
  [ "$rc" -eq 1 ]
  [[ "$YR_HARDEN_MSG" == *"credential.<url>.helper"* ]]
  [[ "$YR_HARDEN_MSG" != *secretpw* ]]
}

@test "harden_git_config redacts a filter key whose subsection contains whitespace" {
  git config --local 'filter.sk-secretword x.clean' 'touch /never'
  for scope in full revert; do
    rc=0; harden_git_config "$scope" || rc=$?
    [ "$rc" -eq 1 ]
    [[ "$YR_HARDEN_MSG" == *"filter.<driver>.clean|smudge|process"* ]]
    [[ "$YR_HARDEN_MSG" != *secretword* ]]
  done
}

@test "harden_git_config allows the stock Git LFS filter commands and refuses a changed one" {
  git config --local filter.lfs.clean 'git-lfs clean -- %f'
  git config --local filter.lfs.smudge 'git-lfs smudge -- %f'
  git config --local filter.lfs.process 'git-lfs filter-process'
  ( rc=0; harden_git_config full || rc=$?; [ "$rc" -eq 0 ] )
  ( rc=0; harden_git_config revert || rc=$?; [ "$rc" -eq 0 ] )
  git config --local filter.lfs.clean 'sh -c evil'
  ( rc=0; harden_git_config full || rc=$?; [ "$rc" -eq 1 ] )
  ( rc=0; harden_git_config revert || rc=$?; [ "$rc" -eq 1 ] )
}

@test "harden_git_config refuses repository-local Git LFS settings that name a program, in full and revert" {
  git config --local filter.lfs.clean 'git-lfs clean -- %f'
  git config --local filter.lfs.smudge 'git-lfs smudge -- %f'
  git config --local filter.lfs.process 'git-lfs filter-process'
  mkdir -p tools
  : >| tools/evil
  # git lowercases the section and variable, so mixed-case spellings are the same keys
  for setting in "LFS.StandaloneTransferAgent evil" "lfs.customtransfer.evil.path $PWD/tools/evil" \
                 "lfs.extension.ext.clean $PWD/tools/evil"; do
    git config --local "${setting%% *}" "${setting#* }"
    for scope in full revert; do
      rc=0; ( harden_git_config "$scope" || { [[ "$YR_HARDEN_MSG" == *lfs* && "$YR_HARDEN_MSG" != *"$PWD/tools"* ]] || exit 2; exit 1; } ) || rc=$?
      [ "$rc" -eq 1 ] || { echo "$scope accepted or leaked: ${setting%% *}" >&2; return 1; }
    done
    git config --local --unset-all "${setting%% *}"
  done
  # Without them the stock filter is still allowed, and lfs.url is not a program.
  git config --local lfs.url https://example.com/lfs
  ( rc=0; harden_git_config full || rc=$?; [ "$rc" -eq 0 ] )
  # A global LFS transfer agent is the user's own.
  git config --local --unset lfs.url
  printf '[lfs]\n\tstandalonetransferagent = mine\n' >| "$BATS_TEST_TMPDIR/gcfg"
  ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/gcfg"; rc=0; harden_git_config full || rc=$?; [ "$rc" -eq 0 ] )
}

# One classifier (yr_cfg_key_runs_command) for every scope: each key is
# refused in the repository's own config and in a global config that includes
# a file inside the worktree. The table is the keys that name a program.
CFG_CMD_KEYS=(
  "filter.evil.clean|sh evil" "filter.evil.smudge|sh evil" "filter.evil.process|sh evil"
  "merge.m.driver|sh evil %O %A %B" "diff.d.command|sh evil" "diff.d.textconv|sh evil" "diff.external|sh evil"
  "core.sshCommand|sh evil" "core.askPass|evil" "core.gitProxy|evil" "core.editor|evil" "core.pager|evil"
  "core.alternateRefsCommand|evil" "credential.helper|evil" "credential.https://h.example/.helper|evil"
  "sequence.editor|evil" "uploadpack.packObjectsHook|evil" "remote.o.uploadpack|evil" "remote.o.receivepack|evil"
  "remote.o.vcs|evil" "difftool.t.cmd|evil" "mergetool.t.path|evil" "trailer.t.cmd|evil"
  "lfs.customtransfer.e.path|evil" "lfs.standalonetransferagent|e" "lfs.extension.e.clean|evil"
  "alias.a|!sh evil" "submodule.s.update|!sh evil" "pager.log|sh evil" "url.ext::sh evil.insteadOf|https://h.example/"
)

@test "yr_cfg_key_runs_command matches every key in the table, in any case, and not the ordinary ones" {
  for entry in "${CFG_CMD_KEYS[@]}"; do
    key=${entry%%|*}; val=${entry#*|}
    yr_cfg_key_runs_command "$key" "$val" || { echo "not matched: $key" >&2; return 1; }
    up=$(printf '%s' "$key" | tr 'a-z' 'A-Z')
    yr_cfg_key_runs_command "$up" "$val" || { echo "not matched (upper): $up" >&2; return 1; }
  done
  for entry in "user.name|x" "core.hooksPath|.hooks" "core.fsmonitor|false" "lfs.url|https://x" "alias.s|status" \
               "submodule.s.update|checkout" "pager.log|true" "pager.log|false" "branch.main.remote|origin" "url.https://h/.insteadOf|x"; do
    yr_cfg_key_runs_command "${entry%%|*}" "${entry#*|}" && { echo "matched: $entry" >&2; return 1; }
  done
  # the rollback modes judge the checkout subset of the same list
  yr_cfg_key_runs_command filter.x.clean evil checkout
  yr_cfg_key_runs_command lfs.standalonetransferagent e checkout
  ! yr_cfg_key_runs_command merge.m.driver evil checkout
  ! yr_cfg_key_runs_command core.sshCommand evil checkout
}

@test "harden_git_config refuses every table key set in the repository config, naming the key and not the value" {
  for entry in "${CFG_CMD_KEYS[@]}"; do
    key=${entry%%|*}; val=${entry#*|}
    git config --local "$key" "$val"
    rc=0; ( harden_git_config full || { [[ "$YR_HARDEN_MSG" != *evil* && "$YR_HARDEN_MSG" != *h.example* ]] || exit 1; exit 2; } ) || rc=$?
    [ "$rc" -eq 2 ] || { echo "full not refused or leaked: $key (rc=$rc)" >&2; return 1; }
    git config --local --unset-all "$key"
  done
}

@test "harden_git_config refuses every table key reached through a global include that points inside the worktree" {
  mkdir -p ignored
  printf '[include]\n\tpath = %s/ignored/inc\n' "$PWD" >| "$BATS_TEST_TMPDIR/global"
  for entry in "${CFG_CMD_KEYS[@]}"; do
    key=${entry%%|*}; val=${entry#*|}
    : >| ignored/inc
    git config -f ignored/inc "$key" "$val"
    rc=0; ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/global"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 1 ] || { echo "include not refused: $key" >&2; return 1; }
  done
}

@test "harden_git_config accepts ordinary keys, a merge driver in a global file outside the worktree, and tolerates gpg.program locally" {
  mkdir -p ignored "$BATS_TEST_TMPDIR/out"
  git config --local core.hooksPath .hooks
  git config --local pager.log true
  git config --local alias.s status
  git config --local lfs.url https://example.com/lfs
  git config --local gpg.program gpg
  ( rc=0; harden_git_config full || rc=$?; [ "$rc" -eq 0 ] )
  git config -f "$BATS_TEST_TMPDIR/out/inc" merge.m.driver 'mymerge %O %A %B'
  printf '[include]\n\tpath = %s/out/inc\n' "$BATS_TEST_TMPDIR" >| "$BATS_TEST_TMPDIR/global"
  ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/global"; rc=0; harden_git_config full || rc=$?; [ "$rc" -eq 0 ] )
  # a gpg program in a global file inside the worktree is not the user's own
  git config -f ignored/inc gpg.program evil
  printf '[include]\n\tpath = %s/ignored/inc\n' "$PWD" >| "$BATS_TEST_TMPDIR/global"
  ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/global"; rc=0; harden_git_config full || rc=$?; [ "$rc" -eq 1 ] )
}

@test "harden_git_config judges an include whose path holds a tab, a newline or a percent sign" {
  mkdir -p ignored
  for name in $'inc\tx' $'inc\ty\tz' $'inc\nnl' 'inc%09x' 'inc%25'; do
    : >| "ignored/$name"
    git config -f "ignored/$name" core.sshCommand 'sh evil'
    : >| "$BATS_TEST_TMPDIR/global"
    git config -f "$BATS_TEST_TMPDIR/global" include.path "$PWD/ignored/$name"
    rc=0; ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/global"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 1 ] || { printf 'accepted: %q\n' "$name" >&2; return 1; }
    rm -f "ignored/$name"
  done
  # an include outside the worktree with a tab in its name is still the user's own
  : >| "$BATS_TEST_TMPDIR/out"$'\t'x
  git config -f "$BATS_TEST_TMPDIR/out"$'\t'x core.sshCommand 'ssh -x'
  : >| "$BATS_TEST_TMPDIR/global"
  git config -f "$BATS_TEST_TMPDIR/global" include.path "$BATS_TEST_TMPDIR/out"$'\t'x
  rc=0; ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/global"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
}

@test "harden_git_config refuses a stock LFS filter command followed by a second line" {
  git config --local filter.lfs.smudge 'git-lfs smudge -- %f'
  git config --local filter.lfs.process 'git-lfs filter-process'
  for first in 'git-lfs clean -- %f'; do
    git config --local filter.lfs.clean "$first"$'\n'"touch $BATS_TEST_TMPDIR/lfs-ran"
    for scope in full revert; do
      rc=0; harden_git_config "$scope" || rc=$?
      [ "$rc" -eq 1 ] || { echo "$scope accepted a multiline LFS value"; false; }
      [[ "$YR_HARDEN_MSG" == *"filter.<driver>."* ]]
      [[ "$YR_HARDEN_MSG" != *lfs-ran* ]]
    done
  done
  git config --local filter.lfs.clean $'git-lfs clean -- %f\nlocal\tfilter.lfs.clean git-lfs clean -- %f'
  rc=0; harden_git_config full || rc=$?
  [ "$rc" -eq 1 ]
}

@test "harden_git_config forces signing off with a note only when local gpg config exists, in full scope" {
  rc=0; harden_git_config full || rc=$?
  [ "$rc" -eq 0 ]
  [ -z "$YR_HARDEN_NOTE" ]
  git config --local gpg.program /nonexistent-gpg
  git config --local commit.gpgsign true
  rc=0; harden_git_config full 2>"$BATS_TEST_TMPDIR/harden.err" || rc=$?
  [ "$rc" -eq 0 ]
  [[ "$YR_HARDEN_NOTE" == *"the commit is made unsigned"* ]]
  [ ! -s "$BATS_TEST_TMPDIR/harden.err" ]
  [ "$(git config --bool --get commit.gpgsign)" = false ]
  [ "$(git config --bool --get push.gpgsign)" = false ]
  [ "$(git config --bool --get log.showsignature)" = false ]
}

@test "harden_git_config revert scope leaves signing alone" {
  git config --local gpg.program /nonexistent-gpg
  git config --local commit.gpgsign true
  rc=0; harden_git_config revert || rc=$?
  [ "$rc" -eq 0 ]
  [ -z "$YR_HARDEN_NOTE" ]
  [ "$(git config --bool --get commit.gpgsign)" = true ]
}

@test "harden_git_config appends to a preset GIT_CONFIG_COUNT and harden_git_config_for_verify drops only safe.bareRepository" {
  export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=Preset
  rc=0; harden_git_config revert || rc=$?
  [ "$rc" -eq 0 ]
  [ "$GIT_CONFIG_COUNT" -eq 4 ]
  [ "$(git config --get user.name)" = Preset ]
  [ "$(git config --get safe.bareRepository)" = explicit ]
  harden_git_config_for_verify
  [ "$GIT_CONFIG_COUNT" -eq 3 ]
  [ "$(git config --get user.name)" = Preset ]
  [ "$(git config --get core.fsmonitor)" = false ]
  [ "$(git config --get core.untrackedCache)" = false ]
  rc=0; git config --get safe.bareRepository >/dev/null || rc=$?
  [ "$rc" -eq 1 ]
  [ -z "${GIT_CONFIG_KEY_3:-}" ]
}

@test "harden_git_config_for_verify lets git open a bare repository that the override refuses" {
  git init -q --bare "$BATS_TEST_TMPDIR/bare.git"
  rc=0; harden_git_config revert || rc=$?
  [ "$rc" -eq 0 ]
  cd "$BATS_TEST_TMPDIR/bare.git"
  rc=0; git rev-parse --git-dir >/dev/null 2>&1 || rc=$?
  [ "$rc" -ne 0 ]
  harden_git_config_for_verify
  git rev-parse --git-dir >/dev/null
}

@test "yr_safe_path drops an outside directory whose grep, sed or mktemp is a symlink into the worktree" {
  mkdir -p tools "$BATS_TEST_TMPDIR/goodbin" "$BATS_TEST_TMPDIR/badbin"
  printf '#!/bin/sh\nexit 0\n' >| tools/canary
  chmod +x tools/canary
  for tool in grep sed mktemp; do
    # Dangling, so a target created later counts too.
    ln -s "$PWD/tools/not-yet-$tool" "$BATS_TEST_TMPDIR/badbin/$tool"
    out=$(PATH="$BATS_TEST_TMPDIR/badbin:$BATS_TEST_TMPDIR/goodbin:/usr/bin:/bin" yr_safe_path)
    [[ "$out" != *badbin* ]] || { echo "kept: $tool: $out" >&2; return 1; }
    [[ "$out" == *goodbin* ]]
    rm -f "$BATS_TEST_TMPDIR/badbin/$tool"
  done
}

@test "yr_safe_path keeps an outside directory whose tools are symlinks to files outside the worktree" {
  mkdir -p "$BATS_TEST_TMPDIR/okbin"
  ln -s "$(command -v grep)" "$BATS_TEST_TMPDIR/okbin/grep"
  out=$(PATH="$BATS_TEST_TMPDIR/okbin:/usr/bin:/bin" yr_safe_path)
  [[ "$out" == "$BATS_TEST_TMPDIR/okbin:"* ]]
}

@test "yr_safe_path drops an outside directory holding only ssh, or any other name, symlinked into the worktree" {
  mkdir -p tools "$BATS_TEST_TMPDIR/goodbin" "$BATS_TEST_TMPDIR/badbin"
  printf '#!/bin/sh\nexit 0\n' >| tools/canary
  chmod +x tools/canary
  # Git spawns ssh, git-credential-*, gpg and pagers by name; no list is complete.
  for tool in ssh git-credential-foo gpg ssh-keygen less zz-any-name; do
    ln -s "$PWD/tools/canary" "$BATS_TEST_TMPDIR/badbin/$tool"
    out=$(PATH="$BATS_TEST_TMPDIR/badbin:$BATS_TEST_TMPDIR/goodbin:/usr/bin:/bin" yr_safe_path)
    [[ "$out" != *badbin* ]] || { echo "kept: $tool: $out" >&2; return 1; }
    [[ "$out" == *goodbin* ]]
    rm -f "$BATS_TEST_TMPDIR/badbin/$tool"
  done
}

@test "yr_safe_path drops a directory with a dangling link into the worktree, or a link to a directory there" {
  mkdir -p tools/sub "$BATS_TEST_TMPDIR/danglebin" "$BATS_TEST_TMPDIR/dirbin"
  ln -s "$PWD/tools/not-yet" "$BATS_TEST_TMPDIR/danglebin/git-credential-foo"
  ln -s "$PWD/tools/sub" "$BATS_TEST_TMPDIR/dirbin/subdir"
  out=$(PATH="$BATS_TEST_TMPDIR/danglebin:$BATS_TEST_TMPDIR/dirbin:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *danglebin* ]]
  [[ "$out" != *dirbin* ]]
  [[ "$out" == "/usr/bin:/bin" || "$out" == "/usr/bin" || "$out" == "/bin" ]]
}

@test "yr_safe_path drops a directory whose link reaches the worktree through a chain or a hidden name" {
  mkdir -p tools "$BATS_TEST_TMPDIR/chainbin" "$BATS_TEST_TMPDIR/hidbin"
  : >| tools/real
  ln -s "$PWD/tools/real" "$BATS_TEST_TMPDIR/hop"
  ln -s "$BATS_TEST_TMPDIR/hop" "$BATS_TEST_TMPDIR/chainbin/ssh"
  ln -s "$PWD/tools/real" "$BATS_TEST_TMPDIR/hidbin/.ssh"
  mkdir -p "$BATS_TEST_TMPDIR/rootbin"
  ln -s "$PWD" "$BATS_TEST_TMPDIR/rootbin/repo"
  out=$(PATH="$BATS_TEST_TMPDIR/chainbin:$BATS_TEST_TMPDIR/hidbin:$BATS_TEST_TMPDIR/rootbin:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *chainbin* ]]
  [[ "$out" != *hidbin* ]]
  [[ "$out" != *rootbin* ]]
}

@test "yr_safe_path keeps an outside directory whose links, whatever their names, point outside the worktree" {
  mkdir -p "$BATS_TEST_TMPDIR/okbin"
  ln -s "$(command -v ls)" "$BATS_TEST_TMPDIR/okbin/ssh"
  ln -s "$(command -v ls)" "$BATS_TEST_TMPDIR/okbin/git-credential-foo"
  ln -s /nonexistent-outside/x "$BATS_TEST_TMPDIR/okbin/dangling-outside"
  ln -s "$BATS_TEST_TMPDIR" "$BATS_TEST_TMPDIR/okbin/a-dir"
  out=$(PATH="$BATS_TEST_TMPDIR/okbin:/usr/bin:/bin" yr_safe_path)
  [[ "$out" == "$BATS_TEST_TMPDIR/okbin:"* ]]
}

@test "yr_safe_path screens a big directory (find path) and both spellings of one bad directory" {
  mkdir -p tools "$BATS_TEST_TMPDIR/bigbad" "$BATS_TEST_TMPDIR/biggood"
  for i in $(seq 1 320); do
    ln -s /usr/bin/true "$BATS_TEST_TMPDIR/bigbad/t$i"
    ln -s /usr/bin/true "$BATS_TEST_TMPDIR/biggood/t$i"
  done
  ln -s "$PWD/tools/none" "$BATS_TEST_TMPDIR/bigbad/ssh"
  ln -s "$BATS_TEST_TMPDIR/bigbad" "$BATS_TEST_TMPDIR/bigbad-again"
  out=$(PATH="$BATS_TEST_TMPDIR/bigbad:$BATS_TEST_TMPDIR/bigbad-again:$BATS_TEST_TMPDIR/biggood:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *bigbad* ]]
  [[ "$out" == "$BATS_TEST_TMPDIR/biggood:"* ]]
  # A good directory reached by two spellings is kept under both.
  ln -s "$BATS_TEST_TMPDIR/biggood" "$BATS_TEST_TMPDIR/biggood-again"
  out=$(PATH="$BATS_TEST_TMPDIR/biggood:$BATS_TEST_TMPDIR/biggood-again" yr_safe_path)
  [ "$out" = "$BATS_TEST_TMPDIR/biggood:$BATS_TEST_TMPDIR/biggood-again" ]
}

@test "yr_safe_path without GNU realpath drops a same-device directory holding a multi-link file, and keeps one without" {
  mkdir -p "$BATS_TEST_TMPDIR/hbin" "$BATS_TEST_TMPDIR/hok"
  : >| "$BATS_TEST_TMPDIR/hbin/a"
  ln "$BATS_TEST_TMPDIR/hbin/a" "$BATS_TEST_TMPDIR/hbin/b"
  : >| "$BATS_TEST_TMPDIR/hok/a"
  yr_helper() { case "$1" in realpath) return 1 ;; *) command -p which "$1" 2>/dev/null || return 1 ;; esac; }
  out=$(PATH="$BATS_TEST_TMPDIR/hbin:$BATS_TEST_TMPDIR/hok:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *hbin* ]]
  [[ ":$out:" == *":$BATS_TEST_TMPDIR/hok:"* ]]
}

@test "yr_safe_path falls back to yr_canon_path per link when no GNU realpath is available" {
  mkdir -p tools "$BATS_TEST_TMPDIR/badbin" "$BATS_TEST_TMPDIR/okbin"
  ln -s "$PWD/tools/none" "$BATS_TEST_TMPDIR/badbin/ssh"
  ln -s "$(command -v ls)" "$BATS_TEST_TMPDIR/okbin/ssh"
  # A fixed-location lookup that finds readlink but not realpath.
  yr_helper() { case "$1" in realpath) return 1 ;; *) command -p which "$1" 2>/dev/null || return 1 ;; esac; }
  out=$(PATH="$BATS_TEST_TMPDIR/badbin:$BATS_TEST_TMPDIR/okbin:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *badbin* ]]
  [[ ":$out:" == *":$BATS_TEST_TMPDIR/okbin:"* ]]
}

@test "yr_safe_path drops an outside directory holding a script whose #! interpreter is inside the worktree" {
  mkdir -p venv "$BATS_TEST_TMPDIR/shbin" "$BATS_TEST_TMPDIR/envbin" "$BATS_TEST_TMPDIR/rel"
  printf '#!/bin/sh\nexit 0\n' >| venv/python
  chmod +x venv/python
  printf '#!%s/venv/python\nprint(1)\n' "$PWD" >| "$BATS_TEST_TMPDIR/shbin/console-script"
  printf '#! /usr/bin/env -S %s/venv/python -u\n' "$PWD" >| "$BATS_TEST_TMPDIR/envbin/other"
  printf '#!venv/python\n' >| "$BATS_TEST_TMPDIR/rel/relative"
  chmod +x "$BATS_TEST_TMPDIR"/shbin/* "$BATS_TEST_TMPDIR"/envbin/* "$BATS_TEST_TMPDIR"/rel/*
  out=$(PATH="$BATS_TEST_TMPDIR/shbin:$BATS_TEST_TMPDIR/envbin:$BATS_TEST_TMPDIR/rel:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *shbin* ]]
  [[ "$out" != *envbin* ]]
  [[ "$out" != *rel* ]]
}

@test "yr_safe_path keeps a directory whose scripts name interpreters outside the worktree, and a non-executable one" {
  mkdir -p venv "$BATS_TEST_TMPDIR/okbin"
  printf '#!/bin/sh\nexit 0\n' >| "$BATS_TEST_TMPDIR/okbin/a"
  printf '#!/usr/bin/env python3\n' >| "$BATS_TEST_TMPDIR/okbin/b"
  printf '#!/usr/bin/env -S sh -c true\n' >| "$BATS_TEST_TMPDIR/okbin/c"
  chmod +x "$BATS_TEST_TMPDIR"/okbin/*
  # Not executable, so never run: its interpreter does not matter.
  printf '#!%s/venv/python\n' "$PWD" >| "$BATS_TEST_TMPDIR/okbin/notes"
  out=$(PATH="$BATS_TEST_TMPDIR/okbin:/usr/bin:/bin" yr_safe_path)
  [[ "$out" == "$BATS_TEST_TMPDIR/okbin:"* ]]
}

@test "yr_safe_path follows an interpreter script's own #! line, to a depth of 4" {
  mkdir -p venv "$BATS_TEST_TMPDIR/nbin" "$BATS_TEST_TMPDIR/interp" "$BATS_TEST_TMPDIR/deep"
  printf '#!/bin/sh\nexit 0\n' >| venv/python
  chmod +x venv/python
  # tool -> outside interpreter script -> in-worktree executable
  printf '#!%s/interp/i1\n' "$BATS_TEST_TMPDIR" >| "$BATS_TEST_TMPDIR/nbin/tool"
  printf '#!%s/venv/python\n' "$PWD" >| "$BATS_TEST_TMPDIR/interp/i1"
  chmod +x "$BATS_TEST_TMPDIR"/nbin/tool "$BATS_TEST_TMPDIR"/interp/i1
  out=$(PATH="$BATS_TEST_TMPDIR/nbin:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *nbin* ]]
  rc=0; PATH="$BATS_TEST_TMPDIR/nbin:$PATH" yr_resolve_tool tool >/dev/null || rc=$?
  [ "$rc" -eq 2 ]
  # a chain of outside scripts that stays outside is kept; one deeper than 4 is not
  printf 'plain\n' >| "$BATS_TEST_TMPDIR/interp/ok"
  chmod +x "$BATS_TEST_TMPDIR/interp/ok"
  prev="$BATS_TEST_TMPDIR/interp/ok"
  for n in 1 2 3 4; do
    printf '#!%s\n' "$prev" >| "$BATS_TEST_TMPDIR/interp/c$n"
    chmod +x "$BATS_TEST_TMPDIR/interp/c$n"
    prev="$BATS_TEST_TMPDIR/interp/c$n"
  done
  printf '#!%s\n' "$prev" >| "$BATS_TEST_TMPDIR/deep/short"
  chmod +x "$BATS_TEST_TMPDIR/deep/short"
  out=$(PATH="$BATS_TEST_TMPDIR/deep:/usr/bin:/bin" yr_safe_path)
  [[ "$out" == "$BATS_TEST_TMPDIR/deep:"* ]]
  printf '#!%s\n' "$BATS_TEST_TMPDIR/interp/c4" >| "$BATS_TEST_TMPDIR/interp/c5"
  printf '#!%s\n' "$BATS_TEST_TMPDIR/interp/c5" >| "$BATS_TEST_TMPDIR/interp/c6"
  chmod +x "$BATS_TEST_TMPDIR"/interp/c5 "$BATS_TEST_TMPDIR"/interp/c6
  printf '#!%s\n' "$BATS_TEST_TMPDIR/interp/c6" >| "$BATS_TEST_TMPDIR/deep/short"
  out=$(PATH="$BATS_TEST_TMPDIR/deep:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *deep* ]]
}

@test "yr_safe_path drops an outside directory holding a hard link to a file inside the worktree" {
  mkdir -p ignored "$BATS_TEST_TMPDIR/hbin" "$BATS_TEST_TMPDIR/hok"
  printf '#!/bin/sh\nexit 0\n' >| ignored/helper
  chmod +x ignored/helper
  ln ignored/helper "$BATS_TEST_TMPDIR/hbin/git-remote-https"
  printf '#!/bin/sh\nexit 0\n' >| "$BATS_TEST_TMPDIR/hok/a"
  chmod +x "$BATS_TEST_TMPDIR/hok/a"
  ln "$BATS_TEST_TMPDIR/hok/a" "$BATS_TEST_TMPDIR/hok/b"
  out=$(PATH="$BATS_TEST_TMPDIR/hbin:$BATS_TEST_TMPDIR/hok:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *hbin* ]]
  # a multi-link file that is not linked into the worktree is fine
  [[ "$out" == "$BATS_TEST_TMPDIR/hok:"* ]]
}

@test "yr_safe_path drops a directory holding a multi-link file when the worktree walk fails part way" {
  mkdir -p "$BATS_TEST_TMPDIR/hok" "$BATS_TEST_TMPDIR/plain"
  : >| "$BATS_TEST_TMPDIR/hok/a"
  ln "$BATS_TEST_TMPDIR/hok/a" "$BATS_TEST_TMPDIR/hok/b"
  : >| "$BATS_TEST_TMPDIR/plain/a"
  # A find that lists the worktree but then exits non-zero, as one does when a
  # directory under it cannot be read.
  printf '#!/bin/sh\n/usr/bin/find "$@"\nrc=$?\ncase " $* " in *" -xdev "*) exit 1 ;; esac\nexit $rc\n' >| "$BATS_TEST_TMPDIR/failfind"
  chmod +x "$BATS_TEST_TMPDIR/failfind"
  yr_helper() { case "$1" in find) printf '%s\n' "$BATS_TEST_TMPDIR/failfind" ;; *) command -p which "$1" 2>/dev/null || return 1 ;; esac; }
  out=$(PATH="$BATS_TEST_TMPDIR/hok:$BATS_TEST_TMPDIR/plain:/usr/bin:/bin" yr_safe_path)
  [[ ":$out:" != *":$BATS_TEST_TMPDIR/hok:"* ]]
  # a directory without a multi-link file does not need the walk
  [[ ":$out:" == *":$BATS_TEST_TMPDIR/plain:"* ]]
}

@test "harden_git_config refuses a global config hard-linked to a file inside the worktree" {
  mkdir -p ignored "$BATS_TEST_TMPDIR/home"
  printf '[core]\n\tsshCommand = true\n' >| ignored/gitcfg
  ln ignored/gitcfg "$BATS_TEST_TMPDIR/home/.gitconfig"
  rc=0; ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/home/.gitconfig"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  rc=0; ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/home/.gitconfig"; harden_git_config full; [[ "$YR_HARDEN_MSG" == *"hard-linked"* ]] ) || rc=$?
  # a multi-link global config that is not linked into the worktree is the user's own
  printf '[core]\n\tsshCommand = ssh -x\n' >| "$BATS_TEST_TMPDIR/home/own"
  ln "$BATS_TEST_TMPDIR/home/own" "$BATS_TEST_TMPDIR/home/own2"
  rc=0; ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/home/own"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
}

@test "yr_resolve_tool refuses a tool that is a hard link to a file inside the worktree (exit 2)" {
  mkdir -p ignored "$BATS_TEST_TMPDIR/hbin"
  printf '#!/bin/sh\nexit 0\n' >| ignored/helper
  chmod +x ignored/helper
  ln ignored/helper "$BATS_TEST_TMPDIR/hbin/mytool"
  rc=0; PATH="$BATS_TEST_TMPDIR/hbin:$PATH" yr_resolve_tool mytool >/dev/null || rc=$?
  [ "$rc" -eq 2 ]
}

@test "a #! optional argument with expansion or glob syntax counts as entering, in awk and in the shell" {
  mkdir -p tools "$BATS_TEST_TMPDIR/xbin" "$BATS_TEST_TMPDIR/okx"
  printf '#!/bin/sh\nexit 0\n' >| tools/evil
  chmod +x tools/evil
  n=0
  for line in '#!/bin/sh -c $PWD/tools/evil' '#!/bin/sh -c `pwd`/tools/evil' '#!/bin/sh -c ~/tools/evil' '#!/bin/sh -c \tools/evil' \
              '#!/usr/bin/env sh -c $PWD/tools/evil' '#!/bin/sh -c ?ools/evil' '#!/bin/sh -c t*/evil' '#!/bin/sh -c [t]ools/evil'; do
    n=$((n + 1))
    printf '%s\n' "$line" >| "$BATS_TEST_TMPDIR/xbin/tool$n"
    chmod +x "$BATS_TEST_TMPDIR/xbin/tool$n"
    yr_file_shebang_enters "$BATS_TEST_TMPDIR/xbin/tool$n" "$PWD" || { echo "shell accepted: $line" >&2; return 1; }
    rm -f "$BATS_TEST_TMPDIR/xbin/tool$n"
    printf '%s\n' "$line" >| "$BATS_TEST_TMPDIR/xbin/only"
    chmod +x "$BATS_TEST_TMPDIR/xbin/only"
    out=$(PATH="$BATS_TEST_TMPDIR/xbin:/usr/bin:/bin" yr_safe_path)
    [[ ":$out:" != *":$BATS_TEST_TMPDIR/xbin:"* ]] || { echo "awk screen kept: $line" >&2; return 1; }
  done
  rm -f "$BATS_TEST_TMPDIR/xbin/only"
  printf '#!/bin/sh -c $PWD/tools/evil\n' >| "$BATS_TEST_TMPDIR/xbin/mytool"
  chmod +x "$BATS_TEST_TMPDIR/xbin/mytool"
  rc=0; PATH="$BATS_TEST_TMPDIR/xbin:$PATH" yr_resolve_tool mytool >/dev/null || rc=$?
  [ "$rc" -eq 2 ]
  # plain optional arguments stay fine
  printf '#!/bin/sh -e\n' >| "$BATS_TEST_TMPDIR/okx/a"
  printf '#!/usr/bin/python3 -u -O\n' >| "$BATS_TEST_TMPDIR/okx/b"
  printf '#!/usr/bin/env python3 -u\n' >| "$BATS_TEST_TMPDIR/okx/c"
  chmod +x "$BATS_TEST_TMPDIR"/okx/*
  out=$(PATH="$BATS_TEST_TMPDIR/okx:/usr/bin:/bin" yr_safe_path)
  [[ ":$out:" == *":$BATS_TEST_TMPDIR/okx:"* ]]
}

@test "yr_safe_path judges a script reached through an outside symlink by its interpreter" {
  mkdir -p venv "$BATS_TEST_TMPDIR/lnbin" "$BATS_TEST_TMPDIR/real"
  printf '#!%s/venv/python\n' "$PWD" >| "$BATS_TEST_TMPDIR/real/tool"
  chmod +x "$BATS_TEST_TMPDIR/real/tool"
  ln -s "$BATS_TEST_TMPDIR/real/tool" "$BATS_TEST_TMPDIR/lnbin/tool"
  out=$(PATH="$BATS_TEST_TMPDIR/lnbin:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *lnbin* ]]
}

@test "yr_resolve_tool refuses an outside script whose #! interpreter is inside the worktree (exit 2)" {
  mkdir -p venv "$BATS_TEST_TMPDIR/shbin"
  printf '#!/bin/sh\nexit 0\n' >| venv/python
  chmod +x venv/python
  for line in "#!$PWD/venv/python" "#!/usr/bin/env $PWD/venv/python"; do
    printf '%s\n' "$line" >| "$BATS_TEST_TMPDIR/shbin/mytool"
    chmod +x "$BATS_TEST_TMPDIR/shbin/mytool"
    rc=0; PATH="$BATS_TEST_TMPDIR/shbin:$PATH" yr_resolve_tool mytool >/dev/null || rc=$?
    [ "$rc" -eq 2 ] || { echo "rc=$rc for $line" >&2; return 1; }
  done
  printf '#!/bin/sh\n' >| "$BATS_TEST_TMPDIR/shbin/mytool"
  rc=0; PATH="$BATS_TEST_TMPDIR/shbin:$PATH" yr_resolve_tool mytool >/dev/null || rc=$?
  [ "$rc" -eq 0 ]
}

@test "harden_git_config refuses a command variable that runs a program inside the worktree, naming the variable only" {
  mkdir -p tools
  printf '#!/bin/sh\nexit 0\n' >| tools/cmd
  chmod +x tools/cmd
  # GIT_SSH, GIT_ASKPASS and SSH_ASKPASS are one program path, judged unsplit
  # (tests below); the multi-word forms apply to the shell command lines.
  for name in GIT_SSH GIT_ASKPASS SSH_ASKPASS; do
    for val in "$PWD/tools/cmd" "tools/cmd" "./tools/cmd" "../repo/tools/cmd"; do
      for scope in full revert; do
        rc=0; ( export "$name=$val"; harden_git_config "$scope" ) || rc=$?
        [ "$rc" -eq 1 ] || { echo "$name=$val ($scope) rc=$rc" >&2; return 1; }
      done
    done
  done
  for name in GIT_SSH_COMMAND GIT_PROXY_COMMAND GIT_EXTERNAL_DIFF \
              GIT_PAGER PAGER GIT_EDITOR EDITOR VISUAL; do
    for val in "$PWD/tools/cmd" "$PWD/tools/cmd -o x" "\"$PWD/tools/cmd\" arg" "tools/cmd" \
               "sh $PWD/tools/cmd" "sh tools/cmd" "sh -c 'exec $PWD/tools/cmd'" "ssh -F $PWD/tools/cmd host" \
               "ssh --config=tools/cmd host" "env X=1 sh '$PWD/tools/cmd'" "less -R !$PWD/tools/cmd"; do
      for scope in full revert; do
        rc=0; ( export "$name=$val"; harden_git_config "$scope" ) || rc=$?
        [ "$rc" -eq 1 ] || { echo "$name=$val ($scope) rc=$rc" >&2; return 1; }
      done
    done
    ( export "$name=$PWD/tools/cmd"; harden_git_config full || [[ "$YR_HARDEN_MSG" == "$name runs"* && "$YR_HARDEN_MSG" != *tools/cmd* ]] )
  done
}

@test "harden_git_config judges every token: logical spelling, a bare first word that is a script entering the worktree" {
  mkdir -p tools venv "$BATS_TEST_TMPDIR/hbin"
  printf '#!/bin/sh\nexit 0\n' >| venv/python
  chmod +x venv/python
  : >| tools/cmd
  printf '#!%s/venv/python\n' "$PWD" >| "$BATS_TEST_TMPDIR/hbin/myhelper"
  chmod +x "$BATS_TEST_TMPDIR/hbin/myhelper"
  # A bare first word resolves through the PATH: a script with an interpreter
  # inside the worktree is refused, a plain one is kept.
  rc=0; ( PATH="$BATS_TEST_TMPDIR/hbin:$PATH"; export GIT_SSH_COMMAND="myhelper -o x"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  rc=0; ( PATH="$BATS_TEST_TMPDIR/hbin:$PATH"; export GIT_PAGER="myhelper"; harden_git_config revert ) || rc=$?
  [ "$rc" -eq 1 ]
  # The logical spelling of the worktree (cwd reached through a symlink).
  ln -s "$PWD" "$BATS_TEST_TMPDIR/lnk"
  rc=0; ( cd "$BATS_TEST_TMPDIR/lnk"; export EDITOR="sh $BATS_TEST_TMPDIR/lnk/tools/cmd"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  rc=0; ( export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.sshCommand GIT_CONFIG_VALUE_0="sh $PWD/tools/cmd"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  rc=0; ( export GIT_CONFIG_PARAMETERS="'core.sshcommand'='sh tools/cmd'"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  # Trusted shell command lines keep working.
  for val in "sh -c true" "less -R" "ssh -F /etc/ssh/ssh_config -o BatchMode=yes" "ssh -i ~/.ssh/id_ed25519" "ssh -o ProxyCommand=nc"; do
    rc=0; ( export GIT_SSH_COMMAND="$val" GIT_PAGER="$val"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 0 ] || { echo "refused: $val" >&2; return 1; }
  done
}

@test "#! lines with env -S, --split-string, clusters and option arguments are parsed, in awk and in the shell" {
  mkdir -p venv
  printf '#!/bin/sh\nexit 0\n' >| venv/python
  chmod +x venv/python
  n=0
  for shebang in "#!/usr/bin/env -S $PWD/venv/python -u" "#!/usr/bin/env -S$PWD/venv/python x" \
                 "#!/usr/bin/env --split-string=$PWD/venv/python x" "#!/usr/bin/env --split-string $PWD/venv/python x" \
                 "#!/usr/bin/env -vS $PWD/venv/python x" "#!/usr/bin/env -vS$PWD/venv/python x" \
                 "#!/usr/bin/env -u FOO $PWD/venv/python" "#!/usr/bin/env -C /tmp $PWD/venv/python" \
                 "#!/usr/bin/env --chdir /tmp --unset=A A=1 $PWD/venv/python" "#!/usr/bin/env -P /usr/bin $PWD/venv/python" \
                 "#!/usr/bin/env -S -u X $PWD/venv/python" "#!/usr/bin/env -S \"$PWD/venv/python\" x" "#!/usr/bin/env -- $PWD/venv/python"; do
    n=$((n + 1))
    d="$BATS_TEST_TMPDIR/sb$n"
    mkdir -p "$d"
    printf '%s\n' "$shebang" >| "$d/tool"
    chmod +x "$d/tool"
    yr_file_shebang_enters "$d/tool" "$PWD" || { echo "shell missed: $shebang" >&2; return 1; }
    out=$(PATH="$d:/usr/bin:/bin" yr_safe_path)
    [[ "$out" != *"$d"* ]] || { echo "awk missed: $shebang" >&2; return 1; }
  done
  # Option operands are not the command; outside commands stay fine.
  for shebang in "#!/usr/bin/env -u $PWD/venv/python sh" "#!/usr/bin/env -S sh -c true"; do
    d="$BATS_TEST_TMPDIR/sbok"
    mkdir -p "$d"
    printf '%s\n' "$shebang" >| "$d/tool"
    chmod +x "$d/tool"
    ! yr_file_shebang_enters "$d/tool" "$PWD" || { echo "shell false hit: $shebang" >&2; return 1; }
    out=$(PATH="$d:/usr/bin:/bin" yr_safe_path)
    [[ "$out" == "$d:"* ]] || { echo "awk false hit: $shebang" >&2; return 1; }
  done
}

@test "yr_shebang_inside follows every interpreter when an earlier candidate does not exist" {
  # realpath -m keeps a missing candidate; awk would stop at it and never read
  # the later interpreter, whose own #! enters the worktree.
  mkdir -p venv "$BATS_TEST_TMPDIR/sbd" "$BATS_TEST_TMPDIR/sbo"
  printf '#!/bin/sh\nexit 0\n' >| venv/python
  chmod +x venv/python
  printf '#!%s/venv/python\n' "$PWD" >| "$BATS_TEST_TMPDIR/sbo/mid"
  chmod +x "$BATS_TEST_TMPDIR/sbo/mid"
  printf '#!%s/sbo/mid /nonexistent/arg\n' "$BATS_TEST_TMPDIR" >| "$BATS_TEST_TMPDIR/sbd/tool"
  chmod +x "$BATS_TEST_TMPDIR/sbd/tool"
  n=0
  for a in awk mawk gawk original-awk; do
    aw=$(command -v "$a") || continue
    n=$((n + 1))
    yr_shebang_inside "$PWD" "$(command -v find)" "$(command -v realpath)" "$aw" "$BATS_TEST_TMPDIR/sbd" \
      || { echo "$a missed the chain" >&2; return 1; }
  done
  [ "$n" -gt 0 ]
  out=$(PATH="$BATS_TEST_TMPDIR/sbd:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *"$BATS_TEST_TMPDIR/sbd"* ]]
}

@test "yr_has_root matches the worktree only as a whole path" {
  root="$PWD"
  yr_has_root "ssh -i $root/key" "$root"
  yr_has_root "x '$root'" "$root"
  yr_has_root "a=$root:b" "$root"
  yr_has_root "$root" "$root"
  ! yr_has_root "ssh -i ${root}-keys/id" "$root"
  ! yr_has_root "${root}2/bin/ssh" "$root"
  ! yr_has_root "${root}.bak/x" "$root"
  ! yr_has_root "pre${root}/x" "$root"
  yr_has_root "${root}2/x $root/y" "$root"
}

@test "harden_git_config does not over-refuse siblings of the worktree or a bare first word that is also a repo directory" {
  mkdir -p "${PWD}-keys" "${PWD}2/bin" less evil
  : >| evil/file
  for val in "ssh -i ${PWD}-keys/id" "${PWD}2/bin/ssh -o x" "less -FRX" "less" "sh -c true"; do
    rc=0; ( export GIT_SSH_COMMAND="$val" PAGER="$val" GIT_PAGER="$val"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 0 ] || { echo "refused: $val" >&2; return 1; }
  done
  rm -rf "${PWD}-keys" "${PWD}2"
}

@test "harden_git_config refuses when awk cannot split NUL records (BWK awk) instead of skipping keys" {
  # BWK awk reads RS = "\0" as RS = "" (paragraph mode) and cuts each line at
  # its first NUL; a value with blank lines then makes the record count a
  # multiple of 3 and the refused key is never seen.
  git config core.sshCommand evil
  git config x.y "$(printf 'a\n\nb\n\nc')"
  # Emulate that awk with the system one, then use the real one when present.
  yr_awk() { local p="${1//'RS = "\0"'/RS = \"\"}"; shift; sed 's/\x00.*//' | command awk "$p" "$@"; }
  rc=0; ( harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  if command -v original-awk >/dev/null; then
    yr_awk() { original-awk "$@"; }
    rc=0; ( harden_git_config full ) || rc=$?
    [ "$rc" -eq 1 ]
  fi
}

@test "harden_git_config refuses a command line that starts with a NAME=value assignment" {
  # The shell applies a leading assignment to the command it runs:
  # PATH=tools:/usr/bin ssh looks ssh up in the worktree's tools/.
  mkdir -p tools
  printf '#!/bin/sh\nexit 0\n' >| tools/ssh
  chmod +x tools/ssh
  for val in "PATH=tools:/usr/bin ssh" "PATH=./tools ssh host" "A=1 PATH=tools ssh" "FOO=bar ssh" "!PATH=tools ssh"; do
    for name in GIT_SSH_COMMAND GIT_PAGER EDITOR GIT_PROXY_COMMAND; do
      rc=0; ( export "$name=$val"; harden_git_config full ) || rc=$?
      [ "$rc" -eq 1 ] || { echo "$name accepted: $val" >&2; return 1; }
    done
  done
  rc=0; ( export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.sshCommand GIT_CONFIG_VALUE_0="PATH=tools:/usr/bin ssh"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  ( export GIT_SSH_COMMAND="PATH=tools:/usr/bin ssh"; harden_git_config full || [[ "$YR_HARDEN_MSG" == "GIT_SSH_COMMAND runs"* && "$YR_HARDEN_MSG" != *tools* ]] )
  # An assignment-shaped later word is an argument, not an assignment.
  rc=0; ( export GIT_SSH_COMMAND="ssh -o ProxyCommand=nc"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
}

@test "harden_git_config still checks later bare words and slash words against the current directory" {
  : >| evil
  mkdir -p tools
  : >| tools/evil
  for val in "sh evil" "sh tools/evil" "sh -e evil" "ssh -F evil host"; do
    rc=0; ( export GIT_SSH_COMMAND="$val"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 1 ] || { echo "accepted: $val" >&2; return 1; }
  done
}

@test "harden_git_config refuses shell syntax it cannot judge, naming the variable and not the value" {
  mkdir -p tools
  : >| tools/evil
  for val in '$PWD/tools/evil' '${PWD}/tools/evil' '`touch x`' '$(touch x)' 'ssh; touch x' 'ssh && true' 'ssh | cat' \
             'ssh > out' 'ssh < in' 'f() { x; }' 'ssh *' 'ssh ?' 'ssh [a]' '~root/x' 'ssh ~root/key' $'ssh\ntouch x'; do
    for name in GIT_SSH_COMMAND GIT_PAGER EDITOR GIT_PROXY_COMMAND; do
      rc=0; ( export "$name=$val"; harden_git_config full; ) || rc=$?
      [ "$rc" -eq 1 ] || { echo "$name accepted: $val" >&2; return 1; }
    done
  done
  ( export GIT_SSH_COMMAND='$PWD/tools/evil'; harden_git_config full || [[ "$YR_HARDEN_MSG" == "GIT_SSH_COMMAND uses shell syntax"* && "$YR_HARDEN_MSG" != *evil* ]] )
  rc=0; ( export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.sshCommand GIT_CONFIG_VALUE_0='$PWD/tools/evil'; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  rc=0; ( export GIT_CONFIG_PARAMETERS="'credential.helper'='!f() { x; }; f'"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  # Other config keys are not command-bearing: shell syntax there is fine.
  rc=0; ( export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0='!f() { x; }; f'; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
}

@test "harden_git_config expands a leading ~/ to HOME and judges the result" {
  mkdir -p "$BATS_TEST_TMPDIR/home" tools
  : >| tools/key
  rc=0; ( export HOME="$BATS_TEST_TMPDIR/home" GIT_SSH_COMMAND='ssh -i ~/.ssh/id_ed25519'; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
  rc=0; ( export HOME="$PWD" GIT_CONFIG_GLOBAL=/dev/null GIT_SSH_COMMAND='ssh -i ~/tools/key'; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
}

@test "harden_git_config refuses a global git config that HOME or XDG_CONFIG_HOME puts inside the worktree" {
  mkdir -p "$BATS_TEST_TMPDIR/home" cfg/git
  rc=0; ( unset GIT_CONFIG_GLOBAL; export HOME="$BATS_TEST_TMPDIR/home"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
  rc=0; ( unset GIT_CONFIG_GLOBAL XDG_CONFIG_HOME; export HOME="$PWD"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  rc=0; ( unset GIT_CONFIG_GLOBAL; export HOME="$BATS_TEST_TMPDIR/home" XDG_CONFIG_HOME="$PWD/cfg"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  # An explicit GIT_CONFIG_GLOBAL replaces both derived files.
  rc=0; ( export GIT_CONFIG_GLOBAL=/dev/null HOME="$PWD"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
}

@test "harden_git_config judges the file a global-scope command came from, such as an include inside the worktree" {
  mkdir -p tools
  printf '[core]\n\tsshCommand = ssh -x\n' >| tools/inc.cfg
  printf '[include]\n\tpath = %s/tools/inc.cfg\n' "$PWD" >| "$BATS_TEST_TMPDIR/global.cfg"
  rc=0; ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/global.cfg"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/global.cfg"; harden_git_config full || [[ "$YR_HARDEN_MSG" == *"global or system git config file inside the repository"* ]] )
  # The same command in a global file outside the worktree is the user's own.
  printf '[core]\n\tsshCommand = ssh -x\n' >| "$BATS_TEST_TMPDIR/own.cfg"
  rc=0; ( export GIT_CONFIG_GLOBAL="$BATS_TEST_TMPDIR/own.cfg"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
}

@test "a non-env #! optional argument or an env command's arguments that enter the worktree are caught, in awk and in the shell" {
  mkdir -p venv
  : >| evil
  n=0
  for shebang in "#!/bin/sh $PWD/venv/python" "#!/bin/sh -e $PWD/evil" "#!/bin/sh evil" "#!/bin/sh --file=$PWD/evil" \
                 "#!/bin/sh \"$PWD/evil\"" "#!/usr/bin/env sh $PWD/evil" "#!/usr/bin/env -S sh -e $PWD/evil" "#!/bin/sh -x $PWD" \
                 "#!/usr/bin/awk -f $PWD/evil"; do
    n=$((n + 1))
    d="$BATS_TEST_TMPDIR/oa$n"
    mkdir -p "$d"
    printf '%s\n' "$shebang" >| "$d/tool"
    chmod +x "$d/tool"
    yr_file_shebang_enters "$d/tool" "$PWD" || { echo "shell missed: $shebang" >&2; return 1; }
    out=$(PATH="$d:/usr/bin:/bin" yr_safe_path)
    [[ "$out" != *"$d"* ]] || { echo "awk missed: $shebang" >&2; return 1; }
  done
  for shebang in "#!/bin/sh -e" "#!/bin/sh -x ${PWD}2/evil" "#!/bin/sh -x ${PWD}-keys/id" "#!/usr/bin/env sh -e" "#!/usr/bin/awk -f" "#!/bin/sh nosuchfile"; do
    d="$BATS_TEST_TMPDIR/oaok"
    mkdir -p "$d"
    printf '%s\n' "$shebang" >| "$d/tool"
    chmod +x "$d/tool"
    ! yr_file_shebang_enters "$d/tool" "$PWD" || { echo "shell false hit: $shebang" >&2; return 1; }
    out=$(PATH="$d:/usr/bin:/bin" yr_safe_path)
    [[ "$out" == "$d:"* ]] || { echo "awk false hit: $shebang" >&2; return 1; }
  done
}

@test "harden_git_config keeps a trusted command variable, a bare name and a link to an outside file" {
  ln -s /usr/bin/true "$BATS_TEST_TMPDIR/trusted"
  for val in "/usr/bin/ssh -o BatchMode=yes" ssh "ssh -i /nonexistent/key" "$BATS_TEST_TMPDIR/trusted" "'/usr/bin/true' x" "!/usr/bin/true"; do
    rc=0; ( export GIT_SSH_COMMAND="$val" GIT_PROXY_COMMAND="$val" EDITOR="$val"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 0 ] || { echo "refused: $val" >&2; return 1; }
  done
}

@test "harden_git_config refuses a command variable that reaches the worktree through a symlink" {
  mkdir -p tools
  : >| tools/cmd
  ln -s "$PWD/tools/cmd" "$BATS_TEST_TMPDIR/viaLink"
  rc=0; ( export GIT_SSH_COMMAND="$BATS_TEST_TMPDIR/viaLink -x"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
}

@test "harden_git_config refuses GIT_TEMPLATE_DIR and GIT_CONFIG_GLOBAL inside the worktree" {
  mkdir -p tools/dir
  : >| tools/cfg
  for name in GIT_TEMPLATE_DIR GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM; do
    rc=0; ( export "$name=$PWD/tools/dir"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 1 ] || { echo "$name accepted" >&2; return 1; }
    rc=0; ( export "$name=tools/cfg"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 1 ] || { echo "$name relative accepted" >&2; return 1; }
  done
  rc=0; ( export GIT_TEMPLATE_DIR=/usr/share/git-core/templates; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
}

@test "harden_git_config refuses any inherited GIT_EXEC_PATH, naming the variable and not the value" {
  mkdir -p "$BATS_TEST_TMPDIR/xp" ignored
  : >| ignored/helper
  chmod +x ignored/helper
  ln -s "$PWD/ignored/helper" "$BATS_TEST_TMPDIR/xp/git-remote-https"
  for val in "$BATS_TEST_TMPDIR/xp" /usr/lib/git-core; do
    rc=0; ( export GIT_EXEC_PATH="$val"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 1 ] || { echo "accepted: $val" >&2; return 1; }
  done
  ( export GIT_EXEC_PATH="$BATS_TEST_TMPDIR/xp"; harden_git_config full || [[ "$YR_HARDEN_MSG" == "GIT_EXEC_PATH"* && "$YR_HARDEN_MSG" != *"$BATS_TEST_TMPDIR"* ]] )
  rc=0; ( unset GIT_EXEC_PATH; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
}

@test "harden_git_config refuses injected config (GIT_CONFIG_KEY_n and GIT_CONFIG_PARAMETERS) that runs a program inside the worktree" {
  mkdir -p tools
  : >| tools/cmd
  for key in core.sshCommand core.askpass credential.helper credential.https://x.example.helper core.pager \
             diff.external gpg.program core.editor; do
    # core.askpass and gpg.program hold one unsplit program path
    pv="$PWD/tools/cmd -x"
    case "$key" in core.askpass|gpg.program) pv="$PWD/tools/cmd" ;; esac
    rc=0; ( export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x \
                   GIT_CONFIG_KEY_1="$key" GIT_CONFIG_VALUE_1="$pv"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 1 ] || { echo "KEY accepted: $key" >&2; return 1; }
    rc=0; ( export GIT_CONFIG_PARAMETERS="'user.name'='x' '$key'='$pv'"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 1 ] || { echo "PARAMETERS accepted: $key" >&2; return 1; }
    rc=0; ( export GIT_CONFIG_PARAMETERS="'$key=$PWD/tools/cmd'"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 1 ] || { echo "PARAMETERS (old form) accepted: $key" >&2; return 1; }
  done
  rc=0; ( export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.sshCommand GIT_CONFIG_VALUE_0="/usr/bin/ssh -o x"
          export GIT_CONFIG_PARAMETERS="'credential.helper'='store' 'core.sshcommand'='ssh -x'"
          harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
}

@test "yr_adopt_path runs bare names on the screened PATH and keeps the caller's PATH in YR_ORIG_PATH" {
  mkdir -p tools "$BATS_TEST_TMPDIR/badbin"
  printf '#!/bin/sh\ntouch "%s/grep-ran"\nexit 0\n' "$BATS_TEST_TMPDIR" >| tools/canary
  chmod +x tools/canary
  ln -s "$PWD/tools/canary" "$BATS_TEST_TMPDIR/badbin/grep"
  orig="$BATS_TEST_TMPDIR/badbin:$PATH"
  PATH="$orig"
  yr_adopt_path
  [ "$YR_ORIG_PATH" = "$orig" ]
  [[ "$PATH" != *badbin* ]]
  printf 'x\n' | grep -q y && return 1
  [ ! -e "$BATS_TEST_TMPDIR/grep-ran" ]
  # yr_resolve_tool still judges the caller's PATH, so a tool that reaches into
  # the worktree is refused rather than skipped.
  ln -s "$PWD/tools/canary" "$BATS_TEST_TMPDIR/badbin/zzcanary"
  rc=0; yr_resolve_tool zzcanary >/dev/null || rc=$?
  [ "$rc" -eq 2 ]
}

@test "harden_git_config fails closed when awk fails while reading the transport config" {
  git config --local core.sshCommand x
  mkdir -p "$BATS_TEST_TMPDIR/badawk"
  printf '#!/bin/sh\nexit 2\n' >| "$BATS_TEST_TMPDIR/badawk/awk"
  chmod +x "$BATS_TEST_TMPDIR/badawk/awk"
  rc=0
  PATH="$BATS_TEST_TMPDIR/badawk:$PATH" harden_git_config full || rc=$?
  [ "$rc" -eq 1 ]
  [[ "$YR_HARDEN_MSG" == *"could not parse the git transport config"* ]]
}

@test "harden_git_config reads config through yr_git, not a git shadow" {
  git() { echo "shadow git ran" >&2; return 99; }
  rc=0; harden_git_config revert || rc=$?
  unset -f git
  [ "$rc" -eq 0 ]
}

@test "lgit_nohooks keeps pathspecs literal" {
  mkdir -p src && printf 'a\n' >| 'src/*' && printf 'b\n' >| src/real.txt
  run lgit_nohooks add -n -- 'src/*'
  [ "$status" -eq 0 ]
  [[ "$output" == *"'src/*'"* ]]
  [[ "$output" != *real.txt* ]]
}

# --- git is one absolute path outside the worktree ---

# trust_canary <marker>: an executable git inside this repo that records a run.
trust_canary() {
  local marker="$1" dir="$PWD/canary-bin"
  mkdir -p "$dir"
  cat >| "$dir/git" <<EOF
#!/bin/sh
touch "$marker"
exit 99
EOF
  chmod +x "$dir/git"
  printf '%s' "$dir"
}

# trust_assert_absolute <log>: every recorded argv starts with an absolute $0.
trust_assert_absolute() {
  local line
  [ -s "$1" ] || { echo "empty argv log $1"; return 1; }
  while IFS= read -r line; do
    case "$line" in
      bare|exported) echo "bad argv line: $line"; return 1 ;;
      /*) ;;
      *) echo "not absolute: $line"; return 1 ;;
    esac
  done < "$1"
}

@test "trust: an in-worktree git canary is not executed" {
  local marker="$BATS_TEST_TMPDIR/canary-ran" dir
  rm -f "$marker"
  unset YELLOW_REVIEW_GIT YELLOW_REVIEW_GH YELLOW_REVIEW_JQ
  dir=$(trust_canary "$marker")
  case "$(cd "$dir" && pwd -P)" in
    "$(pwd -P)"/*) ;;
    *) echo "canary directory is not inside the worktree"; return 1 ;;
  esac
  PATH="$dir:$PATH" run lgit status --porcelain
  [ "$status" -ne 0 ]
  [ "$status" -ne 99 ]
  [ ! -e "$marker" ]
}

@test "trust: a symlink outside the worktree whose target is an in-worktree git canary is not executed" {
  local marker="$BATS_TEST_TMPDIR/canary-ran" dir link="$BATS_TEST_TMPDIR/linkbin" link_dir repo_dir
  rm -f "$marker"
  unset YELLOW_REVIEW_GIT YELLOW_REVIEW_GH YELLOW_REVIEW_JQ
  dir=$(trust_canary "$marker")
  mkdir -p "$link"
  ln -s "$dir/git" "$link/git"
  link_dir=$(cd "$link" && pwd -P)
  repo_dir=$(pwd -P)
  case "$link_dir" in
    "$repo_dir"|"$repo_dir"/*) echo "symlink directory is inside the worktree"; return 1 ;;
  esac
  PATH="$link:$PATH" run lgit status --porcelain
  [ "$status" -ne 0 ]
  [ "$status" -ne 99 ]
  [ ! -e "$marker" ]
}

@test "trust: in-worktree readlink and dirname canaries do not run during the trust check" {
  local marker="$BATS_TEST_TMPDIR/canary-ran" dir="$PWD/canary-bin" link="$BATS_TEST_TMPDIR/linkbin" real tool
  rm -f "$marker"
  unset YELLOW_REVIEW_GIT YELLOW_REVIEW_GH YELLOW_REVIEW_JQ
  real=$(type -P git) || skip "git not found on PATH"
  mkdir -p "$dir" "$link" sub
  for tool in readlink dirname; do
    printf '#!/bin/sh\ntouch "%s"\nexit 99\n' "$marker" >| "$dir/$tool"
    chmod +x "$dir/$tool"
  done
  ln -s "$real" "$link/git"
  cd sub
  PATH="$dir:$link:$PATH" run lgit rev-parse --git-dir
  [ "$status" -eq 0 ]
  [ ! -e "$marker" ]
}

@test "trust: yr_inside_root matches an ancestor that is the worktree under another spelling" {
  local root="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$root/bin" "$BATS_TEST_TMPDIR/outside"
  : >| "$root/bin/git"
  : >| "$BATS_TEST_TMPDIR/outside/git"
  yr_inside_root "$root" "$root"
  yr_inside_root "$root/bin/git" "$root"
  yr_inside_root "$BATS_TEST_TMPDIR/./repo/bin/git" "$root"
  yr_inside_root "$BATS_TEST_TMPDIR//repo/bin/git" "$root"
  run yr_inside_root "$BATS_TEST_TMPDIR/outside/git" "$root"
  [ "$status" -eq 1 ]
  run yr_inside_root "$BATS_TEST_TMPDIR/repo-sibling/git" "$root"
  [ "$status" -eq 1 ]
}

@test "trust: lgit execs only an absolute git and keeps its flags" {
  local marker="$BATS_TEST_TMPDIR/canary-ran" log="$BATS_TEST_TMPDIR/git-argv.log"
  local real dest dir
  rm -f "$marker" "$log"
  unset YELLOW_REVIEW_GIT YELLOW_REVIEW_GH YELLOW_REVIEW_JQ
  real=$(type -P git) || skip "git not found on PATH"
  dest=$(mkdir -p "$BATS_TEST_TMPDIR/doubles" && cd "$BATS_TEST_TMPDIR/doubles" && pwd -P)
  cat >| "$dest/git" <<EOF
#!/bin/sh
if [ -n "\${YELLOW_REVIEW_GIT:-}\${YELLOW_REVIEW_GH:-}\${YELLOW_REVIEW_JQ:-}" ]; then
  printf 'exported\n' >> "$log"
  exit 98
fi
{
  printf '%s' "\$0"
  for a in "\$@"; do
    printf ' '
    printf '%s' "\$a" | tr '\n' ' '
  done
  printf '\n'
} >> "$log"
case "\$0" in
  /*) ;;
  *) printf 'bare\n' >> "$log"; exit 97 ;;
esac
exec "$real" "\$@"
EOF
  chmod +x "$dest/git"
  PATH="$dest:$PATH"
  lgit status --porcelain
  lgit_nohooks status --porcelain
  trust_assert_absolute "$log"
  grep -F -- "-c core.fsmonitor=false" "$log" >/dev/null
  grep -F -- "-c core.untrackedCache=false" "$log" >/dev/null
  grep -F -- "--literal-pathspecs" "$log" >/dev/null
  grep -F -- "-c core.hooksPath=/dev/null" "$log" >/dev/null
  # A later call reuses the resolved path: a canary now first on PATH does not run.
  dir=$(trust_canary "$marker")
  PATH="$dir:$PATH"
  lgit status --porcelain
  [ ! -e "$marker" ]
  trust_assert_absolute "$log"
  case "$YELLOW_REVIEW_GIT" in
    "$dest/git") ;;
    *) echo "resolved $YELLOW_REVIEW_GIT"; return 1 ;;
  esac
}

@test "yr_safe_path drops a symlinked outside directory whose child links into the worktree, in find and in the shell" {
  mkdir -p ignored "$BATS_TEST_TMPDIR/realbin" "$BATS_TEST_TMPDIR/realscript"
  printf '#!/bin/sh\nexit 0\n' >| ignored/awk
  chmod +x ignored/awk
  ln -s "$PWD/ignored/awk" "$BATS_TEST_TMPDIR/realbin/awk"
  ln -s "$BATS_TEST_TMPDIR/realbin" "$BATS_TEST_TMPDIR/linkbin"
  out=$(PATH="$BATS_TEST_TMPDIR/linkbin:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *linkbin* ]] || { echo "kept: $out" >&2; return 1; }
  # A symlinked directory with an in-worktree interpreter script is dropped too.
  printf '#!%s/ignored/awk\n' "$PWD" >| "$BATS_TEST_TMPDIR/realscript/tool"
  chmod +x "$BATS_TEST_TMPDIR/realscript/tool"
  ln -s "$BATS_TEST_TMPDIR/realscript" "$BATS_TEST_TMPDIR/linkscript"
  out=$(PATH="$BATS_TEST_TMPDIR/linkscript:/usr/bin:/bin" yr_safe_path)
  [[ "$out" != *linkscript* ]]
  # The shell fallback (no GNU realpath, find or awk) walks the same children.
  mkdir -p "$BATS_TEST_TMPDIR/okreal"
  ln -s "$(command -v grep)" "$BATS_TEST_TMPDIR/okreal/grep"
  ln -s "$BATS_TEST_TMPDIR/okreal" "$BATS_TEST_TMPDIR/oklink"
  yr_links_inside "$BATS_TEST_TMPDIR/linkbin" "$PWD"
  yr_links_inside "$BATS_TEST_TMPDIR/linkscript" "$PWD"
  ! yr_links_inside "$BATS_TEST_TMPDIR/oklink" "$PWD"
  # A symlinked directory with only outside children stays in the batched screen.
  out=$(PATH="$BATS_TEST_TMPDIR/oklink:/usr/bin:/bin" yr_safe_path)
  [[ "$out" == "$BATS_TEST_TMPDIR/oklink:"* ]]
}

@test "#! lines whose env -S string expands a variable drop the directory, in awk and in the shell" {
  mkdir -p venv
  printf '#!/bin/sh\nexit 0\n' >| venv/python
  chmod +x venv/python
  n=0
  for shebang in '#!/usr/bin/env -S ${INTERP}' '#!/usr/bin/env -S $INTERP -u' '#!/usr/bin/env -vS ${INTERP} x' \
                 '#!/usr/bin/env --split-string=${INTERP}' '#!/usr/bin/env --split-string $INTERP' \
                 '#!/usr/bin/env -S sh -c ${INTERP}' '#!/usr/bin/env -S/usr/bin/${X}/python'; do
    n=$((n + 1))
    d="$BATS_TEST_TMPDIR/sv$n"
    mkdir -p "$d"
    printf '%s\n' "$shebang" >| "$d/tool"
    chmod +x "$d/tool"
    yr_file_shebang_enters "$d/tool" "$PWD" || { echo "shell missed: $shebang" >&2; return 1; }
    out=$(PATH="$d:/usr/bin:/bin" yr_safe_path)
    [[ "$out" != *"$d"* ]] || { echo "awk missed: $shebang" >&2; return 1; }
  done
  # A dollar sign outside an env -S string is a literal path character.
  d="$BATS_TEST_TMPDIR/svok"
  mkdir -p "$d"
  printf '#!/usr/bin/env sh\n' >| "$d/tool"
  chmod +x "$d/tool"
  ! yr_file_shebang_enters "$d/tool" "$PWD"
  out=$(PATH="$d:/usr/bin:/bin" yr_safe_path)
  [[ "$out" == "$d:"* ]]
}

@test "harden_git_config refuses a backslash or a quote inside a word, naming the variable and not the value" {
  mkdir -p ignored
  : >| ignored/ssh
  root="$PWD"
  for val in "${root//\//\\/}/ignored/ssh" "$root/ign\\ored/ssh" 'ssh\ -F\ x' 'ssh -o a\"b' \
             "${root%?}\"${root: -1}\"/ignored/ssh" "ssh -F ${root:0:5}'${root:5}'/ignored/x" 'ssh -F a"b"c'; do
    for name in GIT_SSH_COMMAND GIT_PAGER EDITOR GIT_PROXY_COMMAND; do
      rc=0; ( export "$name=$val"; harden_git_config full; ) || rc=$?
      [ "$rc" -eq 1 ] || { echo "$name accepted: $val" >&2; return 1; }
    done
  done
  ( export GIT_SSH_COMMAND='ssh\ x'; harden_git_config full || [[ "$YR_HARDEN_MSG" == "GIT_SSH_COMMAND uses shell syntax"* && "$YR_HARDEN_MSG" != *'ssh\ x'* ]] )
  # Quotes that wrap whole words are still judged by the existing rules and pass.
  for val in 'ssh -i "/nonexistent/key"' "'/usr/bin/ssh' -x" 'ssh -i /home/u/.ssh/key' 'less -R'; do
    rc=0; ( export GIT_SSH_COMMAND="$val"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 0 ] || { echo "refused: $val" >&2; return 1; }
  done
}

@test "harden_git_config refuses a quoted span that contains whitespace" {
  mkdir -p "dir with space"
  : >| "dir with space/evil"
  for val in "sh 'dir with space/evil'" 'sh "dir with space/evil"' "ssh -o 'StrictHostKeyChecking no'" "sh 'a b"; do
    for name in GIT_SSH_COMMAND GIT_PAGER EDITOR GIT_PROXY_COMMAND; do
      rc=0; ( export "$name=$val"; harden_git_config full ) || rc=$?
      [ "$rc" -eq 1 ] || { echo "$name accepted: $val" >&2; return 1; }
    done
  done
  rc=0; ( export GIT_CONFIG_PARAMETERS="'core.sshcommand'='sh \"dir with space/evil\"'"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  rc=0; ( export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.sshCommand GIT_CONFIG_VALUE_0="sh 'dir with space/evil'"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
  for val in 'ssh -i /home/u/.ssh/key' 'less -R' "'/usr/bin/ssh' -x"; do
    rc=0; ( export GIT_SSH_COMMAND="$val" GIT_PAGER="$val"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 0 ] || { echo "refused: $val" >&2; return 1; }
  done
}

@test "harden_git_config refuses an injected include.path or includeIf path, naming the variable and not the value" {
  mkdir -p tools
  : >| tools/inc
  for key in include.path includeIf.gitdir:/x/.path INCLUDE.PATH includeif.onbranch:main.path; do
    for val in "$PWD/tools/inc" tools/inc "$BATS_TEST_TMPDIR/outside"; do
      rc=0; ( export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="$key" GIT_CONFIG_VALUE_0="$val"; harden_git_config full ) || rc=$?
      [ "$rc" -eq 1 ] || { echo "KEY accepted: $key $val" >&2; return 1; }
      rc=0; ( export GIT_CONFIG_PARAMETERS="'user.name'='x' '$key'='$val'"; harden_git_config full ) || rc=$?
      [ "$rc" -eq 1 ] || { echo "PARAMETERS accepted: $key $val" >&2; return 1; }
    done
  done
  ( export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=include.path GIT_CONFIG_VALUE_0="$PWD/tools/inc"
    harden_git_config full || [[ "$YR_HARDEN_MSG" == "GIT_CONFIG_KEY_0"* && "$YR_HARDEN_MSG" != *tools/inc* ]] )
  # A non-include key whose value merely looks like one stays accepted.
  rc=0; ( export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=include.path; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
}

@test "harden_git_config refuses an escaped worktree path that contains a space" {
  cd "$BATS_TEST_TMPDIR" && mkdir -p "my repo" && cd "my repo" && git init -q
  mkdir -p ignored
  printf '#!/bin/sh\nexit 0\n' >| ignored/ssh
  chmod +x ignored/ssh
  val="$PWD/ignored/ssh"
  val=${val// /\\ }
  rc=0; ( export GIT_SSH_COMMAND="$val"; harden_git_config full; ) || rc=$?
  [ "$rc" -eq 1 ]
}

@test "#! lines with an env NAME=value operand or an escape or quote in an env -S string drop the directory, in awk and in the shell" {
  mkdir -p tools
  printf '#!/bin/sh\nexit 0\n' >| tools/evil
  chmod +x tools/evil
  n=0
  for shebang in '#!/usr/bin/env -S PATH=tools evil' '#!/usr/bin/env PATH=tools evil' '#!/usr/bin/env A=1 sh' \
                 '#!/usr/bin/env -S "/tmp/my\_repo/evil"' "#!/usr/bin/env -S '/tmp/x/evil'" \
                 '#!/usr/bin/env -S sh\_x' '#!/usr/bin/env --split-string=/tmp/a\_b' '#!/usr/bin/env -vS "sh" x'; do
    n=$((n + 1))
    d="$BATS_TEST_TMPDIR/ea$n"
    mkdir -p "$d"
    printf '%s\n' "$shebang" >| "$d/tool"
    chmod +x "$d/tool"
    yr_file_shebang_enters "$d/tool" "$PWD" || { echo "shell missed: $shebang" >&2; return 1; }
    out=$(PATH="$d:/usr/bin:/bin" yr_safe_path)
    [[ "$out" != *"$d"* ]] || { echo "awk missed: $shebang" >&2; return 1; }
  done
  for shebang in '#!/usr/bin/env python3' '#!/usr/bin/env -S node --flag' '#!/usr/bin/env -S sh -c true'; do
    d="$BATS_TEST_TMPDIR/eaok"
    mkdir -p "$d"
    printf '%s\n' "$shebang" >| "$d/tool"
    chmod +x "$d/tool"
    ! yr_file_shebang_enters "$d/tool" "$PWD" || { echo "shell false hit: $shebang" >&2; return 1; }
    out=$(PATH="$d:/usr/bin:/bin" yr_safe_path)
    [[ "$out" == "$d:"* ]] || { echo "awk false hit: $shebang" >&2; return 1; }
  done
}

# unprivileged <script>: run a bash script as a user that directory modes bind
# (root reads an execute-only directory anyway). Sets nothing; prints its output.
# Returns 77 when no unprivileged user is available.
unprivileged() {
  if [ "$(id -u)" -ne 0 ]; then
    bash -c "$1"
  elif command -v setpriv >/dev/null 2>&1 && id nobody >/dev/null 2>&1; then
    setpriv --reuid="$(id -u nobody)" --regid="$(id -g nobody)" --clear-groups bash -c "$1"
  else
    return 77
  fi
}

@test "yr_safe_path drops an execute-only PATH directory it cannot list, even when it holds a link into the worktree" {
  mkdir -p ignored "$BATS_TEST_TMPDIR/xbin" "$BATS_TEST_TMPDIR/okbin"
  printf '#!/bin/sh\nexit 0\n' >| ignored/awk
  chmod +x ignored/awk
  ln -s "$PWD/ignored/awk" "$BATS_TEST_TMPDIR/xbin/awk"
  ln -s "$(command -v grep)" "$BATS_TEST_TMPDIR/okbin/grep"
  chmod 711 "$BATS_TEST_TMPDIR/xbin"
  # Let the unprivileged user reach the repository and the directories.
  p="$BATS_TEST_TMPDIR"
  while [ "$p" != /tmp ] && [ "$p" != / ]; do chmod 755 "$p"; p=$(dirname "$p"); done
  chmod -R a+rX "$PWD" "$BATS_TEST_TMPDIR/okbin"
  script='export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="*"
    . "'"$LIB"'"; cd "'"$PWD"'"; PATH="'"$BATS_TEST_TMPDIR"'/xbin:'"$BATS_TEST_TMPDIR"'/okbin:/usr/bin:/bin" yr_safe_path'
  rc=0; out=$(unprivileged "$script") || rc=$?
  if [ "$rc" -eq 77 ]; then skip "no unprivileged user to run as (running as root without setpriv/nobody): chmod cannot restrict root"; fi
  [ "$rc" -eq 0 ] || { echo "rc=$rc out=$out" >&2; return 1; }
  [[ "$out" != *xbin* ]] || { echo "kept: $out" >&2; return 1; }
  [[ "$out" == "$BATS_TEST_TMPDIR/okbin:"* ]]
}

@test "#! lines whose env has -P (a search path that is not PATH) drop the directory, in awk and in the shell" {
  mkdir -p tools
  printf '#!/bin/sh\nexit 0\n' >| tools/evil
  chmod +x tools/evil
  n=0
  for shebang in '#!/usr/bin/env -P tools evil' '#!/usr/bin/env -Ptools evil' '#!/usr/bin/env -vP tools evil' \
                 '#!/usr/bin/env -S -P tools evil' '#!/usr/bin/env -S -Ptools evil' '#!/usr/bin/env -P/usr/bin sh'; do
    n=$((n + 1))
    d="$BATS_TEST_TMPDIR/ep$n"
    mkdir -p "$d"
    printf '%s\n' "$shebang" >| "$d/tool"
    chmod +x "$d/tool"
    yr_file_shebang_enters "$d/tool" "$PWD" || { echo "shell missed: $shebang" >&2; return 1; }
    out=$(PATH="$d:/usr/bin:/bin" yr_safe_path)
    [[ "$out" != *"$d"* ]] || { echo "awk missed: $shebang" >&2; return 1; }
  done
  for shebang in '#!/usr/bin/env python3' '#!/usr/bin/env -S node --flag' '#!/usr/bin/env -u P sh' '#!/usr/bin/env sh -P'; do
    d="$BATS_TEST_TMPDIR/epok"
    mkdir -p "$d"
    printf '%s\n' "$shebang" >| "$d/tool"
    chmod +x "$d/tool"
    ! yr_file_shebang_enters "$d/tool" "$PWD" || { echo "shell false hit: $shebang" >&2; return 1; }
    out=$(PATH="$d:/usr/bin:/bin" yr_safe_path)
    [[ "$out" == "$d:"* ]] || { echo "awk false hit: $shebang" >&2; return 1; }
  done
}

@test "harden_git_config refuses an inherited GIT_CONFIG, which would hide the repository config from its scans" {
  git config filter.evil.clean 'sh -c evil'
  printf '[core]\n\tfsmonitor = false\n\tuntrackedCache = false\n[safe]\n\tbareRepository = explicit\n' >| "$BATS_TEST_TMPDIR/alt.conf"
  for scope in full revert; do
    rc=0; ( export GIT_CONFIG="$BATS_TEST_TMPDIR/alt.conf"; harden_git_config "$scope" ) || rc=$?
    [ "$rc" -eq 1 ] || { echo "$scope accepted GIT_CONFIG" >&2; return 1; }
  done
  ( export GIT_CONFIG="$BATS_TEST_TMPDIR/alt.conf"; harden_git_config full || [[ "$YR_HARDEN_MSG" == "GIT_CONFIG "* && "$YR_HARDEN_MSG" != *alt.conf* ]] )
  # An empty value is still a set variable.
  rc=0; ( export GIT_CONFIG=; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
}

@test "#! lines whose env has -C or --chdir (resolving the utility from another directory) drop the directory, in awk and in the shell" {
  mkdir -p sub
  n=0
  for shebang in '#!/usr/bin/env -S --chdir=/tmp/wt/sub sh evil' '#!/usr/bin/env -C /tmp sh' '#!/usr/bin/env -C/tmp sh' \
                 '#!/usr/bin/env --chdir /tmp sh' '#!/usr/bin/env --chdir=/tmp sh' '#!/usr/bin/env -vC /tmp sh' \
                 '#!/usr/bin/env -S -C /tmp sh' '#!/usr/bin/env -S --chdir /tmp sh'; do
    n=$((n + 1))
    d="$BATS_TEST_TMPDIR/ec$n"
    mkdir -p "$d"
    printf '%s\n' "$shebang" >| "$d/tool"
    chmod +x "$d/tool"
    yr_file_shebang_enters "$d/tool" "$PWD" || { echo "shell missed: $shebang" >&2; return 1; }
    out=$(PATH="$d:/usr/bin:/bin" yr_safe_path)
    [[ "$out" != *"$d"* ]] || { echo "awk missed: $shebang" >&2; return 1; }
  done
}

@test "harden_git_config refuses GIT_CONFIG_PARAMETERS it cannot decode exactly, naming the variable and not the value" {
  mkdir -p tools
  : >| tools/evil
  q="'\\''"
  # Git's own quoting: an embedded quote is '\''.
  for val in "'core.sshcommand'='sh ${q}$PWD/tools/evil${q}'" "'core.sshcommand'='sh ${q}tools/evil${q}'" \
             "'core.sshcommand'='ssh' junk" "'user.name'='x' garbage 'core.sshcommand'='ssh'" "'core.sshcommand'='ssh"; do
    rc=0; ( export GIT_CONFIG_PARAMETERS="$val"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 1 ] || { echo "accepted: $val" >&2; return 1; }
  done
  ( export GIT_CONFIG_PARAMETERS="'core.sshcommand'='sh ${q}x${q}'"; harden_git_config full || [[ "$YR_HARDEN_MSG" == "GIT_CONFIG_PARAMETERS "* && "$YR_HARDEN_MSG" != *sshcommand* ]] )
  # Well-formed entries, including a key without a value, still pass.
  for val in "'user.name'='x' 'core.sshcommand'='ssh -x'" "'credential.helper'='store'" "'user.name=x'" "'core.bare'"; do
    rc=0; ( export GIT_CONFIG_PARAMETERS="$val"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 0 ] || { echo "refused: $val" >&2; return 1; }
  done
}

@test "harden_git_config refuses a global config whose program value names a file inside the worktree" {
  mkdir -p tools "$BATS_TEST_TMPDIR/own"
  printf '#!/bin/sh\nexit 0\n' >| tools/evil
  chmod +x tools/evil
  printf '#!/bin/sh\nexit 0\n' >| "$BATS_TEST_TMPDIR/own/tool"
  chmod +x "$BATS_TEST_TMPDIR/own/tool"
  local g="$BATS_TEST_TMPDIR/global" kv rc
  for kv in 'core.sshCommand=./tools/evil' 'core.sshCommand=tools/evil -o x' 'core.sshCommand=ssh -F ./tools/evil host' \
            "core.sshCommand=$PWD/tools/evil" 'core.askpass=./tools/evil' "core.askpass=$PWD/tools/evil" \
            'core.pager=./tools/evil' 'credential.helper=./tools/evil' 'gpg.program=./tools/evil' \
            'diff.external=./tools/evil'; do
    : >| "$g"
    git config -f "$g" "${kv%%=*}" "${kv#*=}"
    for scope in full revert; do
      rc=0; ( export GIT_CONFIG_GLOBAL="$g"; harden_git_config "$scope" ) || rc=$?
      case "${kv%%=*}" in
        core.sshCommand|core.askpass|core.pager|credential.helper|gpg.program|diff.external)
          # revert judges only the checkout subset (filter.*, lfs.*)
          if [ "$scope" = revert ]; then [ "$rc" -eq 0 ] || { echo "$kv ($scope) rc=$rc" >&2; return 1; }
          else [ "$rc" -eq 1 ] || { echo "$kv ($scope) rc=$rc" >&2; return 1; }; fi ;;
      esac
    done
    rc=0; ( export GIT_CONFIG_GLOBAL="$g"; harden_git_config full; [[ "$YR_HARDEN_MSG" != *tools/evil* ]] ) || rc=$?
  done
  # a filter command is in the checkout subset, so revert refuses it too
  : >| "$g"; git config -f "$g" filter.x.smudge ./tools/evil
  rc=0; ( export GIT_CONFIG_GLOBAL="$g"; harden_git_config revert ) || rc=$?
  [ "$rc" -eq 1 ]
  # a program outside the worktree keeps working
  : >| "$g"
  git config -f "$g" core.sshCommand "$BATS_TEST_TMPDIR/own/tool -o x"
  git config -f "$g" core.askpass "$BATS_TEST_TMPDIR/own/tool"
  git config -f "$g" alias.st '!git status | cat'
  rc=0; ( export GIT_CONFIG_GLOBAL="$g"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 0 ]
}

@test "harden_git_config judges GIT_SSH, GIT_ASKPASS and SSH_ASKPASS as one path, spaces included" {
  mkdir -p "dir with space" "$BATS_TEST_TMPDIR/own dir"
  printf '#!/bin/sh\nexit 0\n' >| "dir with space/evil"
  chmod +x "dir with space/evil"
  printf '#!/bin/sh\nexit 0\n' >| "$BATS_TEST_TMPDIR/own dir/tool"
  chmod +x "$BATS_TEST_TMPDIR/own dir/tool"
  local name val rc
  for name in GIT_SSH GIT_ASKPASS SSH_ASKPASS; do
    for val in "dir with space/evil" "./dir with space/evil" "$PWD/dir with space/evil"; do
      rc=0; ( export "$name=$val"; harden_git_config full ) || rc=$?
      [ "$rc" -eq 1 ] || { echo "$name=$val rc=$rc" >&2; return 1; }
    done
    rc=0; ( export "$name=$BATS_TEST_TMPDIR/own dir/tool"; harden_git_config full ) || rc=$?
    [ "$rc" -eq 0 ] || { echo "$name outside rc=$rc" >&2; return 1; }
  done
  # the same single-path rule for an injected core.askpass
  rc=0; ( export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.askpass "GIT_CONFIG_VALUE_0=dir with space/evil"; harden_git_config full ) || rc=$?
  [ "$rc" -eq 1 ]
}

@test "yr_prog_enters resolves a slash-containing word against the cwd and the worktree" {
  mkdir -p sub "$BATS_TEST_TMPDIR/own"
  printf '#!/bin/sh\nexit 0\n' >| sub/evil
  chmod +x sub/evil
  printf '#!/bin/sh\nexit 0\n' >| "$BATS_TEST_TMPDIR/own/tool"
  local root="$PWD"
  yr_prog_enters ./sub/evil "$root"
  yr_prog_enters sub/evil "$root"
  # cwd outside the worktree: a relative word that exists under the worktree counts
  ( cd "$BATS_TEST_TMPDIR" && yr_prog_enters sub/evil "$root" )
  ! yr_prog_enters "$BATS_TEST_TMPDIR/own/tool" "$root"
  ! yr_prog_enters ssh "$root"
  ! yr_prog_enters '' "$root"
}

@test "rp_ignored_changed_since ignores vitest's results cache behind a symlinked .vite directory but not its siblings" {
  ignored_repo
  mkdir -p ext-cache/vitest node_modules
  printf '{}\n' >| ext-cache/vitest/results.json
  printf 'old\n' >| ext-cache/chunk.js
  touch -t 201901010000 ext-cache/vitest/results.json ext-cache/chunk.js
  ln -s ../ext-cache node_modules/.vite
  touch -h -t 201901010000 node_modules/.vite
  printf '{"version":"1.6.0","results":{}}\n' >| ext-cache/vitest/results.json
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  # A sibling file behind the same link is still code: refuse.
  printf 'new\n' >| ext-cache/chunk.js
  run rp_ignored_changed_since "$MARKER" "$SCRATCH"
  [ "$status" -eq 1 ]
  [ "$output" = node_modules/.vite ]
}
