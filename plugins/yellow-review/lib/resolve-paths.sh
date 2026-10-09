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

# yr_has_root <string> <root>: succeed when <string> contains <root> as a whole
# path: not preceded by a path character and followed by / or a character that
# cannot continue a name. A sibling such as <root>2 or <root>-keys is not it.
yr_has_root() {
    local rest="$1" root="$2" pre post prev next
    while :; do
        case "$rest" in *"$root"*) ;; *) return 1 ;; esac
        pre=${rest%%"$root"*}
        post=${rest#*"$root"}
        prev=${pre: -1}
        next=${post:0:1}
        case "$prev" in [A-Za-z0-9._/-]) ;; *)
            case "$next" in [A-Za-z0-9._-]) ;; *) return 0 ;; esac
        esac
        rest=$post
    done
}

# yr_args_enter <string> <root> <skip-bare-first>: succeed when <string>, read
# as a word list, names anything inside <root>: the raw text holds the root as
# a whole path (yr_has_root), or a word (leading ! and quotes stripped; for
# --opt=VALUE both the word and VALUE) is an absolute path, or an existing path
# relative to the current directory, that canonicalizes inside <root>, or a
# path that cannot be canonicalized. With <skip-bare-first> 1 the first word is
# left alone when it has no slash (a program name is looked up on PATH, never
# in the current directory). Words starting with ~ or $ are not judged here.
yr_args_enter() {
    local v="$1" root="$2" skipfirst="${3:-0}" phys tok t u c first=1 noglob=1
    local -a toks=()
    phys=$(pwd -P) || return 0
    yr_has_root "$v" "$root" && return 0
    case $- in *f*) noglob=0 ;; esac
    {
        local IFS=$' \t\n'
        set -f
        toks=($v)
        [ "$noglob" -eq 0 ] || set +f
    }
    for tok in ${toks[@]+"${toks[@]}"}; do
        t=${tok#!}
        t=${t#[\"\']}
        t=${t%[\"\']}
        for u in "$t" "${t#*=}"; do
            case "$u" in
                ''|'~'*|'$'*) continue ;;
                /*)
                    c=$(yr_canon_path "$u" 2>/dev/null) || return 0
                    yr_inside_root "$c" "$root" && return 0
                    yr_inside_root "$u" "$root" && return 0
                    ;;
                *)
                    if [ "$first" -eq 1 ] && [ "$skipfirst" -eq 1 ]; then
                        case "$u" in */*) ;; *) continue ;; esac
                    fi
                    [ -e "$u" ] || continue
                    c=$(yr_canon_path "$phys/$u" 2>/dev/null) || return 0
                    yr_inside_root "$c" "$root" && return 0
                    ;;
            esac
            case "$t" in -*=*) ;; *) break ;; esac
        done
        first=0
    done
    return 1
}

