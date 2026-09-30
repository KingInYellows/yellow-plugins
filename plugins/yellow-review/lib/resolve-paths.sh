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

# rp_canonical <path>: repo-relative with no empty, `.` or `..` segment and
# no control characters.
rp_canonical() {
    local rest="$1" seg
    [ -n "$rest" ] || return 1
    [[ "$rest" =~ [[:cntrl:]] ]] && return 1
    case "$rest" in /*|*/) return 1 ;; esac
    while :; do
        seg="${rest%%/*}"
        case "$seg" in ''|.|..) return 1 ;; esac
        [ "$rest" = "$seg" ] && return 0
        rest="${rest#*/}"
    done
}

# rp_denied <path>: the resolver deny list, matched case-insensitively
# (macOS and WSL mounts are case-insensitive).
rp_denied() {
    local l
    l=$(rp_lower "$1")
    case "$l" in
        .github/*|.circleci/*|.git/*|.claude/*|.vscode/*|.devcontainer/*|.idea/*) return 0 ;;
        yellow-plugins.local.md|claude.md|agents.md|.mcp.json) return 0 ;;
    esac
    case "${l##*/}" in
        .gitlab-ci.yml|.travis.yml|.drone.yml|jenkinsfile|azure-pipelines.yml|bitbucket-pipelines.yml) return 0 ;;
        dockerfile|dockerfile.*|*.dockerfile|docker-compose*.yml|docker-compose*.yaml|compose.yml|compose.yaml) return 0 ;;
        .env|.env.*|secrets.*|*.pem|*.key|*.p12|*.pfx|*.tfvars|*.tfstate) return 0 ;;
    esac
    return 1
}

# rp_runner <path>: files a verify command, package manager or git hook
# would execute.
rp_runner() {
    local l hooks top
    l=$(rp_lower "$1")
    case "/$l" in
        /scripts/*|*/scripts/*|/.husky/*|*/.husky/*|/.cargo/*|*/.cargo/*) return 0 ;;
    esac
    case "${l##*/}" in
        package.json|package-lock.json|npm-shrinkwrap.json|pnpm-lock.yaml|yarn.lock|bun.lock|bun.lockb) return 0 ;;
        .npmrc|.pnpmfile.cjs|.yarnrc|.yarnrc.*|.envrc|mise.toml|.mise.toml) return 0 ;;
        makefile|gnumakefile|justfile|rakefile|taskfile.yml|taskfile.yaml) return 0 ;;
        conftest.py|pyproject.toml|setup.py|setup.cfg|tox.ini|pytest.ini|noxfile.py|build.rs) return 0 ;;
        .pre-commit-config.yaml|lefthook*.yml|lefthook*.yaml|.lintstagedrc*) return 0 ;;
        *.config.*|.eslintrc*|.prettierrc*|.babelrc*|.mocharc*) return 0 ;;
    esac
    hooks=$(git config --get core.hooksPath 2>/dev/null || true)
    if [ -n "$hooks" ]; then
        top=$(git rev-parse --show-toplevel 2>/dev/null || true)
        [ -n "$top" ] && hooks="${hooks#"$top"/}"
        hooks=$(rp_lower "${hooks#./}")
        case "$l" in "${hooks%/}"/*) return 0 ;; esac
    fi
    return 1
}

# rp_pr_files <pr>: the PR's changed file names, one per line. Uses the
# files API, which works past GitHub's diff-size limits (gh pr diff does not).
rp_pr_files() {
    gh api --paginate "repos/{owner}/{repo}/pulls/$1/files?per_page=100" --jq '.[].filename'
}
