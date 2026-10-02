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
        .github|*/.github|.github/*|*/.github/*) return 0 ;;
        .circleci|*/.circleci|.circleci/*|*/.circleci/*) return 0 ;;
        .git|*/.git|.git/*|*/.git/*) return 0 ;;
        .claude|*/.claude|.claude/*|*/.claude/*) return 0 ;;
        .vscode|*/.vscode|.vscode/*|*/.vscode/*) return 0 ;;
        .devcontainer|*/.devcontainer|.devcontainer/*|*/.devcontainer/*) return 0 ;;
        .idea|*/.idea|.idea/*|*/.idea/*) return 0 ;;
        .cursor|*/.cursor|.cursor/*|*/.cursor/*) return 0 ;;
        .codex|*/.codex|.codex/*|*/.codex/*) return 0 ;;
        .agents|*/.agents|.agents/*|*/.agents/*) return 0 ;;
        .gemini|*/.gemini|.gemini/*|*/.gemini/*) return 0 ;;
        .windsurf|*/.windsurf|.windsurf/*|*/.windsurf/*) return 0 ;;
        .cline|*/.cline|.cline/*|*/.cline/*) return 0 ;;
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

# rp_runtime_override_rels: the repository-relative, lowercased path(s) that
# YELLOW_REVIEW_GITHUB_STACK_RUNTIME names, one per line: the path as given
# (its directory made physical) and each symlink hop down to the file node
# would run. Prints nothing when the variable is unset, the file is outside
# the repository or the path cannot be resolved. Relative values resolve from
# the current directory, as `node "$RUNTIME"` does.
rp_runtime_override_rels() {
    local p="${YELLOW_REVIEW_GITHUB_STACK_RUNTIME:-}" top dir t hops=0
    [ -n "$p" ] || return 0
    top=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
    top=$(cd -- "$top" 2>/dev/null && pwd -P) || return 0
    while :; do
        dir=$(cd -- "$(dirname -- "$p")" 2>/dev/null && pwd -P) || return 0
        p="${dir%/}/${p##*/}"
        case "$p" in
            "$top"/*) printf '%s\n' "$(rp_lower "${p#"$top"/}")" ;;
        esac
        [ -L "$p" ] || return 0
        hops=$((hops + 1))
        [ "$hops" -le 40 ] || return 0
        t=$(readlink -- "$p") || return 0
        case "$t" in
            /*) p="$t" ;;
            *) p="${p%/*}/$t" ;;
        esac
    done
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
    local l hooks top rc ov ovs
    l=$(rp_lower "$1")
    # The resolve runtime itself: the orchestrator executes these scripts and
    # sources these libraries, so an edit by an unattended resolver would run
    # with the orchestrator's authority. Matched by repository-relative prefix
    # (a source checkout of this plugin), at any depth below it. Sibling
    # plugin files that commit-resolve-fixes executes from the same checkout
    # count too: the github-workflow runtime (`node "$RUNTIME" submit`, found
    # by find_runtime) and yellow-core's compound-staging.sh (sourced for log
    # redaction and the review ledger).
    case "$l" in
        plugins/yellow-review/skills/pr-review-workflow/scripts/*) return 0 ;;
        plugins/yellow-review/lib/*|plugins/yellow-review/hooks/*) return 0 ;;
        plugins/github-workflow/lib/*) return 0 ;;
        plugins/yellow-core/lib/compound-staging.sh) return 0 ;;
    esac
    # YELLOW_REVIEW_GITHUB_STACK_RUNTIME replaces the sibling runtime above
    # with any file, so that file counts too when it sits in this repository.
    # One outside the repository is not a PR file and is left alone.
    ovs=$(rp_runtime_override_rels 2>/dev/null || true)
    if [ -n "$ovs" ]; then
        while IFS= read -r ov; do
            if [ -n "$ov" ] && [ "$l" = "$ov" ]; then return 0; fi
        done <<<"$ovs"
    fi
    # Only the repository-root scripts/ directory: build and hook tooling
    # lives there. Other nested scripts/ directories (e.g. another plugin's
    # skills/*/scripts/) are ordinary sources that hooks do not run.
    case "/$l" in
        /scripts/*|/.husky|*/.husky|/.husky/*|*/.husky/*|/.cargo|*/.cargo|/.cargo/*|*/.cargo/*) return 0 ;;
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
        # The entry itself and every ancestor prefix count too: a tracked
        # symlink (e.g. .hooks for hooksPath .hooks/bin) can be repointed at a
        # directory holding an executable hook, and Git follows it.
        while [ -n "$hooks" ]; do
            case "$l" in "$hooks"|"$hooks"/*) return 0 ;; esac
            case "$hooks" in */*) hooks="${hooks%/*}" ;; *) break ;; esac
        done
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
# it removes on exit). Gitignored files are not listed (--exclude-standard);
# rp_ignored_changed_since covers them.
rp_tree_changes() {
    local err rc=0
    err=$({ git diff --no-renames --name-only -z HEAD -- \
        && git ls-files --others --exclude-standard -z; } 2>&1 >"$1") || rc=$?
    if [ "$rc" -ne 0 ]; then
        printf 'rp_tree_changes: %s\n' "${err%%$'\n'*}" >&2
        return "$rc"
    fi
}

