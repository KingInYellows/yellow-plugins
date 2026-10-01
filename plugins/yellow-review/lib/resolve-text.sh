# shell-compat: library
# Shared by reply-pr-thread, file-followup-issue and check-resolve-text
# (POSIX sh; sourced).
# Resolver-written text is posted publicly under the user's account, and a
# review comment can steer the resolver into quoting a file it read. Refuse
# (never redact-and-post) anything that looks like a credential.
# The awk avoids {n,} intervals, which mawk does not support.
# shellcheck shell=sh

# rt_looks_secret <file>: exit 0 when the file contains a credential shape.
rt_looks_secret() {
    awk '
        BEGIN {
            ph = " string number integer boolean object array unknown undefined"
            ph = ph " nullable optional required redacted placeholder example"
            ph = ph " secret password passwd token credential credentials apikey"
            ph = ph " masked hidden default missing invalid expired empty bearer"
            ph = ph " options config value values bytes buffer promise function "
        }
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/ { hit = 1 }
        # NAME_KEY=value with a literal-looking value (8+ token characters,
        # so `API_KEY = process.env.API_KEY` in code does not match).
        /(^|[^A-Za-z0-9_])[A-Z][A-Z0-9_]*(_KEY|_TOKEN|_SECRET|_PASSWORD)[ \t]*[=:][ \t]*["\047]?[A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-]/ { hit = 1 }
        {
            l = tolower($0)
            # keyword = "quoted value" (a type annotation such as
            # `token: string` is not a credential).
            if (l ~ /(pass(word|wd)?|secret|token|api[_-]?key|credential)["\047]?[ \t]*[=:][ \t]*["\047][^ \t"\047][^ \t"\047][^ \t"\047][^ \t"\047]/) hit = 1
            # keyword: unquoted-value. Flag only a plausible literal: 6+
            # characters, a digit or all letters (minus placeholder words),
            # and no call/reference punctuation, so `password: string`,
            # `password: z.string()` and `token: $TOKEN` stay clean.
            r = l
            while (match(r, /(pass(word|wd)?|secret|token|api[_-]?key|credential)[ \t]*[=:][ \t]*[^ \t"\047,;)]+/)) {
                seg = substr(r, RSTART, RLENGTH)
                r = substr(r, RSTART + RLENGTH)
                sub(/^[^=:]*[=:][ \t]*/, "", seg)
                sub(/[.!?]+$/, "", seg)
                if (length(seg) < 6 || seg ~ /[(<${\[]/) continue
                if (seg ~ /[0-9]/) hit = 1
                # All-letter literal (`password: hunter`): flag unless it is a
                # known type or prose placeholder.
                else if (seg ~ /^[a-z]+$/ && index(ph, " " seg " ") == 0) hit = 1
            }
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
                # A long mixed-case token with a digit looks like a key, but
                # URLs and file paths are too and are routine in replies.
                # Exempt slash-bearing tokens without base64 `+` or `=`.
                if (m >= 32 && w ~ /[a-z]/ && w ~ /[A-Z]/ && w ~ /[0-9]/) {
                    if (!(w ~ /\// && w !~ /[+=]/)) hit = 1
                }
            }
        }
        END { exit hit ? 0 : 1 }
    ' "$1"
}
