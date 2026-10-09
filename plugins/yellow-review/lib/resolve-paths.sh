# shell-compat: library
# Path rules shared by commit-resolve-fixes and run-verify-command (bash;
# sourced). Resolver file lists are untrusted: every path must be canonical,
# on the PR's changed-file list, off the deny list and, for unattended runs,
# not a file that a git hook, package manager or verify command would
# execute. Contract: references/resolve/dispositions.md ("File set").
# shellcheck shell=bash

# sp_sibling_file: the sibling-plugin lookup shared with review-ledger.sh.
# shellcheck source=sibling-plugin.sh
. "$(dirname -- "${BASH_SOURCE[0]}")/sibling-plugin.sh"

# yr_helper <name>: a helper the trust check itself must run (readlink). Looked
# up in fixed system directories, never on PATH: a PATH directory inside the
# worktree could hold a planted one that runs before any check. Fails closed
# when none of the fixed locations has it.
yr_helper() {
    local name="$1" cand
    for cand in "/usr/bin/$name" "/bin/$name" "/run/current-system/sw/bin/$name"; do
        if [ -f "$cand" ] && [ -x "$cand" ]; then
            printf '%s\n' "$cand"
            return 0
        fi
    done
    return 1
}
# yr_canon_path <path>: absolute path with every symlink followed, at most
# 40 hops. A component walk, not dirname and not realpath: a directory
# symlink and the final file both count. Prints the path. Returns 1 on a
# loop or an unreadable link. Does not execute the path and writes nothing.
yr_canon_path() {
    local input="$1" hops=0
    local cur="" rest comp next target rl
    [ -n "$input" ] || return 1
    case "$input" in
        /*) ;;
        *) input="$(pwd -P)/$input" || return 1 ;;
    esac
    rest="${input#/}"
    while [ -n "$rest" ]; do
        comp="${rest%%/*}"
        case "$rest" in
            */*) rest="${rest#*/}" ;;
            *) rest="" ;;
        esac
        case "$comp" in
            ''|.) continue ;;
            ..)
                case "$cur" in
                    ""|/) cur="" ;;
                    /*/*) cur="${cur%/*}" ;;
                    /*) cur="" ;;
                esac
                continue
                ;;
        esac
        case "$cur" in
            "") next="/$comp" ;;
            *) next="$cur/$comp" ;;
        esac
        if [ -L "$next" ]; then
            hops=$((hops + 1))
            [ "$hops" -le 40 ] || return 1
            rl=$(yr_helper readlink) || return 1
            target=$("$rl" -- "$next") || return 1
            case "$target" in
                /*)
                    cur=""
                    rest="${target#/}${rest:+/$rest}"
                    ;;
                *) rest="${target}${rest:+/$rest}" ;;
            esac
            continue
        fi
        cur="$next"
    done
    [ -n "$cur" ] || return 1
    printf '%s\n' "$cur"
}

# yr_worktree_root: the directory that contains .git, walking up from the
# physical cwd. Does not execute git (the candidate may be the file under test)
# or any PATH helper: the parent is taken with parameter expansion.
yr_worktree_root() {
    local d
    d=$(pwd -P) || return 1
    while [ -n "$d" ]; do
        if [ -e "$d/.git" ]; then
            printf '%s\n' "$d"
            return 0
        fi
        [ "$d" = / ] && return 1
        d=${d%/*}
        [ -n "$d" ] || d=/
    done
    return 1
}

# yr_inside_root <path> <root>: succeed when <path> is <root> or below it,
# by spelling or by identity. The spelling test alone misses a path that
# reaches the worktree under different casing on a case-insensitive
# filesystem (macOS volumes, WSL mounts), so every ancestor is also compared
# with the root through the filesystem (-ef, same device and inode).
yr_inside_root() {
    local p="$1" root="$2" d
    case "$p" in
        "$root"|"$root"/*) return 0 ;;
    esac
    d="$p"
    while [ -n "$d" ] && [ "$d" != / ]; do
        if [ "$d" -ef "$root" ]; then
            return 0
        fi
        d=${d%/*}
    done
    return 1
}

# yr_resolve_tool <name>: print one absolute path whose canonical file is
# outside the worktree. Return 1 when <name> is not on PATH, 2 when that
# canonical file is inside the worktree, 3 when the path cannot be
# canonicalized. Does not execute the tool. A caller that already resolved
# git stores it in YELLOW_REVIEW_GIT; yr_git reuses that and does not look
# up PATH again. The variable is not written to a file.
# The printed path is the absolute PATH hit, not the final symlink target:
# git-ai's canonical file ignores git commands unless argv[0] is named git.
yr_resolve_tool() {
    local name="$1" bin canon root invoke
    bin=$(type -P "$name" 2>/dev/null) || return 1
    [ -n "$bin" ] || return 1
    case "$bin" in
        /*) invoke="$bin" ;;
        *) invoke="$(pwd -P)/$bin" || return 3 ;;
    esac
    canon=$(yr_canon_path "$invoke") || return 3
    [ -f "$canon" ] || return 3
    root=$(yr_worktree_root || true)
    if [ -n "$root" ]; then
        yr_inside_root "$canon" "$root" && return 2
        yr_inside_root "$invoke" "$root" && return 2
    fi
    printf '%s\n' "$invoke"
}

# yr_git: the one git binary. Reuses YELLOW_REVIEW_GIT when a caller resolved
# it before this file was sourced; otherwise resolves it once.
yr_git() {
    if [ -z "${YELLOW_REVIEW_GIT:-}" ]; then
        YELLOW_REVIEW_GIT=$(yr_resolve_tool git) || return $?
    fi
    # Git runs the stock git-lfs filters (and other helpers) by name through
    # PATH: run it with a PATH from which relative entries and entries inside
    # the worktree are dropped, so a resolver-written git-lfs cannot run.
    if [ -z "${YR_GIT_PATH:-}" ]; then
        YR_GIT_PATH=$(yr_safe_path) || return $?
    fi
    PATH=$YR_GIT_PATH "$YELLOW_REVIEW_GIT" "$@"
}

# yr_safe_path: print PATH without empty or relative entries and without any
# entry inside the worktree (by spelling, canonical path or identity). Returns
# 1 when nothing is left. The caller's PATH is not changed; the verify command
# keeps its own PATH (it may need node_modules/.bin).
yr_safe_path() {
    local root rest entry canon kept=""
    root=$(yr_worktree_root || true)
    rest="${PATH}:"
    while [ -n "$rest" ]; do
        entry="${rest%%:*}"
        rest="${rest#*:}"
        case "$entry" in /*) ;; *) continue ;; esac
        if [ -n "$root" ]; then
            canon=$(yr_canon_path "$entry" 2>/dev/null || true)
            if yr_inside_root "$entry" "$root" || { [ -n "$canon" ] && yr_inside_root "$canon" "$root"; }; then
                continue
            fi
        fi
        kept="${kept:+$kept:}$entry"
    done
    [ -n "$kept" ] || return 1
    printf '%s\n' "$kept"
}

# yr_awk: awk looked up through the same worktree-free PATH as yr_git, so a
# resolver-written awk in a PATH directory inside the worktree cannot run.
# Recomputes the path when YR_GIT_PATH is unset (yr_git sets it in a subshell
# when called inside $(...), so the parent may not have it).
yr_awk() {
    local safe=${YR_GIT_PATH:-}
    [ -n "$safe" ] || safe=$(yr_safe_path) || return $?
    PATH=$safe awk "$@"
}

# Git with listed paths taken literally (no globs or pathspec magic). A
# per-call flag, not GIT_LITERAL_PATHSPECS, so hooks, gt and the verify
# command never inherit it.
#
# core.fsmonitor is a command pathname when it is not a boolean, and git runs
# it on a status, diff or index refresh. A resolver can set it in .git/config,
# which no change check lists, so every lgit call overrides it (and the
# untracked cache it feeds) before any guard has run.
lgit() { yr_git -c core.fsmonitor=false -c core.untrackedCache=false --literal-pathspecs "$@"; }

# lgit with every git hook disabled (core.hooksPath=/dev/null overrides
# .git/hooks and any configured hooks directory). For the rollback paths: a
# resolver can plant or edit an ignored hook that rp_tree_changes does not
# list, and a file checkout, an index write or a status refresh would run it
# (post-checkout, post-index-change).
lgit_nohooks() { yr_git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.untrackedCache=false --literal-pathspecs "$@"; }

# harden_git_config [full|revert]: force core.fsmonitor and
# core.untrackedCache off, and safe.bareRepository=explicit, for this process
# and its children (GIT_CONFIG_COUNT, appended to the caller's). It reads
# config through yr_git, so no caller needs a git shadow.
# Scope `full` (the default) also refuses a local or worktree transport
# command, credential helper, or non-LFS filter, and forces signing off only
# when local or worktree gpg config exists. Scope `revert` is for the
# rollback and check-ignored modes, which run no submit step: it applies the
# three overrides and refuses only a non-LFS filter (a checkout runs a smudge
# filter), so a resolver-set core.sshCommand cannot block its own rollback.
# Does not set core.hooksPath (that stays in the commit script's
# disable_git_hooks) and does not exit: return 0, or 1 with YR_HARDEN_MSG set.
# When signing is forced off, YR_HARDEN_NOTE holds the unsigned-commit note and
# the return is still 0; the caller prints it with its own prefix, if it
# commits at all. YR_HARDEN_MSG is read by the caller after a non-zero return.
# harden_git_config_for_verify then removes safe.bareRepository=explicit for the
# user's verify command, which would otherwise inherit it.
# shellcheck disable=SC2034
harden_git_config() {
    local scope="${1:-full}" n="${GIT_CONFIG_COUNT:-0}"
    YR_HARDEN_MSG=""
    YR_HARDEN_NOTE=""
    case "$n" in
        ''|*[!0-9]*)
            YR_HARDEN_MSG="GIT_CONFIG_COUNT is not a number, so core.fsmonitor cannot be disabled"
            return 1
            ;;
    esac
    n=$((10#$n))
    YR_HARDEN_FROM_N=$n
    export "GIT_CONFIG_KEY_$n=core.fsmonitor" "GIT_CONFIG_VALUE_$n=false" \
        "GIT_CONFIG_KEY_$((n + 1))=core.untrackedCache" "GIT_CONFIG_VALUE_$((n + 1))=false" \
        "GIT_CONFIG_KEY_$((n + 2))=safe.bareRepository" "GIT_CONFIG_VALUE_$((n + 2))=explicit" \
        "GIT_CONFIG_COUNT=$((n + 3))"
    [ "$(yr_git config --get core.fsmonitor 2>/dev/null)" = false ] \
        && [ "$(yr_git config --get core.untrackedCache 2>/dev/null)" = false ] \
        && [ "$(yr_git config --get safe.bareRepository 2>/dev/null)" = explicit ] \
        || { YR_HARDEN_MSG="could not disable core.fsmonitor"; return 1; }
    # A repository-local or worktree-scope transport command is run by the
    # submit step's git (and gt, gh) with submission authority: refuse it,
    # naming the key only. Global and system scopes are not judged, and the
    # values are never overridden, which would also disable the user's own
    # credential helper.
    local tcfg trc=0 tkey tre
    # A clean, smudge or process filter runs on `git add` and on checkout, so a
    # repository-local one is judged the same way; the three stock Git LFS
    # commands (`git lfs install --local`) are allowed by exact value.
    tre='^(core\.(sshcommand|askpass|gitproxy)|credential\.(.*\.)?helper|filter\..*\.(clean|smudge|process))$'
    [ "$scope" = revert ] && tre='^filter\..*\.(clean|smudge|process)$'
    tcfg=$(yr_git config --show-scope --get-regexp "$tre" 2>/dev/null) || trc=$?
    case "$trc" in
        0|1) ;;
        *) YR_HARDEN_MSG="could not read the git transport config"; return 1 ;;
    esac
    tkey=$(printf '%s\n' "$tcfg" | yr_awk -F'\t' '
        ($1 == "local" || $1 == "worktree") {
            k = $2; v = $2; sub(/ .*/, "", k); sub(/^[^ ]* /, "", v)
            if (k ~ /^filter\.lfs\.(clean|smudge|process)$/ && (v == "git-lfs clean -- %f" || v == "git-lfs smudge -- %f" || v == "git-lfs filter-process" || v == "git-lfs smudge --skip -- %f" || v == "git-lfs filter-process --skip")) next
            print k; exit
        }') || { YR_HARDEN_MSG="could not parse the git transport config"; return 1; }
    # A credential URL can carry userinfo: name the key without it.
    case "$tkey" in
        credential.helper) ;;
        credential.*) tkey="credential.<url>.helper" ;;
        filter.*) tkey="filter.<driver>.${tkey##*.}" ;;
    esac
    if [ -n "$tkey" ]; then
        if [ "$scope" = revert ]; then
            YR_HARDEN_MSG="the repository config sets $tkey, which a checkout would run; remove it from the repository config (a global or system config is fine)"
        else
            YR_HARDEN_MSG="the repository config sets $tkey, which would run a command with submission authority; remove it from the repository config (a global or system config is fine)"
        fi
        return 1
    fi
    [ "$scope" = revert ] && return 0
    # A resolver can also write commit.gpgSign and gpg.program (or
    # gpg.<format>.program) into the repository's own config: signing the commit
    # would run that program. Only the local and worktree scopes are judged
    # (includes resolved, which --show-scope does), so the user's own global or
    # system signing config keeps working. A local commit.gpgsign=false is no
    # signing config.
    local cfg rc=0 hit
    cfg=$(yr_git config --show-scope --get-regexp '^(commit\.gpgsign|gpg\.)' 2>/dev/null) || rc=$?
    case "$rc" in
        0|1) ;;
        *) YR_HARDEN_MSG="could not read the git signing config"; return 1 ;;
    esac
    hit=$(printf '%s\n' "$cfg" | yr_awk -F'\t' '($1 == "local" || $1 == "worktree") && tolower($2) !~ /^commit\.gpgsign (false|no|off|0)$/ { print "y"; exit }') \
        || { YR_HARDEN_MSG="could not parse the git signing config"; return 1; }
    [ -n "$hit" ] || return 0
    n=$((n + 3))
    # push.gpgSign and log.showSignature reach gpg.program in the child git of
    # the submit step, so they are forced off with commit signing.
    export "GIT_CONFIG_KEY_$n=commit.gpgSign" "GIT_CONFIG_VALUE_$n=false" \
        "GIT_CONFIG_KEY_$((n + 1))=push.gpgSign" "GIT_CONFIG_VALUE_$((n + 1))=false" \
        "GIT_CONFIG_KEY_$((n + 2))=log.showSignature" "GIT_CONFIG_VALUE_$((n + 2))=false" \
        "GIT_CONFIG_COUNT=$((n + 3))"
    [ "$(yr_git config --bool --get commit.gpgsign 2>/dev/null)" = false ] \
        && [ "$(yr_git config --bool --get push.gpgsign 2>/dev/null)" = false ] \
        && [ "$(yr_git config --bool --get log.showsignature 2>/dev/null)" = false ] \
        || { YR_HARDEN_MSG="could not disable commit signing"; return 1; }
    YR_HARDEN_NOTE="the repository's own config sets commit signing (commit.gpgsign or gpg.*), which could run a program, so the commit is made unsigned"
}

