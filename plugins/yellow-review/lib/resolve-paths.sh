# shell-compat: library
# Path rules shared by commit-resolve-fixes and run-verify-command (bash;
# sourced). Resolver file lists are untrusted: every path must be canonical,
# off the deny list and, for unattended commits, not a file that a git hook
# or verify command would execute. Contract: references/resolve/dispositions.md
# ("File set"). Callers also export GIT_LITERAL_PATHSPECS=1.
# shellcheck shell=bash

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
        .github/*|.circleci/*|.git/*|.claude/*) return 0 ;;
        yellow-plugins.local.md|claude.md|agents.md|.mcp.json) return 0 ;;
    esac
    case "${l##*/}" in
        .gitlab-ci.yml|jenkinsfile|azure-pipelines.yml|dockerfile|docker-compose.yml) return 0 ;;
        .env|.env.*|secrets.*|*.pem|*.key|*.p12|*.pfx|*.tfvars|*.tfstate) return 0 ;;
    esac
    return 1
}

# rp_runner <path>: files a verify command or a git hook would execute.
rp_runner() {
    local l hooks
    l=$(rp_lower "$1")
    case "$l" in
        scripts/*|.husky/*) return 0 ;;
    esac
    case "${l##*/}" in
        package.json|package-lock.json|npm-shrinkwrap.json|pnpm-lock.yaml|yarn.lock|bun.lock|bun.lockb) return 0 ;;
        makefile|gnumakefile|conftest.py|.pre-commit-config.yaml|lefthook*.yml|lefthook*.yaml|.lintstagedrc*) return 0 ;;
        *.config.*) return 0 ;;
    esac
    hooks=$(git config --get core.hooksPath 2>/dev/null || true)
    hooks="${hooks#./}"
    if [ -n "$hooks" ]; then
        case "$1" in "${hooks%/}"/*) return 0 ;; esac
    fi
    return 1
}
