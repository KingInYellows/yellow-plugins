# shell-compat: library
# Path rules shared by commit-resolve-fixes and run-verify-command (bash;
# sourced). Resolver file lists are untrusted: every path must be canonical,
# on the PR's changed-file list, off the deny list and, for unattended runs,
# not a file that a git hook, package manager or verify command would
# execute. Contract: references/resolve/dispositions.md ("File set").
# shellcheck shell=bash

# Git with listed paths taken literally (no globs or pathspec magic). A
# per-call flag, not GIT_LITERAL_PATHSPECS, so hooks, gt and the verify
# command never inherit it.
lgit() { git --literal-pathspecs "$@"; }

rp_lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# rp_canonical <path>: repo-relative with no empty, `.` or `..` segment, no
# segment starting with `-` (option-shaped names) and no control characters.
rp_canonical() {
    local rest="$1" seg
    [ -n "$rest" ] || return 1
    [[ "$rest" =~ [[:cntrl:]] ]] && return 1
    case "$rest" in /*|*/) return 1 ;; esac
    while :; do
        seg="${rest%%/*}"
        case "$seg" in ''|.|..|-*) return 1 ;; esac
        [ "$rest" = "$seg" ] && return 0
        rest="${rest#*/}"
    done
}

# rp_denied <path>: the resolver deny list, matched case-insensitively
# (macOS and WSL mounts are case-insensitive) and at any depth: a nested
# .claude/ or CLAUDE.md steers tooling just as the root one does.
rp_denied() {
    local l
    l=$(rp_lower "$1")
    case "$l" in
        .github/*|*/.github/*|.circleci/*|*/.circleci/*|.git/*|*/.git/*) return 0 ;;
        .claude/*|*/.claude/*|.vscode/*|*/.vscode/*) return 0 ;;
        .devcontainer/*|*/.devcontainer/*|.idea/*|*/.idea/*) return 0 ;;
        .cursor/*|*/.cursor/*|.codex/*|*/.codex/*|.agents/*|*/.agents/*) return 0 ;;
        .gemini/*|*/.gemini/*|.windsurf/*|*/.windsurf/*|.cline/*|*/.cline/*) return 0 ;;
    esac
    case "${l##*/}" in
        yellow-plugins.local.md|claude.md|agents.md|gemini.md|.mcp.json) return 0 ;;
        .cursorrules|.windsurfrules|.clinerules|copilot-instructions.md) return 0 ;;
        .gitlab-ci.yml|.travis.yml|.drone.yml|jenkinsfile|azure-pipelines.yml|bitbucket-pipelines.yml) return 0 ;;
        dockerfile*|*.dockerfile|docker-compose*.yml|docker-compose*.yaml|compose.yml|compose.yaml) return 0 ;;
        .env*|secrets.*|*.pem|*.key|*.p12|*.pfx|*.tfvars|*.tfstate) return 0 ;;
    esac
    return 1
}

