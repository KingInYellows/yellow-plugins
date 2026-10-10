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
    local v="$1" root="$2" skipfirst="${3:-0}" phys tok t u c rest first=1 noglob=1
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
        # A short option with its value attached (`ssh -Fconfig`, `-I.`)
        # names that value as a path too.
        rest=""
        case "$t" in -[A-Za-z]?*) rest=${t#-?} ;; esac
        for u in "$t" "${t#*=}" "$rest"; do
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
            case "$t" in -*=*|-[A-Za-z]?*) ;; *) break ;; esac
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
# counts as entering, and so do a NAME=value operand, -P (env searches a path
# other than PATH) and -C/--chdir (env resolves the utility elsewhere)). A bare
# operand is looked up on the caller's PATH (YR_ORIG_PATH), the
# way the tool itself would be. An interpreter that is itself a #! script is
# judged the same way, to a depth of 4; a script at depth 5 counts as entering
# (the kernel follows such chains). Copies of this block (through
# yr_file_shebang_enters) sit in the two scripts' bootstrap resolvers, which
# run before this library is sourced; keep them identical.
yr_file_shebang_enters() {
    local f="$1" root="$2" depth="${3:-0}" line rest i x idx last k c cl val p args=""
    local -a w=() v=() nw=()
    [ -f "$f" ] || return 1
    IFS= read -r -n 512 line <"$f" 2>/dev/null || true
    case "$line" in '#!'*) ;; *) return 1 ;; esac
    [ "$depth" -le 4 ] || return 0
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
                    # env resolves the utility after a chdir: fail closed.
                    --chdir|--chdir=*) return 0 ;;
                    --unset|--argv0) idx=$((idx + 2)); continue ;;
                    --*) idx=$((idx + 1)); continue ;;
                    -?*)
                        cl=${x#-}
                        k=0
                        while [ "$k" -lt "${#cl}" ]; do
                            c=${cl:k:1}
                            case "$c" in
                                P|C)
                                    # env searches another path than PATH, or
                                    # chdirs first: fail closed.
                                    return 0
                                    ;;
                                S)
                                    val=${cl:k+1}; last=$idx
                                    if [ -z "$val" ]; then val=${w[idx + 1]-}; last=$((idx + 1)); fi
                                    break
                                    ;;
                                u|a)
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
            # A nested env or other launcher (`env -S env PATH=tools evil`,
            # `env nice sudo evil`) takes operands this parser does not
            # follow: fail closed.
            case "${i##*/}" in env|nice|nohup|timeout|stdbuf|sudo|doas|xargs|setsid|ionice|chrt|taskset|flock|unbuffer|chroot|runuser|su|caffeinate) return 0 ;; esac
            case "$i" in
                */*) ;;
                *) i=$(PATH=${YR_ORIG_PATH-$PATH}; type -P "$i" 2>/dev/null) || return 1 ;;
            esac
            ;;
        *) args=${rest#"$i"} ;;
    esac
    # A $, backtick, ~, backslash or glob character (* ? [) in an argument is
    # expanded or decoded by the program the line starts (`#!/bin/sh -c
    # $PWD/evil`, which BSD and macOS pass as separate arguments), so no path
    # in it can be judged: fail closed.
    case "$args" in *[\$\`~\\*?[]*) return 0 ;; esac
    # A shell control operator, redirection or grouping (`#!/bin/sh -c
    # PATH=tools:/usr/bin;evil`) lets a `-c` string run a command no path
    # check sees: fail closed.
    case "$args" in *[\;\&\|\<\>\(\)]*) return 0 ;; esac
    if [ -n "$args" ] && yr_args_enter "$args" "$root" 0; then
        return 0
    fi
    case "$i" in /*) p="$i" ;; *) p="$(pwd -P)/$i" ;; esac
    c=$(yr_canon_path "$p" 2>/dev/null) || return 0
    yr_inside_root "$c" "$root" && return 0
    yr_inside_root "$p" "$root" && return 0
    yr_file_shebang_enters "$c" "$root" $((depth + 1))
}

# yr_hardlink_enters <file> <root>: succeed when <file> has other hard links
# and one of them is inside <root> (a link to an ignored script there keeps
# the script's content under an outside name), or when that cannot be told
# (the link count unreadable, or the walk of <root> failed before a match).
# find comes from yr_helper, never PATH. The tree is walked only for a file
# with a link count above 1 that is on the worktree's device.
yr_hardlink_enters() {
    local f="$1" root="$2" find fd rd hit
    [ -f "$f" ] || return 1
    find=$(yr_helper find) || return 0
    hit=$("$find" "$f" -maxdepth 0 -links +1 -print 2>/dev/null) || return 0
    [ -n "$hit" ] || return 1
    fd=$("$find" "$f" -maxdepth 0 -printf '%D' 2>/dev/null) || fd=""
    rd=$("$find" "$root" -maxdepth 0 -printf '%D' 2>/dev/null) || rd=""
    if [ -n "$fd" ] && [ -n "$rd" ] && [ "$fd" != "$rd" ]; then return 1; fi
    hit=$("$find" "$root" -xdev -type f -samefile "$f" -print -quit 2>/dev/null) || return 0
    [ -n "$hit" ]
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
        # A hard link to a file inside the worktree is that file.
        yr_hardlink_enters "$canon" "$root" && return 2
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
    local root="$1" find="$2" rp="$3" awk="$4" out dirs prog depth=1
    shift 4
    dirs=$(IFS=:; printf '%s' "$*")
    prog='function splice(val, last,    m, v, j, nn, t) {
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
                        if (name == "--chdir") { pr(root); return "" }
                        if ((name == "--unset" || name == "--argv0") && x !~ /=/) idx++
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
                        if (c == "P" || c == "C") { pr(root); return "" }
                        if (c ~ /[ua]/) { if (substr(cl, k + 1) == "") idx++; break }
                    }
                } else if (x ~ /=/) { pr(root); return "" }
                else { gsub(/^["\047]|["\047]$/, "", x); if (x ~ /(^|\/)(env|nice|nohup|timeout|stdbuf|sudo|doas|xargs|setsid|ionice|chrt|taskset|flock|unbuffer|chroot|runuser|su|caffeinate)$/) { pr(root); return "" } return x }
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
            if (txt ~ /[$`~\\*?[;&|<>()]/) { pr(root); return }
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
        } { nextfile }'
    out=$(YR_SB_DIRS="$dirs" YR_SB_CWD="$(pwd -P)" YR_SB_ROOT="$root" "$find" -L "$@" -maxdepth 1 -type f \( -perm -100 -o -perm -010 -o -perm -001 \) \
        -exec "$awk" "$prog" {} + 2>/dev/null) || true
    # The interpreters found are themselves judged: one that is a #! script
    # has its own line read, to a depth of 4 (an interpreter script at depth 5
    # counts as entering, as in yr_file_shebang_enters).
    while [ -n "$out" ]; do
        yr_split_lines "$out"
        out=$("$rp" -m -- "${YR_LINES[@]}" 2>/dev/null) || true
        yr_batch_canon_inside "$root" "$out" "$find" "$awk" && return 0
        [ -n "$out" ] || return 1
        yr_split_lines "$out"
        # realpath -m keeps candidates that do not exist (an env operand is
        # tried in every <dir>), and awk stops at the first file it cannot
        # open: hand it only existing regular files.
        out=$(YR_SB_DIRS="$dirs" YR_SB_CWD="$(pwd -P)" YR_SB_ROOT="$root" "$find" -L "${YR_LINES[@]}" -maxdepth 0 -type f \
            -exec "$awk" "$prog" {} + 2>/dev/null) || true
        [ -n "$out" ] || return 1
        [ "$depth" -lt 5 ] || return 0
        depth=$((depth + 1))
    done
    return 1
}

# yr_hardlink_inside <root> <find> <awk> <dir>...: succeed when any regular
# file directly in any <dir> (links followed) has a link count above 1 and
# shares its device and inode with a regular file inside <root>: a hard link
# is no symlink and has no #! to read, but it is the worktree's file under an
# outside name. Only files on the worktree's device can match, so the tree is
# walked (-xdev, once per yr_safe_path call: YR_HL_TREE) only when a <dir>
# holds such a file. A find without -printf cannot tell; yr_safe_path then
# uses yr_hardlink_stat per directory.
yr_hardlink_inside() {
    local root="$1" find="$2" awk="$3" dev cands
    shift 3
    dev=$("$find" "$root" -maxdepth 0 -printf '%D' 2>/dev/null) || dev=""
    # Not checked for errors: -L reports a symlink loop such as /usr/bin/X11
    # as one, and the entries it did list are all that matters here.
    cands=$("$find" -L "$@" -maxdepth 1 -type f -links +1 -printf '%D:%i\n' 2>/dev/null) || true
    [ -n "$cands" ] || return 1
    [ -z "$dev" ] || cands=$(printf '%s\n' "$cands" | "$awk" -v d="$dev:" 'index($0, d) == 1')
    [ -n "$cands" ] || return 1
    # A walk that fails part way (an unreadable directory hides links) is not
    # cached and not trusted: every directory holding a same-device multi-link
    # file is dropped, as in yr_hardlink_stat.
    if [ -z "${YR_HL_TREE+x}" ]; then
        YR_HL_TREE=$("$find" "$root" -xdev -type f -links +1 -printf '%D:%i\n' 2>/dev/null) || { unset YR_HL_TREE; return 0; }
    fi
    [ -n "$YR_HL_TREE" ] || return 1
    printf '%s\n' "$YR_HL_TREE" | YR_HL_C="$cands" "$awk" 'BEGIN { n = split(ENVIRON["YR_HL_C"], a, "\n"); for (i = 1; i <= n; i++) s[a[i]] = 1 } ($0 in s) { f = 1; exit } END { exit !f }'
}

# yr_hardlink_stat <dir> <root>: the fallback of yr_hardlink_inside for a
# system without a find that has -printf: succeed when any non-directory
# directly in <dir> has a link count above 1 and is on the worktree's device,
# or when stat (GNU or BSD, from yr_helper) cannot tell. Without find the
# inode cannot be matched, so a same-device multi-link file drops the
# directory. A directory on another device cannot hold a link into the tree.
yr_hardlink_stat() {
    local dir="$1" root="$2" stat out rd line links dev
    stat=$(yr_helper stat) || return 0
    rd=$("$stat" -L -c '%d' -- "$root" 2>/dev/null) || rd=$("$stat" -L -f '%d' "$root" 2>/dev/null) || return 0
    # Unmatched globs stay literal and make stat exit non-zero after printing
    # the rest, so the output is used whatever the status.
    out=$("$stat" -L -c '%h %d %F' -- "$dir"/* "$dir"/.[!.]* "$dir"/..?* 2>/dev/null) || true
    [ -n "$out" ] || out=$("$stat" -L -f '%l %d %HT' "$dir"/* "$dir"/.[!.]* "$dir"/..?* 2>/dev/null) || true
    while read -r links dev line; do
        [ -n "$links" ] || continue
        case "$line" in [Dd]irectory*) continue ;; esac
        [ "$dev" = "$rd" ] && [ "$links" -gt 1 ] 2>/dev/null && return 0
    done <<<"$out"
    return 1
}

# yr_hardlink_any <root> <find> <awk> <dir>...: yr_hardlink_inside, or
# yr_hardlink_stat per directory when this find has no -printf.
yr_hardlink_any() {
    local root="$1" find="$2" awk="$3" d
    shift 3
    if "$find" "$root" -maxdepth 0 -printf '' 2>/dev/null; then
        yr_hardlink_inside "$root" "$find" "$awk" "$@"
        return
    fi
    for d in "$@"; do
        yr_hardlink_stat "$d" "$root" && return 0
    done
    return 1
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
    yr_hardlink_stat "$1" "$2"
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
# (yr_shebang_inside, interpreter scripts followed to depth 4) and one more
# find lists the files with several hard links (yr_hardlink_inside: a hard
# link to a file in the worktree has no #! and is no symlink); only when either finds a problem is each
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
            unset YR_HL_TREE
            if yr_batch_inside "$root" "$find" "$rp" "$awk" "${dirs[@]}" \
                || yr_shebang_inside "$root" "$find" "$rp" "$awk" "${dirs[@]}" \
                || yr_hardlink_any "$root" "$find" "$awk" "${dirs[@]}"; then
                for i in "${cand[@]}"; do
                    if yr_batch_inside "$root" "$find" "$rp" "$awk" "${ents[i]}" \
                        || yr_shebang_inside "$root" "$find" "$rp" "$awk" "${ents[i]}" \
                        || yr_hardlink_any "$root" "$find" "$awk" "${ents[i]}"; then
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

# yr_prog_enters <value> <root>: judge <value> as ONE program path, never split
# into words (GIT_SSH, GIT_ASKPASS, SSH_ASKPASS, core.askpass, gpg.program: git
# and ssh exec the whole string, so `dir with space/evil` is one path). Returns
#   0  it would run a program inside <root>, or a path cannot be
#      canonicalized or its links cannot be checked (fail closed);
#   1  it is fine.
# A word containing `/` skips PATH, so it is resolved against the current
# directory and, when relative, against <root> as well (git runs transports
# from the worktree), and refused when the existing result, its symlink target, a
# script it names with #! or a hard link behind it is inside <root>. A bare
# name is looked up on the screened PATH only.
yr_prog_enters() {
    local v="$1" root="$2" phys bin c base
    [ -n "$v" ] || return 1
    phys=$(pwd -P) || return 0
    case "$v" in
        */*)
            for base in "$phys" "$root"; do
                case "$v" in /*) bin="$v" ;; *) bin="$base/$v" ;; esac
                # A path that does not exist runs nothing.
                [ -e "$bin" ] || [ -L "$bin" ] || continue
                c=$(yr_canon_path "$bin" 2>/dev/null) || return 0
                yr_inside_root "$bin" "$root" && return 0
                yr_inside_root "$c" "$root" && return 0
                if [ -e "$c" ]; then
                    yr_file_shebang_enters "$c" "$root" && return 0
                    yr_hardlink_enters "$c" "$root" && return 0
                fi
                case "$v" in /*) break ;; esac
            done
            ;;
        *)
            bin=$(PATH=${YR_GIT_PATH:-$PATH}; type -P "$v" 2>/dev/null) || bin=""
            if [ -n "$bin" ]; then
                c=$(yr_canon_path "$bin" 2>/dev/null) || return 0
                yr_inside_root "$c" "$root" && return 0
                yr_file_shebang_enters "$c" "$root" && return 0
            fi
            ;;
    esac
    return 1
}

# yr_cmd_enters <value> <root>: judge a shell command line (GIT_SSH_COMMAND, a
# pager or editor, a credential helper, a program-running config value). Git
# hands it to the shell, so `sh <root>/script` and `ssh -F <root>/cfg` count,
# not only a first word that is a path. Returns
#   0  it would run or read something inside <root> (or a path cannot be
#      canonicalized, or the first word is a NAME=value assignment: fail
#      closed);
#   2  it uses shell syntax this check cannot judge: $ (expansion), backtick,
#      ; & | < > ( ) * ? [ a backslash, a quote inside a word, a quote that
#      does not wrap exactly one word (a quoted span containing whitespace) or a newline,
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
    local v="$1" root="$2" tok t bin c first="" noglob=1 phys inenv optprev
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
        # A quote that opens in one word and closes in another quotes a span
        # with whitespace (`sh 'dir with space/evil'`), which the split cannot
        # see whole: a word may carry a quote only as a matching wrapper.
        case "$t" in
            \"?*\"|\'?*\') ;;
            [\"\']*|*[\"\']) return 2 ;;
        esac
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
    # A leading NAME=value is a shell assignment applied to the command, and
    # PATH=tools (or IFS, ENV, ...) changes what runs: fail closed on any.
    [[ "$t" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && return 0
    # eval re-parses its operands as shell syntax this check cannot judge.
    [ "${t##*/}" = eval ] && return 0
    # A launcher word (the shell's command, exec, time, builtin, or a program
    # such as nice, sudo or timeout) and env run the words after them, so the
    # utility is the first word that is not a launcher, an option or a number
    # (`timeout 5 ssh`), looked up below like a first word. An assignment or
    # eval before it fails closed (`command env PATH=tools ssh`), and so does
    # any option given to env (-S, -P, -C, -u ... change how the utility is
    # found); a launcher's own options are skipped. A launcher option may
    # take the next word as its operand (`stdbuf -o L env PATH=tools ssh`),
    # which this check cannot tell from the utility, so a non-numeric word
    # right after a launcher option fails closed (`sudo -u git ssh` too).
    case "${t##*/}" in
        command|exec|time|builtin|env|nice|nohup|timeout|stdbuf|sudo|doas|xargs|setsid|ionice|chrt|taskset|flock|unbuffer|chroot|runuser|su|caffeinate)
            inenv=0
            optprev=0
            [ "${t##*/}" = env ] && inenv=1
            t=""
            for tok in ${toks[@]+"${toks[@]:1}"}; do
                tok=${tok#[\"\']}
                tok=${tok%[\"\']}
                [[ "$tok" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] && return 0
                case "${tok##*/}" in
                    eval) return 0 ;;
                    env) [ "$optprev" -eq 0 ] || return 0; inenv=1; continue ;;
                    command|exec|time|builtin|nice|nohup|timeout|stdbuf|sudo|doas|xargs|setsid|ionice|chrt|taskset|flock|unbuffer|chroot|runuser|su|caffeinate)
                        [ "$optprev" -eq 0 ] || return 0; inenv=0; continue ;;
                esac
                case "$tok" in
                    -*) [ "$inenv" -eq 0 ] || return 0; optprev=1; continue ;;
                    [0-9]*) [ "$inenv" -eq 1 ] || { optprev=0; continue; } ;;
                esac
                [ "$optprev" -eq 0 ] || return 0
                t=$tok
                break
            done
            ;;
    esac
    # python -m looks the module up in the current directory first
    # (`python3 -m evil` runs ./evil.py): fail closed on any -m.
    case "${t##*/}" in
        python|python[0-9]*|pypy|pypy[0-9]*)
            for tok in ${toks[@]+"${toks[@]}"}; do
                tok=${tok#[\"\']}
                case "$tok" in --*) ;; -*m*) return 0 ;; esac
            done
            ;;
    esac
    case "$t" in
        ''|-*|'~'*) ;;
        */*) yr_prog_enters "$t" "$root" && return 0 ;;
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

# The one list of config keys whose value git, gt or a program they start runs
# as a command (lowercase; matched case-insensitively, so a subsection spelled
# in any case matches). yr_cfg_key_runs_command applies it with the value
# refinements below; harden_git_config and yr_check_git_env both use it. Not
# listed on purpose: core.hooksPath (the commit script handles hooks and
# supported repositories set it) and core.fsmonitor (forced off for the whole
# process). Also see `git help config` before adding a key.
YR_CFG_CMD_KEY_RE='^(core\.(sshcommand|askpass|gitproxy|editor|pager|alternaterefscommand)|credential\.(.*\.)?helper|filter\..*\.(clean|smudge|process)|merge\..*\.driver|diff\.(external|.*\.(command|textconv))|gpg\.(.*\.)?(program|defaultkeycommand)|sequence\.editor|pager\..*|uploadpack\.packobjectshook|remote\..*\.(uploadpack|receivepack|vcs)|(difftool|mergetool)\..*\.(cmd|path)|trailer\..*\.(cmd|command)|lfs\.(customtransfer\..*|standalonetransferagent|extension\..*)|alias\..*|submodule\..*\.update|url\.ext::.*\.(push)?insteadof)$'

# yr_cfg_key_runs_command <key> [value] [checkout]: succeed when <key> names a
# program (YR_CFG_CMD_KEY_RE) that would run. Value refinements, applied only
# when a value is given: alias.* and submodule.*.update run only when the value
# starts with !, and pager.<cmd> only when it is not a boolean. With
# "checkout", only the keys a checkout or a filter run reaches (filter.* and
# lfs.*) count: the rollback modes use that subset of the same list.
yr_cfg_key_runs_command() {
    local k="$1" v="${2-}" mode="${3-}" r=1 had=0
    shopt -q nocasematch && had=1
    shopt -s nocasematch
    if [[ "$k" =~ $YR_CFG_CMD_KEY_RE ]]; then
        r=0
        if [ "$#" -ge 2 ]; then
            case "$k" in
                alias.*|submodule.*.update) case "$v" in '!'*) ;; *) r=1 ;; esac ;;
                pager.*) case "$v" in ''|true|false|yes|no|on|off|0|1) r=1 ;; esac ;;
            esac
        fi
        if [ "$mode" = checkout ]; then
            case "$k" in filter.*|lfs.*) ;; *) r=1 ;; esac
        fi
    fi
    [ "$had" -eq 1 ] || shopt -u nocasematch
    return $r
}

# yr_pct_decode <text>: set YR_DECODED to <text> with %09 (tab), %0A (newline)
# and %25 (%) decoded, in that order, so an encoded %09 stays literal.
yr_pct_decode() {
    local x="$1"
    x=${x//%09/$'\t'}
    x=${x//%0A/$'\n'}
    YR_DECODED=${x//%25/%}
}

# yr_cfg_key_label <key>: a name for <key> that never carries its subsection
# (a URL can hold userinfo) or the value.
yr_cfg_key_label() {
    case "$1" in
        [Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll].*.*.*) printf 'credential.<url>.helper' ;;
        [Cc][Rr][Ee][Dd][Ee][Nn][Tt][Ii][Aa][Ll].*) printf 'credential.helper' ;;
        [Ff][Ii][Ll][Tt][Ee][Rr].*) printf 'filter.<driver>.clean|smudge|process' ;;
        [Mm][Ee][Rr][Gg][Ee].*) printf 'merge.<driver>.driver' ;;
        [Dd][Ii][Ff][Ff].*) printf 'diff.<driver>.command|textconv|external' ;;
        [Gg][Pp][Gg].*) printf 'gpg.program' ;;
        [Ll][Ff][Ss].*) printf 'lfs.<customtransfer|standalonetransferagent|extension> (a Git LFS program)' ;;
        [Rr][Ee][Mm][Oo][Tt][Ee].*) printf 'remote.<name>.uploadpack|receivepack|vcs' ;;
        [Uu][Rr][Ll].*) printf 'url.<ext::...>.insteadOf' ;;
        [Aa][Ll][Ii][Aa][Ss].*) printf 'alias.<name> (a ! command)' ;;
        [Pp][Aa][Gg][Ee][Rr].*) printf 'pager.<command>' ;;
        [Ss][Uu][Bb][Mm][Oo][Dd][Uu][Ll][Ee].*) printf 'submodule.<name>.update (a ! command)' ;;
        [Dd][Ii][Ff][Ff][Tt][Oo][Oo][Ll].*|[Mm][Ee][Rr][Gg][Ee][Tt][Oo][Oo][Ll].*) printf '(diff|merge)tool.<name>.cmd|path' ;;
        [Tt][Rr][Aa][Ii][Ll][Ee][Rr].*) printf 'trailer.<token>.cmd|command' ;;
        *) printf '%s' "$1" ;;
    esac
}

# yr_include_key <config key>: succeed for include.path or includeIf.*.path,
# which pull a file into command scope that the config scans then skip.
yr_include_key() {
    local r=1 had=0
    shopt -q nocasematch && had=1
    shopt -s nocasematch
    [[ "$1" =~ ^(include\.path|includeif\..*\.path)$ ]] && r=0
    [ "$had" -eq 1 ] || shopt -u nocasematch
    return $r
}

# yr_cfg_value_path_key <key>: succeed for the keys whose value is one program
# path that git execs without a shell (core.askpass, gpg.program,
# gpg.<format>.program); every other program key holds a shell command line.
yr_cfg_value_path_key() {
    local l
    l=$(rp_lower "$1")
    case "$l" in core.askpass|gpg.program|gpg.*.program) return 0 ;; esac
    return 1
}

# yr_cfg_value_enters <key> <value> <root>: succeed when a program-running
# config value would run something inside <root>. Used for entries from files
# outside the worktree, whose origin is trusted but whose value can still name
# `./evil`, which resolves against the worktree. Shell syntax this check cannot
# judge is tolerated here (the user's own global alias or pager keeps working);
# only a definite hit refuses. For url.ext::<command>.insteadOf the command
# in the key is judged too.
yr_cfg_value_enters() {
    local k="$1" v="$2" root="$3" rc=0 l
    # url.ext::<command>.insteadOf keeps the command git runs in the key's
    # subsection, not the value (which is only the URL it rewrites).
    l=$(rp_lower "$k")
    case "$l" in
        url.ext::*.insteadof|url.ext::*.pushinsteadof)
            l=${k:9}
            l=${l%.*}
            yr_cmd_enters "$l" "$root" || rc=$?
            [ "$rc" -ne 0 ] || return 0
            rc=0
            ;;
    esac
    [ -n "$v" ] || return 1
    if yr_cfg_value_path_key "$k"; then
        yr_prog_enters "$v" "$root"
        return $?
    fi
    yr_cmd_enters "$v" "$root" || rc=$?
    [ "$rc" -eq 0 ]
}

# yr_env_path_verdict <name> <value> <root> [note]: like yr_env_cmd_verdict for
# a variable or key that holds one program path (never split into words).
yr_env_path_verdict() {
    if yr_prog_enters "$2" "$3"; then
        YR_HARDEN_MSG="$1${4:+ $4} names a program inside the repository (or one that cannot be checked); unset it or point it outside the repository"
        return 1
    fi
    return 0
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
# VISUAL), the path variables (GIT_TEMPLATE_DIR,
# GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM; any GIT_EXEC_PATH or GIT_CONFIG is refused) and config
# injected through
# GIT_CONFIG_KEY_<i>/GIT_CONFIG_VALUE_<i> (below GIT_CONFIG_COUNT) and
# GIT_CONFIG_PARAMETERS, judged by the same rules as the repository's own
# config; an injected include.path or includeIf.*.path is refused outright. A GIT_CONFIG_COUNT that is not a number is refused by
# harden_git_config itself.
yr_check_git_env() {
    local root name val i n k v rest
    root=$(yr_worktree_root || true)
    [ -n "$root" ] || return 0
    # GIT_SSH, GIT_ASKPASS and SSH_ASKPASS hold one program path that is exec'd
    # whole, spaces included: judged unsplit.
    for name in GIT_SSH GIT_ASKPASS SSH_ASKPASS; do
        val="${!name-}"
        [ -n "$val" ] || continue
        yr_env_path_verdict "$name" "$val" "$root" || return 1
    done
    for name in GIT_SSH_COMMAND GIT_PROXY_COMMAND \
        GIT_EXTERNAL_DIFF GIT_PAGER PAGER GIT_EDITOR EDITOR VISUAL; do
        val="${!name-}"
        [ -n "$val" ] || continue
        yr_env_cmd_verdict "$name" "$val" "$root" || return 1
    done
    # Git runs git-remote-* and the other dashed helpers from this directory,
    # and a symlink or hard link there can reach the worktree; the default exec
    # path is right for these scripts, so refuse any value.
    if [ -n "${GIT_EXEC_PATH-}" ]; then
        YR_HARDEN_MSG="GIT_EXEC_PATH is set, which lets git run helper programs from that directory; unset it"
        return 1
    fi
    for name in GIT_TEMPLATE_DIR GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM; do
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
        if yr_include_key "$k"; then
            YR_HARDEN_MSG="GIT_CONFIG_KEY_$i injects an include; git loads the file as command-line config, which the checks do not scan, so unset it"
            return 1
        fi
        if yr_cfg_key_runs_command "$k" "$v"; then
            if yr_cfg_value_path_key "$k"; then
                yr_env_path_verdict "GIT_CONFIG_VALUE_$i" "$v" "$root" "(injected config)" || return 1
            else
                yr_env_cmd_verdict "GIT_CONFIG_VALUE_$i" "$v" "$root" "(injected config)" || return 1
            fi
        fi
    done
    # GIT_CONFIG_PARAMETERS is git's own quoting: entries 'key'='value',
    # 'key=value' or 'key', separated by blanks; an embedded quote is written
    # '\''. Each entry is read from the start of what is left and must end at a
    # blank or the end; anything else (an escaped quote, junk, an unterminated
    # entry) cannot be decoded exactly and is refused, never skipped.
    rest="${GIT_CONFIG_PARAMETERS-}"
    local re1="^[[:space:]]*'([^'=]+)'='([^']*)'(.*)\$" re2="^[[:space:]]*'([^'=]+)=([^']*)'(.*)\$" re3="^[[:space:]]*'([^']+)'(.*)\$"
    while [[ -n "${rest//[[:space:]]/}" ]]; do
        if [[ "$rest" =~ $re1 || "$rest" =~ $re2 ]]; then
            k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"; rest="${BASH_REMATCH[3]}"
        elif [[ "$rest" =~ $re3 ]]; then
            k="${BASH_REMATCH[1]}"; v=""; rest="${BASH_REMATCH[2]}"
        else
            YR_HARDEN_MSG="GIT_CONFIG_PARAMETERS has an entry that cannot be decoded exactly; unset it"
            return 1
        fi
        if [ -n "$rest" ] && [[ "$rest" != [[:space:]]* ]]; then
            YR_HARDEN_MSG="GIT_CONFIG_PARAMETERS has an entry that cannot be decoded exactly; unset it"
            return 1
        fi
        if yr_include_key "$k"; then
            YR_HARDEN_MSG="GIT_CONFIG_PARAMETERS injects an include; git loads the file as command-line config, which the checks do not scan, so unset it"
            return 1
        fi
        if yr_cfg_key_runs_command "$k" "$v"; then
            if yr_cfg_value_path_key "$k"; then
                yr_env_path_verdict GIT_CONFIG_PARAMETERS "$v" "$root" "(injected config)" || return 1
            else
                yr_env_cmd_verdict GIT_CONFIG_PARAMETERS "$v" "$root" "(injected config)" || return 1
            fi
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
    # Screen PATH once in this shell. Every yr_git below runs in a $(...)
    # subshell, where an unprimed call recomputes the screen (about 0.2 s) and
    # loses the result, so a harden_git_config call cost a dozen screens.
    yr_prime_path || { YR_HARDEN_MSG="no usable directory is left on PATH after the worktree screen"; return 1; }
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
    # Every config entry that names a program (yr_cfg_key_runs_command, the one
    # list) is judged by where it came from, not by its scope: refused when it is
    # in the repository's local or worktree config, or in a file inside the
    # worktree, hard-linked to a file inside it, or that cannot be checked (a
    # global or system config can include such a file and keeps its scope).
    # The user's own global and system files outside the worktree keep working,
    # and values are never overridden (which would also disable the user's own
    # credential helper). Names only, never values. A clean, smudge or process
    # filter runs on `git add` and on checkout; the three stock Git LFS
    # commands (`git lfs install --local`) are allowed by exact value, and
    # .lfsconfig ignores the lfs keys that name a program. The scope `revert`
    # (rollback) judges the checkout subset of the list. gpg.* in the local
    # scopes is not refused here: signing is forced off below.
    # --null --show-scope --show-origin emits `scope NUL origin NUL key NL
    # value NUL` per entry, so a value holding newlines is read whole. awk
    # pre-filters with the same list and prints one tab-separated line per
    # candidate (M marks a multi-line value). Every field is percent-encoded
    # (%, tab and newline) so a path or value holding a tab cannot shift the
    # columns; the shell decodes them (yr_pct_decode); git's status 0 is required, and
    # an awk that cannot split on NUL is refused by the probe below.
    local tkey="" tscope trigin tkeyname tml tval ofile c oroot cache=$'\n'
    local recs
    # BWK awk (macOS /usr/bin/awk) reads RS = "\0" as paragraph mode and cuts
    # lines at NUL; blank lines in a value can then make the count a multiple
    # of 3 and hide a key. Refuse unless awk splits NUL records.
    recs=$(printf 'a\0b\0c\0' | yr_awk 'BEGIN { RS = "\0" } END { print NR }' 2>/dev/null) || recs=""
    if [ "$recs" != 3 ]; then
        YR_HARDEN_MSG="could not parse the git transport config: awk cannot split NUL-separated records (install gawk or mawk)"
        return 1
    fi
    recs=$(set -o pipefail; yr_git config --null --show-scope --show-origin --list 2>/dev/null | YR_RE="$YR_CFG_CMD_KEY_RE" yr_awk 'function pe(x) { gsub(/%/, "%25", x); gsub(/\t/, "%09", x); gsub(/\n/, "%0A", x); return x }
        BEGIN { RS = "\0" }
        NR % 3 == 1 { sc = $0; next }
        NR % 3 == 2 { og = $0; next }
        {
            i = index($0, "\n")
            if (i == 0) { k = $0; v = "" } else { k = substr($0, 1, i - 1); v = substr($0, i + 1) }
            if (sc == "command") next
            if (tolower(k) !~ ENVIRON["YR_RE"]) next
            ml = (index(v, "\n") > 0) ? "M" : "S"
            printf "%s\t%s\t%s\t%s\t%s\n", pe(sc), pe(og), pe(k), ml, pe(v)
        }
        END { if (NR % 3 != 0) printf "local\t-\t<unparsed>\tM\t\n" }') \
        || { YR_HARDEN_MSG="could not parse the git transport config"; return 1; }
    oroot=$(yr_worktree_root || true)
    local ckmode=""
    [ "$scope" = revert ] && ckmode=checkout
    while IFS=$'\t' read -r tscope trigin tkeyname tml tval; do
        [ -n "$tkeyname" ] || continue
        yr_pct_decode "$trigin"; trigin=$YR_DECODED
        yr_pct_decode "$tval"; tval=$YR_DECODED
        yr_pct_decode "$tkeyname"; tkeyname=$YR_DECODED
        if [ "$tkeyname" = "<unparsed>" ]; then
            YR_HARDEN_MSG="could not parse the git transport config"
            return 1
        fi
        yr_cfg_key_runs_command "$tkeyname" "$tval" $ckmode || continue
        if [ "$tml" = S ] && [[ "$tkeyname" =~ ^filter\.lfs\.(clean|smudge|process)$ ]]; then
            case "$tval" in
                "git-lfs clean -- %f"|"git-lfs smudge -- %f"|"git-lfs filter-process"|"git-lfs smudge --skip -- %f"|"git-lfs filter-process --skip") continue ;;
            esac
        fi
        case "$tscope" in
            local|worktree)
                case "$tkeyname" in [Gg][Pp][Gg].*) continue ;; esac
                tkey=$(yr_cfg_key_label "$tkeyname")
                if [ "$scope" = revert ]; then
                    YR_HARDEN_MSG="the repository config sets $tkey, which a checkout would run; remove it from the repository config (a global or system config is fine)"
                else
                    YR_HARDEN_MSG="the repository config sets $tkey, which would run a command with submission authority; remove it from the repository config (a global or system config is fine)"
                fi
                return 1
                ;;
        esac
        # Global, system and other scopes: the value first (a trusted file can
        # still name `./evil`, which resolves against the worktree), then the
        # file the entry came from.
        if [ -n "$oroot" ] && yr_cfg_value_enters "$tkeyname" "$tval" "$oroot"; then
            YR_HARDEN_MSG="a global or system git config sets $(yr_cfg_key_label "$tkeyname") to a program inside the repository; point it outside the repository"
            return 1
        fi
        case "$trigin" in file:*) ofile=${trigin#file:} ;; *) continue ;; esac
        case "$cache" in *$'\n'"$ofile"$'\n'*) continue ;; esac
        [ -n "$oroot" ] || { cache="$cache$ofile"$'\n'; continue; }
        case "$ofile" in /*) ;; *) ofile="$(pwd -P)/$ofile" ;; esac
        c=$(yr_canon_path "$ofile" 2>/dev/null) || c=""
        if [ -z "$c" ] || yr_inside_root "$c" "$oroot" || yr_inside_root "$ofile" "$oroot"; then
            YR_HARDEN_MSG="a global or system git config file inside the repository sets $(yr_cfg_key_label "$tkeyname"), a command that git would run; point HOME, XDG_CONFIG_HOME or the include outside the repository"
            return 1
        fi
        # A hard link to a file inside the worktree canonicalizes outside it.
        if yr_hardlink_enters "$c" "$oroot"; then
            YR_HARDEN_MSG="a global or system git config file that sets $(yr_cfg_key_label "$tkeyname") is hard-linked to a file inside the repository (or its links cannot be checked); point HOME, XDG_CONFIG_HOME or the include at a separate copy outside the repository"
            return 1
        fi
        cache="$cache$ofile"$'\n'
    done <<<"$recs"
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
            # The root `.ruvector` link: skip its co-edit state as the literal
            # directory scan does (see rp_ignored_changed_since).
            case "$l" in .ruvector|./.ruvector) skip="$l" ;; esac
            out=$(set -o pipefail
                find -H "$l" -name .git -prune -o -path "$skip/coedit-sessions" -prune \
                    -o \( -path "$skip/coedit.json" -type f \) -prune \
                    -o \( \( -path '*/node_modules/.vite/vitest/results.json' -o -path 'node_modules/.vite/vitest/results.json' \) -type f \) -prune -o -type f -newer "$marker" -print 2>/dev/null \
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
# as a link target. yellow-ruvector's co-edit state is skipped: the session log
# `.ruvector/coedit-sessions` (its PostToolUse hook rewrites it on every
# resolver Edit) entirely, and the pair store `.ruvector/coedit.json` (rewritten
# whenever one session edits a second file) while it is a regular file. Both
# are JSON data nothing executes, and counting them would refuse every resolve
# that edits two files. Anything else under `.ruvector/` still counts. Vitest's
# run cache `node_modules/.vite/vitest/results.json` (at any depth; a regular
# file only) is skipped too: every vitest run rewrites it, and vitest reads it
# only to order test files. Every other file under node_modules still counts.
# Collects up to 20 repository-relative paths and returns 1 when any file
# changed; a symlink is named by its own path. With a third argument <hitsfile>
# the raw names are written there NUL-terminated (a name may hold a newline)
# and nothing is printed; print them with rp_format_ignored_hits. Without it
# the names are printed one per line, control characters shown as `?`, never
# file contents. Returns 0 when none did and 2 when it cannot tell: the
# marker is missing, unreadable, not a regular file or a symlink, git or find
# fails, or a symlink's target cannot be examined. A caller must treat 2 as a
# refusal. Whole ignored directories are walked with find; the caller owns
# <scratch>, a scratch file for git's NUL-delimited listing.
rp_ignored_changed_since() {
    local marker="$1" scratch="$2" hitsfile="${3:-}" safe own=""
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
            case "$f" in
                .ruvector/coedit.json|node_modules/.vite/vitest/results.json|*/node_modules/.vite/vitest/results.json)
                    if [ -f "./$f" ] && [ ! -L "./$f" ]; then continue; fi ;;
            esac
            : >|"$outfile"
            rc=0
            if [ "${f%/}" != "$f" ]; then
                # A wholly ignored directory. Names stay NUL-delimited (a
                # name can hold a newline) and only the first 20 are kept, so
                # a tree rewritten end to end cannot fill memory; a find that
                # fails with nothing found is "cannot tell".
                (set -o pipefail
                    find "./$f" -name .git -prune -o -path ./.ruvector/coedit-sessions -prune \
                        -o \( -path ./.ruvector/coedit.json -type f \) -prune \
                        -o \( -path '*/node_modules/.vite/vitest/results.json' -type f \) -prune -o \( -type f -o -type l \) -newer "$marker" -print0 2>/dev/null \
                        | { k=0; while IFS= read -r -d '' x; do [ "$k" -ge 20 ] || printf '%s\0' "$x" || exit 2; k=$((k + 1)); done; }) >|"$outfile" || rc=$?
                if [ ! -s "$outfile" ] && [ "$rc" -eq 0 ]; then
                    # Nothing newer: judge the target of each symlink inside.
                    find "./$f" -name .git -prune -o -path ./.ruvector/coedit-sessions -prune -o -type l -print0 >|"$symlist" 2>/dev/null || exit 2
                    while IFS= read -r -d '' l; do
                        lrc=0
                        rp_link_target_changed "$l" "$marker" || lrc=$?
                        case "$lrc" in
                            0) printf '%s\0' "$l" >|"$outfile" || exit 2; break ;;
                            1) ;;
                            *) exit 2 ;;
                        esac
                    done <"$symlist"
                fi
            elif [ -L "./$f" ]; then
                find "./$f" -type l -newer "$marker" -print0 >|"$outfile" 2>/dev/null || rc=$?
                if [ ! -s "$outfile" ] && [ "$rc" -eq 0 ]; then
                    lrc=0
                    rp_link_target_changed "./$f" "$marker" || lrc=$?
                    case "$lrc" in
                        0) printf '%s\0' "./$f" >|"$outfile" || exit 2 ;;
                        1) ;;
                        *) exit 2 ;;
                    esac
                fi
            elif [ -f "./$f" ]; then
                if [ "./$f" -nt "$marker" ]; then printf '%s\0' "./$f" >|"$outfile" || exit 2; fi
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
