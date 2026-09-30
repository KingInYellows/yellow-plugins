# shell-compat: library
# Shared by reply-pr-thread and file-followup-issue (POSIX sh; sourced).
# Resolver-written text is posted publicly under the user's account, and a
# review comment can steer the resolver into quoting a file it read. Refuse
# (never redact-and-post) anything that looks like a credential.
# The awk avoids {n,} intervals, which mawk does not support.
# shellcheck shell=sh

# rt_looks_secret <file>: exit 0 when the file contains a credential shape.
rt_looks_secret() {
    awk '
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/ { hit = 1 }
        /(^|[^A-Za-z0-9_])[A-Z][A-Z0-9_]*(_KEY|_TOKEN|_SECRET|_PASSWORD)[ \t]*[=:][ \t]*[^ \t]/ { hit = 1 }
        {
            l = tolower($0)
            if (l ~ /(pass(word|wd)?|secret|token|api[_-]?key|credential)["\047]?[ \t]*[=:][ \t]*["\047]?[^ \t"\047][^ \t"\047][^ \t"\047][^ \t"\047]/) hit = 1
            t = $0
            while (match(t, /[A-Za-z0-9+\/_=-]+/)) {
                w = substr(t, RSTART, RLENGTH)
                n = length(w)
                if (w ~ /^(ghp|gho|ghu|ghs|ghr)_/ && n >= 24) hit = 1
                if (w ~ /^github_pat_/ && n >= 30) hit = 1
                if (w ~ /^AKIA[0-9A-Z]/ && n >= 20) hit = 1
                if (w ~ /^xox[abprs]-/ && n >= 14) hit = 1
                if (w ~ /^sk-/ && n >= 23) hit = 1
                if (n >= 32 && w ~ /[a-z]/ && w ~ /[A-Z]/ && w ~ /[0-9]/) hit = 1
                t = substr(t, RSTART + RLENGTH)
            }
        }
        END { exit hit ? 0 : 1 }
    ' "$1"
}
