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
        # NAME_KEY=value with a literal-looking value (8+ token characters,
        # so `API_KEY = process.env.API_KEY` in code does not match).
        /(^|[^A-Za-z0-9_])[A-Z][A-Z0-9_]*(_KEY|_TOKEN|_SECRET|_PASSWORD)[ \t]*[=:][ \t]*["\047]?[A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-]/ { hit = 1 }
        {
            l = tolower($0)
            # keyword = "quoted value" (a type annotation such as
            # `token: string` is not a credential).
            if (l ~ /(pass(word|wd)?|secret|token|api[_-]?key|credential)["\047]?[ \t]*[=:][ \t]*["\047][^ \t"\047][^ \t"\047][^ \t"\047][^ \t"\047]/) hit = 1
            # split() keeps this linear on very long (minified) lines.
            n = split($0, ws, /[^A-Za-z0-9+\/_=-]+/)
            for (i = 1; i <= n; i++) {
                w = ws[i]
                m = length(w)
                if (m == 0) continue
                if (w ~ /^(ghp|gho|ghu|ghs|ghr)_/ && m >= 24) hit = 1
                if (w ~ /^github_pat_/ && m >= 30) hit = 1
                if (w ~ /^AKIA[0-9A-Z]/ && m >= 20) hit = 1
                if (w ~ /^xox[abprs]-/ && m >= 14) hit = 1
                if (w ~ /^sk-/ && m >= 23) hit = 1
                if (m >= 32 && w ~ /[a-z]/ && w ~ /[A-Z]/ && w ~ /[0-9]/) hit = 1
            }
        }
        END { exit hit ? 0 : 1 }
    ' "$1"
}