# harden_git_config_for_verify: drop only the safe.bareRepository=explicit pair
# harden_git_config appended, keeping core.fsmonitor and core.untrackedCache
# off. Run it in the subshell that starts the user's verify command: a suite
# that clones or opens a bare repository must not fail on an override meant for
# the commit and submit steps, while a resolver-planted fsmonitor command in
# .git/config still must not run under the verify command's own git calls.
harden_git_config_for_verify() {
    [ "${YR_HARDEN_FROM_N+set}" = set ] || return 0
    local i end="${GIT_CONFIG_COUNT:-0}" j="$YR_HARDEN_FROM_N" kv vv k v
    for ((i = j; i < end; i++)); do
        kv="GIT_CONFIG_KEY_$i"
        vv="GIT_CONFIG_VALUE_$i"
        k="${!kv-}"
        v="${!vv-}"
        [ "$k" = safe.bareRepository ] && continue
        export "GIT_CONFIG_KEY_$j=$k" "GIT_CONFIG_VALUE_$j=$v"
        j=$((j + 1))
    done
    for ((i = j; i < end; i++)); do
        unset "GIT_CONFIG_KEY_$i" "GIT_CONFIG_VALUE_$i"
    done
    export "GIT_CONFIG_COUNT=$j"
}

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

# rp_trusted_config <path>: the subset of rp_denied a later agent session
# trusts as instructions or tool config, matched the same way. These are the
# only dirty paths a refusal cleanup reverts without asking (--revert-denied,
# the stack and sweep dirty-tree cleanup); other deny-listed paths (.env*,
# keys, CI and Docker files) can hold the user's own work and are asked about
# or left in place. .claude/agent-memory/ at the repository root is excluded:
# agents with `memory: project` write there during a normal run.
rp_trusted_config() {
    local l
    l=$(rp_lower "$1")
    case "$l" in
        .claude/agent-memory|.claude/agent-memory/*) return 1 ;;
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
    esac
    return 1
}

# rp_runtime_override_rels: the repository-relative, lowercased path(s) that
# YELLOW_REVIEW_GITHUB_STACK_RUNTIME names, one per line. The path is walked
# component by component as the kernel does, and every node on the way that
# lies inside the repository is printed: each directory, each symlink (a
# symlinked ancestor directory included, since repointing it redirects the
# override to a directory the PR controls), the nodes below each symlink's
# target and the final file. A symlink outside the repository is followed
# (its target is judged), one inside is printed before it is followed. Prints
# nothing for nodes outside the repository or when the variable is unset;
# stops at a path that loops or exceeds the hop limit. Relative values
# resolve from the current directory, as `node "$RUNTIME"` does. With the
# argument `raw` the paths keep their case (for asking git about them).
rp_runtime_override_rels() {
    local p="${YELLOW_REVIEW_GITHUB_STACK_RUNTIME:-}" top cur rest c next t hops=0 raw=0
    [ "${1:-}" = raw ] && raw=1
    [ -n "$p" ] || return 0
    top=$(yr_git rev-parse --show-toplevel 2>/dev/null) || return 0
    top=$(cd -- "$top" 2>/dev/null && pwd -P) || return 0
    case "$p" in
        /*) cur=/ ;;
        *) cur=$(pwd -P 2>/dev/null) || return 0 ;;
    esac
    rest="$p"
    while [ -n "$rest" ]; do
        c="${rest%%/*}"
        case "$rest" in */*) rest="${rest#*/}" ;; *) rest="" ;; esac
        case "$c" in
            ''|.) continue ;;
            ..) cur=$(dirname -- "$cur") || return 0; continue ;;
        esac
        next="${cur%/}/$c"
        case "$next" in
            "$top"/*)
                if [ "$raw" = 1 ]; then
                    printf '%s\n' "${next#"$top"/}"
                else
                    printf '%s\n' "$(rp_lower "${next#"$top"/}")"
                fi
                ;;
        esac
        if [ -L "$next" ]; then
            hops=$((hops + 1))
            [ "$hops" -le 40 ] || return 0
            t=$(readlink -- "$next") || return 0
            # A relative target resolves from the link's directory, which is
            # cur; an absolute one restarts at the root.
            case "$t" in /*) cur=/ ;; esac
            rest="${t}${rest:+/$rest}"
        else
            cur="$next"
        fi
    done
}

# rp_runtime_override_untrusted: exit 0 and print the repository-relative path
# (never contents) of the first file or symlink on the
# YELLOW_REVIEW_GITHUB_STACK_RUNTIME path that lies inside the repository and
# is not tracked, not clean against HEAD, or is hidden from status
# (assume-unchanged or skip-worktree). Exit 1 when every such node is tracked
# and unmodified, or the variable is unset or names only nodes outside the
# repository. Exit 2 when git cannot answer (treat as untrusted). rp_tree_changes
# omits ignored files, so a resolver can rewrite an ignored override unseen;
# this check reads the override itself. Directories are skipped: git tracks
# files, and the final file is checked.
rp_runtime_override_untrusted() {
    local top rels rel st
    [ -n "${YELLOW_REVIEW_GITHUB_STACK_RUNTIME:-}" ] || return 1
    top=$(yr_git rev-parse --show-toplevel 2>/dev/null) || return 2
    top=$(cd -- "$top" 2>/dev/null && pwd -P) || return 2
    rels=$(rp_runtime_override_rels raw 2>/dev/null) || return 2
    while IFS= read -r rel; do
        [ -n "$rel" ] || continue
        if [ -d "$top/$rel" ] && [ ! -L "$top/$rel" ]; then
            continue
        fi
        # A tracked path lists as "H <name>" (cached); anything else (untracked,
        # ignored, or flagged assume-unchanged/skip-worktree) is untrusted.
        if ! st=$(lgit -C "$top" ls-files -v --error-unmatch -- "$rel" 2>/dev/null) \
            || [ "${st:0:2}" != "H " ]; then
            printf '%s\n' "$rel"
            return 0
        fi
        # Exit 0 clean, 1 modified (staged or unstaged), other: unknown.
        st=0
        lgit -C "$top" diff --quiet --no-ext-diff HEAD -- "$rel" 2>/dev/null || st=$?
        case "$st" in
            0) ;;
            1) printf '%s\n' "$rel"; return 0 ;;
            *) printf '%s\n' "$rel"; return 2 ;;
        esac
    done <<<"$rels"
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
    hooks=$(yr_git config --get core.hooksPath 2>/dev/null) || rc=$?
    [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ] || return 0
    if [ -n "$hooks" ]; then
        top=$(yr_git rev-parse --show-toplevel 2>/dev/null || true)
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
    err=$({ lgit diff --no-renames --name-only -z HEAD -- \
        && lgit ls-files --others --exclude-standard -z; } 2>&1 >"$1") || rc=$?
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
    local l="$1" marker="$2" t p d out skip="" rc=0
    if [ -e "$l" ]; then
        if [ -d "$l" ]; then
            # The root `.ruvector` link: skip its session log as the literal
            # directory scan does (see rp_ignored_changed_since).
            case "$l" in .ruvector|./.ruvector) skip="$l/coedit-sessions" ;; esac
            out=$(set -o pipefail
                find -H "$l" -name .git -prune -o -path "$skip" -prune -o -type f -newer "$marker" -print 2>/dev/null \
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
# (node_modules/.bin/<runner>) would run with the verify command. This relies
# on one assumption: the resolver cannot backdate a file's mtime, which holds
# only while it has no shell (Read/Grep/Glob/Edit; Edit always bumps the
# mtime). pr-comment-resolver listed Bash until the resolve-dispositions PR
# (#954) removed it; until that lands, `touch -r <marker>` defeats this check,
# and a content snapshot would need a new caller step and a hash of every
# ignored file (node_modules included), so the tool restriction closes the gap
# instead. Any ignored
# regular file or symlink with an mtime newer than <marker> (a file the
# caller touched before the resolvers started) counts as changed. A symlink
# counts when its own mtime is newer, and its target is judged too, because a
# write through the link leaves the link's mtime alone: see
# rp_link_target_changed. Every ignored symlink is examined, those inside
# ignored directories included. `.git` is skipped as a walked directory, not
# as a link target. `.ruvector/coedit-sessions` (the session log yellow-ruvector's
# PostToolUse hook rewrites on every resolver Edit) is skipped entirely: it is
# data nothing executes, and counting it would refuse every verify run. Prints up to 20
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
        top=$(yr_git rev-parse --show-toplevel 2>/dev/null) || exit 2
        cd -- "$top" 2>/dev/null || exit 2
        symlist=$(mktemp) || exit 2
        trap 'rm -f -- "$symlist"' EXIT
        lgit ls-files --others --ignored --exclude-standard --directory -z >|"$scratch" 2>/dev/null || exit 2
        while IFS= read -r -d '' f; do
            case "$f" in .git|.git/*|*/.git|*/.git/*) continue ;; esac
            case "$f" in .ruvector/coedit-sessions|.ruvector/coedit-sessions/) continue ;; esac
            out=""
            rc=0
            if [ "${f%/}" != "$f" ]; then
                # A wholly ignored directory. head bounds the output, so a
                # tree rewritten end to end cannot fill memory; a find that
                # fails with nothing found is "cannot tell".
                out=$(set -o pipefail
                    find "./$f" -name .git -prune -o -path ./.ruvector/coedit-sessions -prune -o \( -type f -o -type l \) -newer "$marker" -print 2>/dev/null \
                        | head -n 20) || rc=$?
                if [ -z "$out" ] && [ "$rc" -eq 0 ]; then
                    # Nothing newer: judge the target of each symlink inside.
                    find "./$f" -name .git -prune -o -path ./.ruvector/coedit-sessions -prune -o -type l -print0 >|"$symlist" 2>/dev/null || exit 2
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
# directory, no hook file outside the working tree or in the git directory, or
# every in-tree file tracked and plain), 2 when it cannot be inspected, 4 when
# the directory is in the git directory (.git/hooks) or outside the working tree
# and holds a file other than a .sample (it prints `git-dir` or `external`:
# tracked state cannot vouch for it, so the caller must disable hooks for the
# commit) or lies in the working tree with a tracked file whose `ls-files -v`
# tag is not H (assume-unchanged or skip-worktree: git status and diff cannot
# see an edit to it; it prints the repository-relative path) and 3 when the
# hooks path passes through a symlink that lives inside the working tree (the
# git directory included, so a symlinked .git/hooks or .git counts). A caller
# must treat 2 and 3 as refusals. On 3 it prints the repository-relative path of
# that symlink: a resolver can edit through it, to a target Git status never
# lists, and the commit would run the edit. The path is walked component by component from the configured value
# (made absolute against the working tree root), and only a symlink located
# inside the working tree counts; a symlink above or outside it is just a way
# to reach the directory. The caller owns <outfile>, a scratch file. Tools that
# keep generated hooks in an ignored directory (husky's .husky/_) are refused
# too: their files cannot be told from a planted one.
rp_hooks_untracked() {
    (
        local hp top gitdir rel cur rest c next kind spec=()
        top=$(yr_git rev-parse --show-toplevel 2>/dev/null) || exit 2
        cd -- "$top" 2>/dev/null || exit 2
        top=$(pwd -P) || exit 2
        hp=$(yr_git rev-parse --git-path hooks 2>/dev/null) || exit 2
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
        gitdir=$(yr_git rev-parse --git-common-dir 2>/dev/null) || exit 2
        gitdir=$(cd -- "$gitdir" 2>/dev/null && pwd -P) || exit 2
        # A hooks directory Git does not list (the git directory) or that lies
        # outside the working tree cannot be judged by tracked state, and a
        # resolver can rewrite an existing hook there (Edit follows the path).
        # Report a real hook file (anything but a .sample) as 4: the caller
        # disables hooks for the commit rather than running unverified code.
        kind=""
        case "$hp" in
            "$gitdir"|"$gitdir"/*) kind=git-dir ;;
            "$top"|"$top"/*) ;;
            *) kind=external ;;
        esac
        if [ -n "$kind" ]; then
            c=$(find "$hp" -mindepth 1 ! -name '*.sample' -print -quit 2>/dev/null) || exit 2
            [ -n "$c" ] || exit 1
            printf '%s' "$kind"
            exit 4
        fi
        case "$hp" in
            "$top") rel=. ;;
            *) rel="${hp#"$top"/}" ;;
        esac
        # The whole tree when the hooks directory is the repository root.
        [ "$rel" = . ] || spec=(-- "$rel")
        lgit ls-files --others --directory --no-empty-directory -z ${spec[@]+"${spec[@]}"} >|"$1" 2>/dev/null || exit 2
        if [ -s "$1" ]; then
            printf '%s' "$rel"
            exit 0
        fi
        # A tracked hook flagged assume-unchanged or skip-worktree can be edited
        # without the dirty-set check seeing it. Only the plain H tag vouches
        # for a tracked file (the same rule as rp_runtime_override_untrusted).
        lgit ls-files -v -z ${spec[@]+"${spec[@]}"} >|"$1" 2>/dev/null || exit 2
        [ -s "$1" ] || exit 1
        if tr '\0' '\n' <"$1" | grep -v '^H ' >/dev/null; then
            printf '%s' "$rel"
            exit 4
        fi
        exit 1
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