# rp_link_target_changed <symlink> <marker>: judge what a symlink points to,
# not the link: a write through it changes the target's mtime and leaves the
# link's alone. The operating system resolves the chain, so a relative target
# is taken from the link's own directory. Returns 0 when the target is a
# regular file with an mtime newer than <marker>, or a directory holding a
# regular file that is (find -H, so symlinks nested below it are not followed;
# `.git` entries skipped). Returns 1 when it is unchanged, not a regular file or
# directory, or dangling (nothing to write to). Returns 2 when it cannot tell:
# the link cannot be read, the target directory cannot be walked, or the target
# is hidden behind a directory that cannot be searched. Run it from the working
# tree root with a path that does not begin with `-`.
rp_link_target_changed() {
    local l="$1" marker="$2" t p d out rc=0
    if [ -e "$l" ]; then
        if [ -d "$l" ]; then
            out=$(set -o pipefail
                find -H "$l" -name .git -prune -o -type f -newer "$marker" -print 2>/dev/null \
                    | head -n 1) || rc=$?
            [ -z "$out" ] || return 0
            [ "$rc" -eq 0 ] || return 2
            return 1
        fi
        [ -f "$l" ] || return 1
        [ "$l" -nt "$marker" ] && return 0
        return 1
    fi
    # Not found: a dangling link, or a target behind a directory that cannot be
    # searched. The nearest existing ancestor tells them apart.
    t=$(readlink -- "$l" 2>/dev/null) || return 2
    case "$t" in
        /*) p="$t" ;;
        *) p="${l%/*}/$t" ;;
    esac
    d="$p"
    while :; do
        d=$(dirname -- "$d") || return 2
        if [ -e "$d" ]; then
            if [ -d "$d" ] && [ ! -x "$d" ]; then return 2; fi
            return 1
        fi
    done
}

# rp_ignored_changed_since <marker> <scratch>: the guard for gitignored files,
# which rp_tree_changes cannot see: a resolver edit to an ignored executable
# (node_modules/.bin/<runner>) would run with the verify command. A resolver
# cannot backdate a file's mtime (it only has edit tools), so any ignored
# regular file or symlink with an mtime newer than <marker> (a file the
# caller touched before the resolvers started) counts as changed. A symlink
# counts when its own mtime is newer, and its target is judged too, because a
# write through the link leaves the link's mtime alone: see
# rp_link_target_changed. Every ignored symlink is examined, those inside
# ignored directories included. `.git` is skipped as a walked directory, not
# as a link target. Prints up to 20
# repository-relative paths, one per line (control characters shown as `?`,
# never file contents), and returns 1 when any file changed; a symlink is named
# by its own path. Returns 0 when none did and 2 when it cannot tell: the
# marker is missing, unreadable, not a regular file or a symlink, git or find
# fails, or a symlink's target cannot be examined. A caller must treat 2 as a
# refusal. Whole ignored directories are walked with find; the caller owns
# <scratch>, a scratch file for git's NUL-delimited listing.
rp_ignored_changed_since() {
    local marker="$1" scratch="$2" mdir
    [ -f "$marker" ] && [ ! -L "$marker" ] && [ -r "$marker" ] || return 2
    mdir=$(cd -- "$(dirname -- "$marker")" 2>/dev/null && pwd) || return 2
    marker="$mdir/$(basename -- "$marker")"
    (
        local top f out p l rc lrc symlist n=0 hits=""
        top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 2
        cd -- "$top" 2>/dev/null || exit 2
        symlist=$(mktemp) || exit 2
        trap 'rm -f -- "$symlist"' EXIT
        git ls-files --others --ignored --exclude-standard --directory -z >|"$scratch" 2>/dev/null || exit 2
        while IFS= read -r -d '' f; do
            case "$f" in .git|.git/*|*/.git|*/.git/*) continue ;; esac
            out=""
            rc=0
            if [ "${f%/}" != "$f" ]; then
                # A wholly ignored directory. head bounds the output, so a
                # tree rewritten end to end cannot fill memory; a find that
                # fails with nothing found is "cannot tell".
                out=$(set -o pipefail
                    find "./$f" -name .git -prune -o \( -type f -o -type l \) -newer "$marker" -print 2>/dev/null \
                        | head -n 20) || rc=$?
                if [ -z "$out" ] && [ "$rc" -eq 0 ]; then
                    # Nothing newer: judge the target of each symlink inside.
                    find "./$f" -name .git -prune -o -type l -print0 >|"$symlist" 2>/dev/null || exit 2
                    while IFS= read -r -d '' l; do
                        lrc=0
                        rp_link_target_changed "$l" "$marker" || lrc=$?
                        case "$lrc" in
                            0) out="$l"; break ;;
                            1) ;;
                            *) exit 2 ;;
                        esac
                    done <"$symlist"
                fi
            elif [ -L "./$f" ]; then
                out=$(find "./$f" -type l -newer "$marker" -print 2>/dev/null) || rc=$?
                if [ -z "$out" ] && [ "$rc" -eq 0 ]; then
                    lrc=0
                    rp_link_target_changed "./$f" "$marker" || lrc=$?
                    case "$lrc" in
                        0) out="./$f" ;;
                        1) ;;
                        *) exit 2 ;;
                    esac
                fi
            elif [ -f "./$f" ]; then
                [ "./$f" -nt "$marker" ] && out="./$f"
            fi
            if [ -z "$out" ]; then
                [ "$rc" -eq 0 ] || exit 2
                continue
            fi
            while IFS= read -r p; do
                [ -n "$p" ] || continue
                p="${p#./}"
                p="${p//[[:cntrl:]]/?}"
                # git lists an ignored symlink on its own and, when its whole
                # directory is ignored, again as part of that directory.
                case $'\n'"$hits" in *$'\n'"$p"$'\n'*) continue ;; esac
                n=$((n + 1))
                hits="${hits}${p}"$'\n'
                [ "$n" -lt 20 ] || break
            done <<<"$out"
            [ "$n" -lt 20 ] || break
        done <"$scratch"
        if [ "$n" -gt 0 ]; then
            printf '%s' "$hits"
            exit 1
        fi
        exit 0
    )
}

# rp_hooks_untracked <outfile>: the dirty-set guard cannot see a resolver edit
# to an untracked or gitignored hook, and `git commit` would run it. Resolves
# the effective hooks directory (`git rev-parse --git-path hooks`, which
# honours core.hooksPath). Prints its repository-relative path and returns 0
# when it lies inside the working tree (the git directory does not count) and
# any file under it is untracked or ignored; returns 1 when it is fine (no such
# directory, outside the working tree, or every file tracked), 2 when it
# cannot be inspected and 3 when the hooks path passes through a symlink that
# lives inside the working tree (the git directory included, so a symlinked
# .git/hooks or .git counts). A caller must treat 2 and 3 as refusals. On 3 it
# prints the repository-relative path of that symlink: a resolver can edit
# through it, to a target Git status never lists, and the commit would run the
# edit. The path is walked component by component from the configured value
# (made absolute against the working tree root), and only a symlink located
# inside the working tree counts; a symlink above or outside it is just a way
# to reach the directory. The caller owns <outfile>, a scratch file. Tools that
# keep generated hooks in an ignored directory (husky's .husky/_) are refused
# too: their files cannot be told from a planted one.
rp_hooks_untracked() {
    (
        local hp top gitdir rel cur rest c next spec=()
        top=$(git rev-parse --show-toplevel 2>/dev/null) || exit 2
        cd -- "$top" 2>/dev/null || exit 2
        top=$(pwd -P) || exit 2
        hp=$(git rev-parse --git-path hooks 2>/dev/null) || exit 2
        [ -n "$hp" ] || exit 2
        [ -d "$hp" ] || exit 1
        # Walk the path as the kernel does: cur is always a physical directory,
        # a symlink outside the working tree is followed, one inside refuses.
        case "$hp" in /*) cur=/ ;; *) cur="$top" ;; esac
        rest="$hp"
        while [ -n "$rest" ]; do
            c="${rest%%/*}"
            case "$rest" in */*) rest="${rest#*/}" ;; *) rest="" ;; esac
            case "$c" in
                ''|.) continue ;;
                ..) cur=$(dirname -- "$cur") || exit 2; continue ;;
            esac
            next="${cur%/}/$c"
            if [ -L "$next" ]; then
                case "$cur" in
                    "$top"|"$top"/*)
                        printf '%s' "${next#"$top"/}"
                        exit 3
                        ;;
                esac
                cur=$(cd -P -- "$next" 2>/dev/null && pwd -P) || exit 2
            else
                cur="$next"
            fi
        done
        hp=$(cd -- "$hp" 2>/dev/null && pwd -P) || exit 2
        gitdir=$(git rev-parse --git-common-dir 2>/dev/null) || exit 2
        gitdir=$(cd -- "$gitdir" 2>/dev/null && pwd -P) || exit 2
        case "$hp" in "$gitdir"|"$gitdir"/*) exit 1 ;; esac
        case "$hp" in
            "$top") rel=. ;;
            "$top"/*) rel="${hp#"$top"/}" ;;
            *) exit 1 ;;
        esac
        # The whole tree when the hooks directory is the repository root.
        [ "$rel" = . ] || spec=(-- "$rel")
        lgit ls-files --others --directory --no-empty-directory -z ${spec[@]+"${spec[@]}"} >|"$1" 2>/dev/null || exit 2
        [ -s "$1" ] || exit 1
        printf '%s' "$rel"
        exit 0
    )
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