# yr_file_shebang_enters <file> <root>: succeed when <file> starts with a #!
# line that would run anything inside <root> by canonical path or identity, or
# cannot be canonicalized (fail closed): the interpreter, the program `env` is
# asked to run, or a path in the optional argument (Linux passes the rest of
# the line as one argument, BSD splits it; both are judged, see yr_args_enter).
# The first line is read and never run. `env` operands follow env(1): options
# with an argument (-u, -C, -P, -a and their long forms), NAME=value words, and
# -S / --split-string, whose string is split into words that continue the
# operand list (attached or separate, and inside a short cluster such as
# -vS; a `$`, backslash or quote in that string, which env expands or decodes,
# counts as entering, and so do a NAME=value operand and -P, which makes env
# search a path other than PATH). A bare
# operand is looked up on the caller's PATH (YR_ORIG_PATH), the
# way the tool itself would be. Copies of this block (through
# yr_file_shebang_enters) sit in the two scripts' bootstrap resolvers, which
# run before this library is sourced; keep them identical.
yr_file_shebang_enters() {
    local f="$1" root="$2" line rest i x idx last k c cl val p args=""
    local -a w=() v=() nw=()
    [ -f "$f" ] || return 1
    IFS= read -r -n 512 line <"$f" 2>/dev/null || true
    case "$line" in '#!'*) ;; *) return 1 ;; esac
    rest=${line#\#!}
    rest=${rest#"${rest%%[![:space:]]*}"}
    read -r -a w <<<"$rest" || true
    i=${w[0]-}
    [ -n "$i" ] || return 1
    case "$i" in
        env|*/env)
            i=""
            idx=1
            while [ "$idx" -lt "${#w[@]}" ]; do
                x=${w[idx]}
                val=""; last=-1
                case "$x" in
                    "") idx=$((idx + 1)); continue ;;
                    --) idx=$((idx + 1)); continue ;;
                    --split-string) val=${w[idx + 1]-}; last=$((idx + 1)) ;;
                    --split-string=*) val=${x#*=}; last=$idx ;;
                    --chdir|--unset|--argv0) idx=$((idx + 2)); continue ;;
                    --*) idx=$((idx + 1)); continue ;;
                    -?*)
                        cl=${x#-}
                        k=0
                        while [ "$k" -lt "${#cl}" ]; do
                            c=${cl:k:1}
                            case "$c" in
                                P)
                                    # env searches another path than PATH: fail closed.
                                    return 0
                                    ;;
                                S)
                                    val=${cl:k+1}; last=$idx
                                    if [ -z "$val" ]; then val=${w[idx + 1]-}; last=$((idx + 1)); fi
                                    break
                                    ;;
                                u|C|a)
                                    [ -n "${cl:k+1}" ] || idx=$((idx + 1))
                                    break
                                    ;;
                            esac
                            k=$((k + 1))
                        done
                        ;;
                    # NAME=value before the utility (PATH=tools changes where it
                    # is looked up): fail closed.
                    *=*) return 0 ;;
                    *) i="$x"; break ;;
                esac
                if [ "$last" -ge 0 ]; then
                    # env expands ${VAR} and decodes \_ and quotes in a -S string,
                    # and Linux hands it the whole rest of the line: fail closed
                    # on any $, backslash or quote from here on.
                    case "${w[*]:idx}" in *[\$\\\"\']*) return 0 ;; esac
                    # Splice the -S string's words in place of the option.
                    v=()
                    read -r -a v <<<"$val" || true
                    nw=()
                    [ "$idx" -eq 0 ] || nw=("${w[@]:0:idx}")
                    nw=(${nw[@]+"${nw[@]}"} ${v[@]+"${v[@]}"} ${w[@]+"${w[@]:last+1}"})
                    w=(${nw[@]+"${nw[@]}"})
                else
                    idx=$((idx + 1))
                fi
            done
            # What follows the operand is its argument list.
            [ "$idx" -lt "${#w[@]}" ] && args="${w[*]:idx+1}"
            i=${i#[\"\']}
            i=${i%[\"\']}
            [ -n "$i" ] || return 1
            case "$i" in
                */*) ;;
                *) i=$(PATH=${YR_ORIG_PATH-$PATH}; type -P "$i" 2>/dev/null) || return 1 ;;
            esac
            ;;
        *) args=${rest#"$i"} ;;
    esac
    if [ -n "$args" ] && yr_args_enter "$args" "$root" 0; then
        return 0
    fi
    case "$i" in /*) p="$i" ;; *) p="$(pwd -P)/$i" ;; esac
    c=$(yr_canon_path "$p" 2>/dev/null) || return 0
    yr_inside_root "$c" "$root" || yr_inside_root "$p" "$root"
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
    # The caller's own PATH, not the screened one yr_adopt_path installed: a
    # tool that reaches into the worktree must be refused, not skipped.
    bin=$(PATH=${YR_ORIG_PATH-$PATH}; type -P "$name" 2>/dev/null) || return 1
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
        # A script whose #! interpreter is inside the worktree runs it.
        yr_file_shebang_enters "$canon" "$root" && return 2
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
    yr_prime_path || return $?
    PATH=$YR_GIT_PATH "$YELLOW_REVIEW_GIT" "$@"
}

# yr_prime_path: set YR_GIT_PATH to yr_safe_path's result, once per PATH and
# working directory. yr_safe_path canonicalizes every PATH entry, so computing
# it in each $(...) that calls yr_git or yr_awk dominated the suites' run time;
# a caller that runs yr_git once in the main shell (the scripts do, right after
# sourcing this file) hands the value to every later subshell. A changed PATH
# or directory recomputes it.
yr_prime_path() {
    local key="$PATH|$PWD"
    if [ -n "${YR_GIT_PATH:-}" ] && [ "${YR_PATH_KEY-}" = "$key" ]; then
        return 0
    fi
    YR_GIT_PATH=$(yr_safe_path) || { YR_GIT_PATH=""; return 1; }
    YR_PATH_KEY=$key
}

# yr_split_lines <text>: set YR_LINES to the lines of <text>, split in the shell
# (read(1) costs a syscall per byte) with globbing off for the split only.
yr_split_lines() {
    local noglob=1
    case $- in *f*) noglob=0 ;; esac
    YR_LINES=()
    {
        local IFS=$'\n'
        set -f
        YR_LINES=($1)
        [ "$noglob" -eq 0 ] || set +f
    }
}

# yr_any_inside <root> <list>: succeed when any line of <list> (canonical paths,
# one per line) is inside <root>: the slow, per-line form of yr_batch_inside.
# A name holding a newline splits into fragments; the first still starts with
# the root when the path is inside it, so a split can only drop a directory,
# never keep one.
yr_any_inside() {
    local root="$1" canon
    yr_split_lines "$2"
    for canon in ${YR_LINES[@]+"${YR_LINES[@]}"}; do
        yr_inside_root "$canon" "$root" && return 0
        [ "$canon" -ef "$root" ] && return 0
    done
    return 1
}

# yr_batch_inside <root> <find> <realpath> <awk> <dir>...: succeed when any symlink
# directly in any <dir> (a <dir> that is itself a symlink is followed: -H),
# dangling or not (a link to a directory counts), has a
# canonical target inside <root>. Cost is counted in shell commands, not
# forks: the bats suites run under a DEBUG trap that makes every command
# slow, and a per-link or per-directory shell loop (hundreds of links in
# /usr/bin) dominated their run time. So: one find lists every link of every
# directory and runs realpath on them, and the verdict comes from a pattern
# match on the whole output (spelling), one more find (-samefile: a link to
# the worktree under another spelling; GNU find) and one identity walk per distinct
# parent directory (bind mounts, case-insensitive volumes). <find> and
# <realpath> come from yr_helper, never PATH; sed and sort do too, and without
# them the identity walk runs per link. A realpath error concerns a path this
# process cannot traverse either, so it cannot reach a program it could run.
yr_batch_inside() {
    local root="$1" find="$2" rp="$3" awk="$4" out out_same
    shift 4
    out=$("$find" -H "$@" -maxdepth 1 -type l -exec "$rp" -m -- {} + 2>/dev/null) || true
    [ -n "$out" ] || return 1
    yr_batch_canon_inside "$root" "$out" "$find" "$awk" && return 0
    out_same=$("$find" -L "$@" -maxdepth 1 -samefile "$root" -print -quit 2>/dev/null) || true
    [ -z "$out_same" ] || return 0
    return 1
}

# yr_batch_canon_inside <root> <list> <find> <awk>: yr_any_inside for a long
# list of canonical paths without a per-path shell loop: a pattern match on the
# whole list (spelling), then awk prints each path and every ancestor once and
# one `find -L ... -maxdepth 0 -samefile <root>` compares them all with the
# root by inode (bind mounts, case-insensitive volumes).
yr_batch_canon_inside() {
    local root="$1" out="$2" find="$3" awk="$4" same
    case $'\n'"$out" in
        *$'\n'"$root"|*$'\n'"$root"/*) return 0 ;;
    esac
    yr_split_lines "$(printf '%s\n' "$out" | "$awk" '{ n = split($0, a, "/"); p = ""; for (i = 2; i <= n; i++) { p = p "/" a[i]; if (!(p in s)) { s[p] = 1; print p } } }')"
    [ "${#YR_LINES[@]}" -gt 0 ] || return 1
    same=$("$find" -L "${YR_LINES[@]}" -maxdepth 0 -samefile "$root" -print -quit 2>/dev/null) || true
    [ -n "$same" ]
}

# yr_shebang_inside <root> <find> <rp> <awk> <dir>...: succeed when any
# executable regular file in any <dir> (links followed) starts with a #! line
# whose interpreter, or the program `env` is asked to run, canonicalizes inside
# <root>. One find runs one awk over the files (first line only, then
# nextfile), which prints each distinct interpreter; those, plus the `env`
# operand looked up in every <dir>, go through one realpath. A script whose
# interpreter is outside the worktree is fine. An awk without nextfile would
# print nothing, so yr_safe_path probes for it and otherwise falls back
# to yr_links_inside.
yr_shebang_inside() {
    local root="$1" find="$2" rp="$3" awk="$4" out dirs
    shift 4
    dirs=$(IFS=:; printf '%s' "$*")
    out=$(YR_SB_DIRS="$dirs" YR_SB_CWD="$(pwd -P)" YR_SB_ROOT="$root" "$find" -L "$@" -maxdepth 1 -type f \( -perm -100 -o -perm -010 -o -perm -001 \) \
        -exec "$awk" 'function splice(val, last,    m, v, j, nn, t) {
            m = split(val, v, /[ \t]+/)
            nn = 0
            for (j = 1; j < idx; j++) t[++nn] = w[j]
            for (j = 1; j <= m; j++) if (v[j] != "") t[++nn] = v[j]
            for (j = last + 1; j <= n; j++) t[++nn] = w[j]
            for (j = 1; j <= n; j++) delete w[j]
            for (j = 1; j <= nn; j++) w[j] = t[j]
            n = nn
        }
        function envcmd(    x, cl, k, c, val, last, name) {
            idx = 2
            while (idx <= n) {
                x = w[idx]; val = ""; last = -1
                if (x == "" || x == "--") { idx++; continue }
                if (x ~ /^--/) {
                    name = x; sub(/=.*/, "", name)
                    if (name == "--split-string") {
                        if (x ~ /=/) { val = x; sub(/^[^=]*=/, "", val); last = idx }
                        else { val = w[idx + 1]; last = idx + 1 }
                    } else {
                        if ((name == "--chdir" || name == "--unset" || name == "--argv0") && x !~ /=/) idx++
                        idx++; continue
                    }
                } else if (x ~ /^-./) {
                    cl = substr(x, 2)
                    for (k = 1; k <= length(cl); k++) {
                        c = substr(cl, k, 1)
                        if (c == "S") {
                            val = substr(cl, k + 1); last = idx
                            if (val == "") { val = w[idx + 1]; last = idx + 1 }
                            break
                        }
                        if (c == "P") { pr(root); return "" }
                        if (c ~ /[uCa]/) { if (substr(cl, k + 1) == "") idx++; break }
                    }
                } else if (x ~ /=/) { pr(root); return "" }
                else { gsub(/^["\047]|["\047]$/, "", x); return x }
                if (last >= 0) { for (k = idx; k <= n; k++) if (w[k] ~ /[$\\"\047]/) { pr(root); return "" } splice(val, last) } else idx++
            }
            return ""
        }
        function pr(x) { if (!(x in pp)) { pp[x] = 1; print x } }
        function hasroot(t,    p, pc, nc) {
            while ((p = index(t, root)) > 0) {
                pc = (p > 1) ? substr(t, p - 1, 1) : ""
                nc = substr(t, p + length(root), 1)
                if (pc !~ /[A-Za-z0-9._\/-]/ && nc !~ /[A-Za-z0-9._-]/) return 1
                t = substr(t, p + length(root))
            }
            return 0
        }
        function argpaths(from,    j, k, a, c, pc, pn, t, txt) {
            txt = ""
            for (j = from; j <= n; j++) txt = txt " " w[j]
            if (hasroot(txt)) pr(root)
            for (j = from; j <= n; j++) {
                a = w[j]; sub(/^!/, "", a); gsub(/^["\047]|["\047]$/, "", a)
                pn = 1; pc[1] = a
                if (a ~ /^-.*=/) { pn = 2; t = a; sub(/^[^=]*=/, "", t); pc[2] = t }
                for (k = 1; k <= pn; k++) {
                    c = pc[k]
                    if (c ~ /^\//) pr(c)
                    else if (c != "" && c !~ /^[~$]/) {
                        t = cwd "/" c
                        if ((getline tmp < t) >= 0) { close(t); pr(t) } else close(t)
                    }
                }
            }
        }
        BEGIN { nd = split(ENVIRON["YR_SB_DIRS"], D, ":"); cwd = ENVIRON["YR_SB_CWD"]; root = ENVIRON["YR_SB_ROOT"] }
        FNR == 1 && substr($0, 1, 2) == "#!" {
            s = substr($0, 3); sub(/^[ \t]+/, "", s); n = split(s, w, /[ \t]+/); i = w[1]; e = ""; from = 2
            if (i ~ /(^|\/)env$/) { i = envcmd(); e = 1; from = idx + 1 }
            if (from <= n) argpaths(from)
            if (i == "" || (i in seen)) next
            seen[i] = 1
            if (i ~ /\//) pr(i ~ /^\// ? i : cwd "/" i)
            else if (e) { for (j = 1; j <= nd; j++) pr(D[j] "/" i) }
            else pr(cwd "/" i)
        } { nextfile }' {} + 2>/dev/null) || true
    [ -n "$out" ] || return 1
    yr_split_lines "$out"
    out=$("$rp" -m -- "${YR_LINES[@]}" 2>/dev/null) || true
    yr_batch_canon_inside "$root" "$out" "$find" "$awk"
}

# yr_links_inside <dir> <root>: the fallback of yr_batch_inside and
# yr_shebang_inside for a system without GNU realpath, find or awk: succeed
# when any symlink directly in <dir> has a canonical target (yr_canon_path)
# inside <root> or cannot be canonicalized, or an executable file's #!
# interpreter is inside it.
yr_links_inside() {
    local f out
    for f in "$1"/* "$1"/.[!.]* "$1"/..?*; do
        if [ -L "$f" ]; then
            out=$(yr_canon_path "$f" 2>/dev/null || true)
            if [ -z "$out" ] || yr_inside_root "$out" "$2"; then
                return 0
            fi
        fi
        if [ -f "$f" ] && [ -x "$f" ] && yr_file_shebang_enters "$f" "$2"; then
            return 0
        fi
    done
    return 1
}

# yr_safe_path: print PATH without empty or relative entries and without any
# entry inside the worktree (by spelling, canonical path or identity) and
# without an entry that holds a symlink, dangling or not, whose canonical
# target is inside it. Git, its children and the two scripts look up many
# names through PATH after the resolvers have written the tree (awk, grep,
# true under timeout, ssh, git-credential-*, gpg, pagers, git-remote-*), so
# no list of names can be complete: any such link makes the whole directory
# untrustworthy. Symlinks are the only way an outside directory reaches the
# worktree, and so is a script whose #! interpreter is inside it (a venv
# console script). One realpath call canonicalizes every entry, one find lists
# and canonicalizes every link of every remaining directory (yr_batch_inside)
# and one find+awk reads the first line of every executable file
# (yr_shebang_inside); only when either finds a problem is each
# directory judged on its own, and a directory reached twice (/bin -> usr/bin)
# takes the verdict of its first spelling. Returns 1 when nothing is left. The
# caller's PATH is not changed here; yr_prime_path caches the result, and each
# script runs on it (the verify command keeps its own PATH, it may need
# node_modules/.bin).
# This screen forks only find, awk, realpath, sed, sort and readlink from fixed
# system locations (yr_helper), never a PATH tool: it must not run a program
# from a directory it has not judged yet. When find or a GNU realpath is
# missing it canonicalizes each link in the shell (readlink from a fixed
# location), and a link it cannot resolve drops the directory.
yr_safe_path() {
    local root rest entry canon rp="" find="" awk="" kept="" i j k out
    local -a pent=() pcan=() ents=() canons=() verdict=() cand=() dirs=()
    root=$(yr_worktree_root || true)
    if [ -n "$root" ]; then
        if rp=$(yr_helper realpath) && canon=$("$rp" -m -- / 2>/dev/null) && [ "$canon" = / ]; then
            find=$(yr_helper find) || find=""
            # The #! screen needs an awk that knows nextfile; probe by parsing.
            awk=$(yr_helper awk) && "$awk" 'FNR == 1 { nextfile }' /dev/null 2>/dev/null || awk=""
        else
            rp=""
        fi
    fi
    rest="${PATH}:"
    while [ -n "$rest" ]; do
        entry="${rest%%:*}"
        rest="${rest#*:}"
        case "$entry" in /*) pent+=("$entry") ;; esac
    done
    # Canonical spellings of every entry in one realpath call when its output
    # lines up one to one (a name with a newline breaks that); else one
    # yr_canon_path per entry.
    if [ -n "$root" ] && [ -n "$rp" ] && [ "${#pent[@]}" -gt 0 ]; then
        out=$("$rp" -m -- "${pent[@]}" 2>/dev/null) || true
        yr_split_lines "$out"
        if [ "${#YR_LINES[@]}" -eq "${#pent[@]}" ]; then
            pcan=("${YR_LINES[@]}")
        fi
    fi
    for k in "${!pent[@]}"; do
        entry="${pent[k]}"
        if [ -z "$root" ]; then
            ents+=("$entry"); canons+=(""); verdict+=(k)
            continue
        fi
        if [ "${#pcan[@]}" -gt 0 ]; then
            canon="${pcan[k]}"
        else
            canon=$(yr_canon_path "$entry" 2>/dev/null || true)
        fi
        if yr_inside_root "$entry" "$root" || { [ -n "$canon" ] && yr_inside_root "$canon" "$root"; }; then
            continue
        fi
        i=${#ents[@]}
        ents+=("$entry"); canons+=("$canon")
        # k keep, x drop, d<j> same directory as entry j.
        verdict+=(k)
        if [ -n "$canon" ]; then
            for ((j = 0; j < i; j++)); do
                if [ "${canons[j]}" = "$canon" ]; then
                    verdict[i]="d$j"
                    break
                fi
            done
        fi
        # A directory that exists but cannot be listed (execute-only) cannot be
        # screened, and its entries still run: drop it.
        if [ "${verdict[i]}" = k ] && [ -d "$entry" ] && { [ ! -r "$entry" ] || [ ! -x "$entry" ]; }; then
            verdict[i]=x
        fi
        [ "${verdict[i]}" != k ] || cand+=("$i")
    done
    if [ "${#cand[@]}" -gt 0 ] && [ -n "$root" ]; then
        if [ -n "$rp" ] && [ -n "$find" ] && [ -n "$awk" ]; then
            dirs=()
            for i in "${cand[@]}"; do dirs+=("${ents[i]}"); done
            if yr_batch_inside "$root" "$find" "$rp" "$awk" "${dirs[@]}" \
                || yr_shebang_inside "$root" "$find" "$rp" "$awk" "${dirs[@]}"; then
                for i in "${cand[@]}"; do
                    if yr_batch_inside "$root" "$find" "$rp" "$awk" "${ents[i]}" \
                        || yr_shebang_inside "$root" "$find" "$rp" "$awk" "${ents[i]}"; then
                        verdict[i]=x
                    fi
                done
            fi
        else
            for i in "${cand[@]}"; do
                if yr_links_inside "${ents[i]}" "$root"; then verdict[i]=x; fi
            done
        fi
    fi
    for i in "${!ents[@]}"; do
        case "${verdict[i]}" in
            d*) j=${verdict[i]#d}; [ "${verdict[j]}" = k ] || continue ;;
            x) continue ;;
        esac
        kept="${kept:+$kept:}${ents[i]}"
    done
    [ -n "$kept" ] || return 1
    printf '%s\n' "$kept"
}

# yr_walk_path: the PATH for the ignored-file walk (find, head, mktemp, rm,
# dirname, basename, readlink). yr_safe_path screens every directory, not names.
yr_walk_path() {
    yr_safe_path
}

# yr_adopt_path: run the rest of the process on yr_safe_path's result, so a
# bare tool name resolves only to a file outside the worktree. Call once in the
# main shell, after the caller's own checks of the tools it binds by absolute
# path. Returns 1 when no directory is left. Children (gt, node, git hooks)
# inherit the screened PATH. YR_ORIG_PATH keeps the caller's PATH for the one
# command that must see it (the verify command).
yr_adopt_path() {
    yr_prime_path || return 1
    YR_ORIG_PATH=$PATH
    PATH=$YR_GIT_PATH
    export PATH
    hash -r 2>/dev/null || true
    YR_PATH_KEY="$PATH|$PWD"
}

# yr_awk: awk looked up through the same worktree-free PATH as yr_git, so a
# resolver-written awk in a PATH directory inside the worktree cannot run.
# Recomputes the path when YR_GIT_PATH is unset (yr_git sets it in a subshell
# when called inside $(...), so the parent may not have it).
yr_awk() {
    yr_prime_path || return $?
    PATH=$YR_GIT_PATH awk "$@"
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

# yr_cmd_enters <value> <root>: judge a shell command line (GIT_SSH_COMMAND, a
# pager or editor, a credential helper, a program-running config value). Git
# hands it to the shell, so `sh <root>/script` and `ssh -F <root>/cfg` count,
# not only a first word that is a path. Returns
#   0  it would run or read something inside <root> (or a path cannot be
#      canonicalized: fail closed);
#   2  it uses shell syntax this check cannot judge: $ (expansion), backtick,
#      ; & | < > ( ) * ? [ a backslash, a quote inside a word or a newline,
#      or a ~ other than a word starting
#      with ~ or ~/ (which is expanded to $HOME and judged);
#   1  it is fine.
# The checks are those of yr_args_enter (whole-path match of the worktree in
# the raw text, absolute and existing relative words), plus: the first word,
# when bare, is looked up on the screened PATH only (YR_GIT_PATH, else the
# current PATH), never in the current directory, and must not be a file inside
# <root> or a script whose #! enters it. Values that point only outside the
# worktree keep working.
yr_cmd_enters() {
    local v="$1" root="$2" tok t bin c first="" noglob=1 phys
    local -a toks=()
    case "$v" in
        *[\$\`\;\&\|\<\>\(\)\*\?\[\\]*|*$'\n'*) return 2 ;;
    esac
    phys=$(pwd -P) || return 0
    case $- in *f*) noglob=0 ;; esac
    {
        local IFS=$' \t\n'
        set -f
        toks=($v)
        [ "$noglob" -eq 0 ] || set +f
    }
    for tok in ${toks[@]+"${toks[@]}"}; do
        # Quotes are only judged at the edges of a word (yr_args_enter strips
        # one on each side); one inside a word, or after --opt=, is removed by
        # the shell and joins the pieces into a path this check never sees.
        t=${tok#!}
        t=${t#[\"\']}
        t=${t%[\"\']}
        case "$t" in *[\"\']*) return 2 ;; esac
        case "$tok" in
            '~'|'~/'*)
                [ -n "${HOME:-}" ] || return 2
                yr_args_enter "$HOME${tok#\~}" "$root" 0 && return 0
                ;;
            '~'*) return 2 ;;
        esac
    done
    yr_args_enter "$v" "$root" 1 && return 0
    first=${toks[0]-}
    t=${first#!}
    t=${t#[\"\']}
    t=${t%[\"\']}
    case "$t" in
        ''|-*|'~'*) ;;
        */*)
            case "$t" in /*) bin="$t" ;; *) bin="$phys/$t" ;; esac
            if [ -e "$bin" ]; then
                c=$(yr_canon_path "$bin" 2>/dev/null) || return 0
                yr_file_shebang_enters "$c" "$root" && return 0
            fi
            ;;
        *)
            bin=$(PATH=${YR_GIT_PATH:-$PATH}; type -P "$t" 2>/dev/null) || bin=""
            if [ -n "$bin" ]; then
                c=$(yr_canon_path "$bin" 2>/dev/null) || return 0
                yr_inside_root "$c" "$root" && return 0
                yr_file_shebang_enters "$c" "$root" && return 0
            fi
            ;;
    esac
    return 1
}

# yr_cmd_key <config key>: succeed for a config key whose value is a program
# git (or ssh, gpg, a pager) runs. Case-insensitive.
yr_cmd_key() {
    local r=1 had=0
    shopt -q nocasematch && had=1
    shopt -s nocasematch
    [[ "$1" =~ ^(core\.(sshcommand|askpass|gitproxy|pager|editor)|credential\.(.*\.)?helper|diff\.(external|.*\.(command|textconv))|merge\..*\.driver|gpg\.(.*\.)?program|sequence\.editor|filter\..*\.(clean|smudge|process)|pager\..*)$ ]] && r=0
    [ "$had" -eq 1 ] || shopt -u nocasematch
    return $r
}

# yr_env_cmd_verdict <name> <value> <root> [note]: run yr_cmd_enters and set
# YR_HARDEN_MSG (variable name only, never the value) when it refuses.
yr_env_cmd_verdict() {
    local rc=0
    yr_cmd_enters "$2" "$3" || rc=$?
    case "$rc" in
        0) YR_HARDEN_MSG="$1${4:+ $4} runs a program inside the repository; unset it or point it outside the repository" ;;
        2) YR_HARDEN_MSG="$1${4:+ $4} uses shell syntax (\$, backticks, ; & | < > ( ) * ? [ backslashes, quotes inside a word or ~user) that cannot be checked against the repository; use a plain command line or a script outside the repository" ;;
        *) return 0 ;;
    esac
    return 1
}

# yr_check_git_env: refuse an inherited git environment that runs a program, or
# loads config or helpers, from inside the worktree. A resolver can write any
# file there, and the submit step's git, ssh, gpg and pager run with
# submission authority. Sets YR_HARDEN_MSG (variable names only, never
# values) and returns 1 on a hit. Trusted values outside the worktree are kept,
# so ordinary ssh pushes and credential helpers still work. Covers: the
# command variables (GIT_SSH_COMMAND, GIT_SSH, GIT_ASKPASS, SSH_ASKPASS,
# GIT_PROXY_COMMAND, GIT_EXTERNAL_DIFF, GIT_PAGER, PAGER, GIT_EDITOR, EDITOR,
# VISUAL), the path variables (GIT_EXEC_PATH, GIT_TEMPLATE_DIR,
# GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM; any GIT_CONFIG is refused) and config
# injected through
# GIT_CONFIG_KEY_<i>/GIT_CONFIG_VALUE_<i> (below GIT_CONFIG_COUNT) and
# GIT_CONFIG_PARAMETERS, judged by the same rules as the repository's own
# config. A GIT_CONFIG_COUNT that is not a number is refused by
# harden_git_config itself.
yr_check_git_env() {
    local root name val i n k v rest
    root=$(yr_worktree_root || true)
    [ -n "$root" ] || return 0
    for name in GIT_SSH_COMMAND GIT_SSH GIT_ASKPASS SSH_ASKPASS GIT_PROXY_COMMAND \
        GIT_EXTERNAL_DIFF GIT_PAGER PAGER GIT_EDITOR EDITOR VISUAL; do
        val="${!name-}"
        [ -n "$val" ] || continue
        yr_env_cmd_verdict "$name" "$val" "$root" || return 1
    done
    for name in GIT_EXEC_PATH GIT_TEMPLATE_DIR GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM; do
        val="${!name-}"
        [ -n "$val" ] || continue
        case "$val" in /*) ;; *) val="$(pwd -P)/$val" ;; esac
        k=$(yr_canon_path "$val" 2>/dev/null) || k=""
        if [ -z "$k" ] || yr_inside_root "$k" "$root" || yr_inside_root "$val" "$root"; then
            YR_HARDEN_MSG="$name points inside the repository; unset it or point it outside the repository"
            return 1
        fi
    done
    # GIT_CONFIG makes `git config` read that one file and nothing else, so
    # every config scan would miss the repository's own entries: refuse it,
    # whatever it points at.
    if [ -n "${GIT_CONFIG+x}" ]; then
        YR_HARDEN_MSG="GIT_CONFIG is set, which hides the repository config from the checks; unset it"
        return 1
    fi
    # Without GIT_CONFIG_GLOBAL, git reads $XDG_CONFIG_HOME/git/config (else
    # $HOME/.config/git/config) and $HOME/.gitconfig.
    if [ -z "${GIT_CONFIG_GLOBAL+x}" ]; then
        for val in "${XDG_CONFIG_HOME:-${HOME:+$HOME/.config}}/git/config" "${HOME:+$HOME/.gitconfig}"; do
            case "$val" in /*) ;; *) continue ;; esac
            k=$(yr_canon_path "$val" 2>/dev/null) || k=""
            if [ -z "$k" ] || yr_inside_root "$k" "$root" || yr_inside_root "$val" "$root"; then
                YR_HARDEN_MSG="HOME or XDG_CONFIG_HOME puts git's global config inside the repository; point it outside the repository or set GIT_CONFIG_GLOBAL"
                return 1
            fi
        done
    fi
    n="${GIT_CONFIG_COUNT:-0}"
    case "$n" in ''|*[!0-9]*) n=0 ;; esac
    for ((i = 0; i < 10#$n; i++)); do
        name="GIT_CONFIG_KEY_$i"; k="${!name-}"
        name="GIT_CONFIG_VALUE_$i"; v="${!name-}"
        if yr_cmd_key "$k"; then
            yr_env_cmd_verdict "GIT_CONFIG_VALUE_$i" "$v" "$root" "(injected config)" || return 1
        fi
    done
    # GIT_CONFIG_PARAMETERS holds 'key'='value' (or 'key=value') entries that
    # git itself exports to child processes; judge each one the same way.
    rest="${GIT_CONFIG_PARAMETERS-}"
    while [[ "$rest" =~ \'([^\'=]+)\'=\'([^\']*)\'(.*)$ || "$rest" =~ \'([^\'=]+)=([^\']*)\'(.*)$ ]]; do
        k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"; rest="${BASH_REMATCH[3]}"
        if yr_cmd_key "$k"; then
            yr_env_cmd_verdict GIT_CONFIG_PARAMETERS "$v" "$root" "(injected config)" || return 1
        fi
    done
    return 0
}

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
    # Before any git call: an inherited environment can name a program inside
    # the worktree for git to run.
    yr_check_git_env || return 1
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
    local trc=0 tkey tre
    # A clean, smudge or process filter runs on `git add` and on checkout, so a
    # repository-local one is judged the same way; the three stock Git LFS
    # commands (`git lfs install --local`) are allowed by exact value.
    tre='^(core\.(sshcommand|askpass|gitproxy)|credential\.(.*\.)?helper|filter\..*\.(clean|smudge|process))$'
    [ "$scope" = revert ] && tre='^filter\..*\.(clean|smudge|process)$'
    # --null --show-scope emits `scope NUL key NL value NUL` per entry, so a
    # value holding newlines is read whole. The records go straight into awk
    # (a command substitution would drop the NULs); git's status 0 or 1 (no
    # match) is fine, anything else fails closed. The LFS exemption needs a
    # single-line value that matches exactly, and an awk that cannot split on
    # NUL sees mangled records that match nothing and are refused.
    tkey=$(set -o pipefail; yr_git config --null --show-scope --get-regexp "$tre" 2>/dev/null | yr_awk 'BEGIN { RS = "\0" }
        NR % 2 == 1 { sc = $0; next }
        {
            i = index($0, "\n")
            if (i == 0) { print "filter.<unparsed>.clean"; exit }
            k = substr($0, 1, i - 1); v = substr($0, i + 1)
            if (sc != "local" && sc != "worktree") next
            if (k ~ /^filter\.lfs\.(clean|smudge|process)$/ && (v == "git-lfs clean -- %f" || v == "git-lfs smudge -- %f" || v == "git-lfs filter-process" || v == "git-lfs smudge --skip -- %f" || v == "git-lfs filter-process --skip")) next
            print k; exit
        }') || trc=$?
    case "$trc" in
        0|1) ;;
        *) YR_HARDEN_MSG="could not parse the git transport config"; return 1 ;;
    esac
    # A credential URL can carry userinfo: name the key without it.
    case "$tkey" in
        credential.helper) ;;
        credential.*) tkey="credential.<url>.helper" ;;
        filter.*) tkey="filter.<driver>.clean|smudge|process" ;;
    esac
    if [ -n "$tkey" ]; then
        if [ "$scope" = revert ]; then
            YR_HARDEN_MSG="the repository config sets $tkey, which a checkout would run; remove it from the repository config (a global or system config is fine)"
        else
            YR_HARDEN_MSG="the repository config sets $tkey, which would run a command with submission authority; remove it from the repository config (a global or system config is fine)"
        fi
        return 1
    fi
    # The scan above skips the global and system scopes, which are the user's
    # own. A file of those scopes that lies inside the worktree is not: HOME,
    # XDG_CONFIG_HOME or an include can point there, and a resolver can write
    # it. Judge each command-bearing entry by the file it came from.
    local ore org o ofile c
    ore='^(core\.(sshcommand|askpass|gitproxy|pager|editor)|credential\.(.*\.)?helper|diff\.external|gpg\.(.*\.)?program|filter\..*\.(clean|smudge|process))$'
    [ "$scope" = revert ] && ore='^filter\..*\.(clean|smudge|process)$'
    org=$(set -o pipefail; yr_git config --show-scope --show-origin --name-only --list 2>/dev/null \
        | YR_ORE="$ore" yr_awk -F'\t' '$1 != "local" && $1 != "worktree" && $1 != "command" && tolower($3) ~ ENVIRON["YR_ORE"] { if (!($2 in s)) { s[$2] = 1; print $2 } }') \
        || { YR_HARDEN_MSG="could not read the git config origins"; return 1; }
    yr_split_lines "$org"
    local oroot
    oroot=$(yr_worktree_root || true)
    if [ -n "$oroot" ]; then
        for o in ${YR_LINES[@]+"${YR_LINES[@]}"}; do
            case "$o" in file:*) ofile=${o#file:} ;; *) continue ;; esac
            case "$ofile" in /*) ;; *) ofile="$(pwd -P)/$ofile" ;; esac
            c=$(yr_canon_path "$ofile" 2>/dev/null) || c=""
            if [ -z "$c" ] || yr_inside_root "$c" "$oroot" || yr_inside_root "$ofile" "$oroot"; then
                YR_HARDEN_MSG="a global or system git config file inside the repository sets a command that git would run; point HOME, XDG_CONFIG_HOME or the include outside the repository"
                return 1
            fi
        done
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
# is hidden behind a directory that cannot be searched. An optional third
# argument `follow` walks a target directory with find -L, so symlinks nested
# below it are judged by their targets too; a loop or any other find error then
# returns 2 (cannot tell). The trusted-config symlink check uses it, and so
# does rp_ignored_changed_since when given a path predicate; its unfiltered
# form does not. Run it from the working
# tree root with a path that does not begin with `-`.
rp_link_target_changed() {
    local l="$1" marker="$2" follow="${3:-}" t p d out skip="" rc=0 fl=-H
    if [ -e "$l" ]; then
        if [ -d "$l" ]; then
            [ "$follow" != follow ] || fl=-L
            # The root `.ruvector` link: skip its session log as the literal
            # directory scan does (see rp_ignored_changed_since).
            case "$l" in .ruvector|./.ruvector) skip="$l/coedit-sessions" ;; esac
            out=$(set -o pipefail
                find "$fl" "$l" -name .git -prune -o -path "$skip" -prune -o -type f -newer "$marker" -print 2>/dev/null \
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
# data nothing executes, and counting it would refuse every verify run. Collects
# up to 20 repository-relative paths and returns 1 when any file changed; a
# symlink is named by its own path. With a third argument <hitsfile> the raw
# names are written there NUL-terminated (a name may hold a newline) and
# nothing is printed; print them with rp_format_ignored_hits. Without it the
# names are printed one per line, control characters shown as `?`, never file
# contents. Returns 0 when none did and 2 when it cannot tell: the
# marker is missing, unreadable, not a regular file or a symlink, git or find
# fails, or a symlink's target cannot be examined. A caller must treat 2 as a
# refusal. Whole ignored directories are walked with find; the caller owns
# <scratch>, a scratch file for git's NUL-delimited listing. An optional fourth
# argument names a path predicate (rp_trusted_config; pass an empty <hitsfile>
# to keep the printed form): only paths it accepts count, and a directory walk
# filters before its 20-path cut. With a predicate a symlink's target is walked
# with `follow`, so a link nested below a linked directory is judged by its own
# target (a loop returns 2).
rp_ignored_changed_since() {
    local marker="$1" scratch="$2" hitsfile="${3:-}" keep="${4:-}" safe own=""
    [ -z "$keep" ] || declare -F -- "$keep" >/dev/null || return 2
    [ -f "$marker" ] && [ ! -L "$marker" ] && [ -r "$marker" ] || return 2
    # find, head, mktemp and the rest run by name after the resolvers wrote
    # the tree, so the walk uses the worktree-free PATH, as yr_git does.
    safe=$(yr_walk_path) || return 2
    if [ -z "$hitsfile" ]; then
        hitsfile=$(mktemp) || return 2
        own=1
    fi
    local wrc=0
    (
        PATH=$safe
        hash -r 2>/dev/null || true
        local mdir top f p l rc lrc symlist outfile x k dup n=0 seen=()
        mdir=$(cd -- "$(dirname -- "$marker")" 2>/dev/null && pwd) || exit 2
        marker="$mdir/$(basename -- "$marker")"
        # kept <path>: no predicate, or the predicate accepts the path.
        kept() { [ -z "$keep" ] || "$keep" "${1#./}"; }
        top=$(yr_git rev-parse --show-toplevel 2>/dev/null) || exit 2
        cd -- "$top" 2>/dev/null || exit 2
        symlist=$(mktemp) || exit 2
        outfile=$(mktemp) || exit 2
        trap 'rm -f -- "$symlist" "$outfile"' EXIT
        : >|"$hitsfile" || exit 2
        lgit ls-files --others --ignored --exclude-standard --directory -z >|"$scratch" 2>/dev/null || exit 2
        while IFS= read -r -d '' f; do
            case "$f" in .git|.git/*|*/.git|*/.git/*) continue ;; esac
            case "$f" in .ruvector/coedit-sessions|.ruvector/coedit-sessions/) continue ;; esac
            : >|"$outfile"
            rc=0
            if [ "${f%/}" != "$f" ]; then
                # A wholly ignored directory. Names stay NUL-delimited (a
                # name can hold a newline) and only the first 20 are kept, so
                # a tree rewritten end to end cannot fill memory; a find that
                # fails with nothing found is "cannot tell".
                # A predicate filters before the cut, so an accepted name
                # past 20 rejected ones still counts.
                (set -o pipefail
                    find "./$f" -name .git -prune -o -path ./.ruvector/coedit-sessions -prune -o \( -type f -o -type l \) -newer "$marker" -print0 2>/dev/null \
                        | { k=0; while IFS= read -r -d '' x; do kept "$x" || continue; [ "$k" -ge 20 ] || printf '%s\0' "$x" || exit 2; k=$((k + 1)); done; }) >|"$outfile" || rc=$?
                if [ ! -s "$outfile" ] && [ "$rc" -eq 0 ]; then
                    # Nothing newer: judge the target of each symlink inside.
                    find "./$f" -name .git -prune -o -path ./.ruvector/coedit-sessions -prune -o -type l -print0 >|"$symlist" 2>/dev/null || exit 2
                    while IFS= read -r -d '' l; do
                        # A path the predicate rejects never counts, so its
                        # target is not examined (it could abort the guard).
                        kept "$l" || continue
                        lrc=0
                        rp_link_target_changed "$l" "$marker" ${keep:+follow} || lrc=$?
                        case "$lrc" in
                            0) if kept "$l"; then printf '%s\0' "$l" >|"$outfile" || exit 2; break; fi ;;
                            1) ;;
                            *) exit 2 ;;
                        esac
                    done <"$symlist"
                fi
            elif [ -L "./$f" ]; then
                find "./$f" -type l -newer "$marker" -print0 >|"$outfile" 2>/dev/null || rc=$?
                kept "$f" || : >|"$outfile"
                if [ ! -s "$outfile" ] && [ "$rc" -eq 0 ] && kept "$f"; then
                    lrc=0
                    rp_link_target_changed "./$f" "$marker" ${keep:+follow} || lrc=$?
                    case "$lrc" in
                        0) if kept "$f"; then printf '%s\0' "./$f" >|"$outfile" || exit 2; fi ;;
                        1) ;;
                        *) exit 2 ;;
                    esac
                fi
            elif [ -f "./$f" ]; then
                if [ "./$f" -nt "$marker" ] && kept "$f"; then printf '%s\0' "./$f" >|"$outfile" || exit 2; fi
            fi
            if [ ! -s "$outfile" ]; then
                [ "$rc" -eq 0 ] || exit 2
                continue
            fi
            while IFS= read -r -d '' p; do
                [ -n "$p" ] || continue
                p="${p#./}"
                # git lists an ignored symlink on its own and, when its whole
                # directory is ignored, again as part of that directory.
                dup=""
                for x in ${seen[@]+"${seen[@]}"}; do
                    [ "$x" != "$p" ] || { dup=1; break; }
                done
                [ -z "$dup" ] || continue
                seen+=("$p")
                printf '%s\0' "$p" >>"$hitsfile" || exit 2
                n=$((n + 1))
                [ "$n" -lt 20 ] || break
            done <"$outfile"
            [ "$n" -lt 20 ] || break
        done <"$scratch"
        [ "$n" -eq 0 ] || exit 1
        exit 0
    ) || wrc=$?
    if [ -n "$own" ]; then
        # Legacy form: one sanitized name per line on stdout.
        [ "$wrc" -ne 1 ] || rp_format_ignored_hits "$hitsfile" $'\n'
        rm -f -- "$hitsfile"
    fi
    return "$wrc"
}

# rp_format_ignored_hits <hitsfile> [separator]: print the NUL-delimited names
# rp_ignored_changed_since collected, each as one whole name with control
# characters (newline included) shown as `?`, joined by the separator (default
# ", ") and, for a newline separator, ended by one. A name holding a newline
# stays one name; it is never split into fragments.
rp_format_ignored_hits() {
    local f="$1" sep="${2:-, }" p first=1
    while IFS= read -r -d '' p; do
        p="${p//[[:cntrl:]]/?}"
        if [ "$first" = 1 ]; then first=""; else printf '%s' "$sep"; fi
        printf '%s' "$p"
    done <"$f"
    [ "$sep" != $'\n' ] || [ -n "$first" ] || printf '\n'
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