# rp_runner <path>: files a verify command, package manager or git hook
# would execute or evaluate. A deny list of known entry points, not a proof:
# a test run still executes any source file the suite imports, which is why
# unattended verify is opt-in (references/resolve/dispositions.md). Included:
# build and package manifests that a build tool evaluates (build.gradle,
# Gemfile, *.gemspec, Cargo.toml, composer.json, pom.xml, CMakeLists.txt) and
# test bootstrap files a runner loads before any test (jest.setup.*,
# setupTests.*, spec_helper.rb, test_helper.*, phpunit.xml) and other
# ecosystems' manifests (mix.exs, Package.swift, build.zig, *.csproj,
# deno.json[c], bunfig.toml). Left out:
# go.mod and requirements.txt (declarative, never executed) and __init__.py
# (any package has them; too broad).
rp_runner() {
    local l hooks top rc
    l=$(rp_lower "$1")
    # Only the repository-root scripts/ directory: build and hook tooling
    # lives there. Nested scripts/ directories (e.g. a plugin's own
    # skills/*/scripts/) are ordinary sources that hooks do not run.
    case "/$l" in
        /scripts/*|/.husky/*|*/.husky/*|/.cargo/*|*/.cargo/*) return 0 ;;
    esac
    case "${l##*/}" in
        package.json|package-lock.json|npm-shrinkwrap.json|pnpm-lock.yaml|yarn.lock|bun.lock|bun.lockb) return 0 ;;
        .npmrc|.pnpmfile.cjs|.yarnrc|.yarnrc.*|.envrc|mise.toml|.mise.toml) return 0 ;;
        makefile|gnumakefile|justfile|rakefile|taskfile.yml|taskfile.yaml) return 0 ;;
        conftest.py|pyproject.toml|setup.py|setup.cfg|tox.ini|pytest.ini|noxfile.py|build.rs) return 0 ;;
        build.gradle|build.gradle.kts|settings.gradle|settings.gradle.kts|gradlew|gradlew.bat|build.sbt|pom.xml) return 0 ;;
        gemfile|gemfile.lock|*.gemspec|cargo.toml|cargo.lock|composer.json|composer.lock) return 0 ;;
        mix.exs|package.swift|build.zig|build.zig.zon|*.csproj|*.fsproj|*.vbproj) return 0 ;;
        directory.build.props|directory.build.targets|deno.json|deno.jsonc|bunfig.toml) return 0 ;;
        cmakelists.txt|meson.build|.rspec|spec_helper.rb|rails_helper.rb|test_helper.rb|test_helper.exs|test_helper.py) return 0 ;;
        jest.setup.[cm]js|jest.setup.[cm]ts|jest.setup.js|jest.setup.ts|jest.setup.jsx|jest.setup.tsx) return 0 ;;
        vitest.setup.[cm]js|vitest.setup.[cm]ts|vitest.setup.js|vitest.setup.ts|vitest.setup.jsx|vitest.setup.tsx) return 0 ;;
        setuptests.[cm]js|setuptests.[cm]ts|setuptests.js|setuptests.ts|setuptests.jsx|setuptests.tsx) return 0 ;;
        karma.conf.*|phpunit.xml|phpunit.xml.dist|phpunit.dist.xml) return 0 ;;
        .pre-commit-config.yaml|lefthook*.yml|lefthook*.yaml|.lintstagedrc*) return 0 ;;
        *.config.*|.eslintrc*|.prettierrc*|.babelrc*|.mocharc*) return 0 ;;
    esac
    # Exit 1 is "unset". Any other failure (unreadable or invalid config)
    # means the hooks directory is unknown, so treat every path as a runner.
    rc=0
    hooks=$(git config --get core.hooksPath 2>/dev/null) || rc=$?
    [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ] || return 0
    if [ -n "$hooks" ]; then
        top=$(git rev-parse --show-toplevel 2>/dev/null || true)
        # Normalise to a path relative to the toplevel: strip an absolute
        # toplevel prefix, leading ./ segments and trailing slashes. Git
        # resolves a relative hooksPath from the toplevel too.
        if [ -n "$top" ]; then
            case "$hooks" in "$top"|"$top"/*)
                hooks="${hooks#"$top"}"
                # Repeated separators (TOP//hooks) name the same directory.
                while [ "${hooks#/}" != "$hooks" ]; do hooks="${hooks#/}"; done ;;
            esac
        fi
        while :; do
            case "$hooks" in
                ./*) hooks="${hooks#./}" ;;
                */) hooks="${hooks%/}" ;;
                *) break ;;
            esac
        done
        # A hooks path that is the repository root itself: Git runs every
        # root-level file as a hook, so any path without a slash is a runner.
        if [ -z "$hooks" ] || [ "$hooks" = . ]; then
            case "$l" in */*) return 1 ;; *) return 0 ;; esac
        fi
        hooks=$(rp_lower "$hooks")
        # The entry itself counts too: a tracked symlink (e.g. .hooks) can be
        # repointed at a directory holding an executable hook.
        case "$l" in "$hooks"|"$hooks"/*) return 0 ;; esac
    fi
    return 1
}

# rp_pr_files <pr>: the PR's changed file names, one per line. Uses the
# files API, which works past GitHub's diff-size limits (gh pr diff does not).
# A name containing a newline or carriage return is dropped: it would render
# as several lines and could forge an allowlist entry. Dropping fails closed
# (that file is never treated as in the PR).
rp_pr_files() {
    gh api --paginate "repos/{owner}/{repo}/pulls/$1/files?per_page=100" \
        --jq '.[].filename | select(test("[\n\r]") | not)'
}

# rp_tree_changes <outfile>: every change in the tree, as git lists it
# (tracked or staged, then untracked; the two sets are disjoint),
# NUL-delimited so a newline in a filename cannot forge a second path. A
# listing failure returns non-zero and must stop the caller, never read as
# "clean", and git's first stderr line goes to stderr so the caller's own
# message can sit beside the cause. The caller owns <outfile> (a mktemp file
# it removes on exit).
rp_tree_changes() {
    local err rc=0
    err=$({ git diff --no-renames --name-only -z HEAD -- \
        && git ls-files --others --exclude-standard -z; } 2>&1 >"$1") || rc=$?
    if [ "$rc" -ne 0 ]; then
        printf 'rp_tree_changes: %s\n' "${err%%$'\n'*}" >&2
        return "$rc"
    fi
}

# rp_assert_only_listed <changes-file> [path...]: succeeds when every path in
# the NUL-delimited <changes-file> is one of the listed paths. Otherwise
# prints the first unlisted path and returns 1.
rp_assert_only_listed() {
    local list="$1" d f found
    shift
    while IFS= read -r -d '' d || [ -n "$d" ]; do
        [ -n "$d" ] || continue
        found=0
        for f in "$@"; do
            [ "$d" = "$f" ] && { found=1; break; }
        done
        [ "$found" = 1 ] || { printf '%s' "$d"; return 1; }
    done <"$list"
    return 0
}

# rp_read_file_list <file>: append the non-empty lines of <file> to the
# global RP_FILES array. Returns 1 when <file> is not a readable regular file.
RP_FILES=()
rp_read_file_list() {
    local line
    [ -f "$1" ] && [ -r "$1" ] || return 1
    while IFS= read -r line || [ -n "$line" ]; do
        [ -n "$line" ] && RP_FILES+=("$line")
    done <"$1"
    return 0
}

# rp_sibling_file <plugin-root> <plugin> <relpath>: print the path of a file
# in a sibling plugin. Source tree first (plugins/<plugin>/<relpath>), then
# the newest numeric version in the installed cache
# (<marketplace>/<plugin>/<version>/<relpath>). <plugin-root> is this
# plugin's directory (cache: <marketplace>/<name>/<version>/).
rp_sibling_file() {
    local root="$1" plugin="$2" rel="$3" path dir name ver
    path="$root/../$plugin/$rel"
    if [ -f "$path" ]; then
        printf '%s' "$path"
        return 0
    fi
    ver=$(for dir in "$root/../../$plugin"/*/; do
        name="${dir%/}"; name="${name##*/}"
        [[ "$name" =~ ^[0-9]+(\.[0-9]+)*$ ]] && printf '%s\n' "$name"
    done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
    path="$root/../../$plugin/$ver/$rel"
    [ -n "$ver" ] && [ -f "$path" ] && { printf '%s' "$path"; return 0; }
    return 1
}
