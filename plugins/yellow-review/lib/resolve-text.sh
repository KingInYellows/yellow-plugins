# shell-compat: library
# Shared by reply-pr-thread, file-followup-issue and check-resolve-text
# (POSIX sh; sourced).
# Resolver-written text is posted publicly under the user's account, and a
# review comment can steer the resolver into quoting a file it read. Refuse
# (never redact-and-post) anything that looks like a credential.
# The awk avoids {n,} intervals, which mawk does not support.
# shellcheck shell=sh

# rt_text_clean <file>: exit 0 only when the scan ran and found no credential
# shape. A credential hit, a scanner failure (awk missing or erroring) and an
# unreadable file all return non-zero, so a caller that refuses on non-zero
# fails closed instead of posting unscanned text.
# The status is captured explicitly, so a bare call under `set -e` returns it
# instead of aborting on the clean (awk 1) status; call it in a condition.
rt_text_clean() {
    _rt_rc=0
    rt_looks_secret "$1" || _rt_rc=$?
    [ "$_rt_rc" -eq 1 ]
}

# rt_looks_secret <file>: awk exit status. 0 means the file contains a
# credential shape, 1 means clean, anything else means the scan itself failed;
# use rt_text_clean unless the distinction matters.
rt_looks_secret() {
    awk '
        BEGIN {
            ph = " string number integer boolean object array unknown undefined"
            ph = ph " nullable optional required redacted placeholder example"
            ph = ph " secret password passwd token credential credentials apikey"
            ph = ph " masked hidden default missing invalid expired empty bearer"
            ph = ph " options config value values bytes buffer promise function"
            ph = ph " or and not the on of any null nil none true false "
        }
        toupper($0) ~ /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/ { hit = 1 }
        # NAME_KEY=value with a literal-looking value (8+ token characters,
        # so `API_KEY = process.env.API_KEY` in code does not match).
        /(^|[^A-Za-z0-9_])[A-Z][A-Z0-9_]*(_KEY|_TOKEN|_SECRET|_PASSWORD)[ \t]*[=:][ \t]*["\047]?[A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-]/ { hit = 1 }
        {
            l = tolower($0)
            # keyword = "quoted value" (a type annotation such as
            # `token: string` is not a credential). The keyword must start a
            # word, as in the unquoted branch below: `bypass="false"` is not
            # a `pass` keyword, but camelCase `userPassword="..."` is.
            r = l
            base = 0
            while (match(r, /(pass(word|wd)?|secret|token|api[_-]?key|credential)["\047]?[ \t]*[=:][ \t]*["\047][^ \t"\047][^ \t"\047][^ \t"\047][^ \t"\047]/)) {
                start = base + RSTART
                base += RSTART + RLENGTH - 1
                r = substr(r, RSTART + RLENGTH)
                if (!(start > 1 && substr($0, start - 1, 1) ~ /[A-Za-z]/ && substr($0, start, 1) !~ /[A-Z]/)) hit = 1
            }
            # keyword: unquoted-value. Flag only a plausible literal: 6+
            # characters, a digit or all letters (minus placeholder words),
            # and no call/reference punctuation, so `password: string`,
            # `password: z.string()` and `token: $TOKEN` stay clean.
            # For the letter-only branches below the keyword must start a
            # word: `bypass: something` is not a `pass` keyword. A letter
            # before it disqualifies it unless the keyword itself starts with
            # a capital (camelCase `userPassword`). A value with a digit is
            # flagged either way.
            r = l
            base = 0
            while (match(r, /(pass(word|wd)?|secret|token|api[_-]?key|credential)[ \t]*[=:][ \t]*[^ \t"\047,;)]+/)) {
                seg = substr(r, RSTART, RLENGTH)
                start = base + RSTART
                base += RSTART + RLENGTH - 1
                r = substr(r, RSTART + RLENGTH)
                inword = (start > 1 && substr($0, start - 1, 1) ~ /[A-Za-z]/ && substr($0, start, 1) !~ /[A-Z]/)
                sub(/^[^=:]*[=:][ \t]*/, "", seg)
                sub(/[.!?]+$/, "", seg)
                if (length(seg) < 6 || seg ~ /[(<${\[]/) continue
                if (seg ~ /[0-9]/) hit = 1
                # All-letter literal (`password: hunter`): flag unless it is a
                # known type or prose placeholder.
                else if (inword) continue
                else if (seg ~ /^[a-z]+$/ && index(ph, " " seg " ") == 0) hit = 1
                # Separated lowercase literal (`password: correct-horse-battery`):
                # flag unless every part is a placeholder word.
                else if (seg ~ /^[a-z]+([-_\/][a-z]+)+$/) {
                    np = split(seg, parts, /[-_\/]/)
                    allph = 1
                    for (j = 1; j <= np; j++) if (index(ph, " " parts[j] " ") == 0) allph = 0
                    if (!allph) hit = 1
                }
            }
            # Credentials in URL userinfo (scheme://user:pass@host); a
            # placeholder or variable password stays clean.
            # Guarded: the scheme pattern is quadratic on one huge line.
            r = index(l, "://") ? l : ""
            # The username may be empty (`https://:pass@host`); `?` and `#`
            # end the authority, so they cannot be part of the userinfo.
            while (match(r, /[a-z][a-z0-9+.-]*:\/\/[^\/@?# \t:]*:[^\/@?# \t]+@/)) {
                seg = substr(r, RSTART, RLENGTH)
                r = substr(r, RSTART + RLENGTH)
                sub(/^[^:]*:\/\/[^:]*:/, "", seg)
                sub(/@$/, "", seg)
                if (seg ~ /[<${\[%]/ || index(ph, " " seg " ") > 0) continue
                hit = 1
            }
            # Authorization header or Bearer/Basic scheme with an opaque
            # token of 20+ characters; `Authorization: none` stays clean.
            r = l
            while (match(r, /(authorization[ \t]*[=:][ \t]*([a-z]+[ \t]+)?|(bearer|basic)[ \t]+)[a-z0-9._~+\/=-]+/)) {
                seg = substr(r, RSTART, RLENGTH)
                r = substr(r, RSTART + RLENGTH)
                sub(/^.*[ \t=:]/, "", seg)
                if (length(seg) >= 20) hit = 1
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
                if (w ~ /^(sk|rk|pk)_live_/ && m >= 24) hit = 1
                # A long mixed-case token with a digit looks like a key, but
                # URLs and file paths are too and are routine in replies.
                # Exempt only a path-shaped token: 2+ slashes, no base64 `+`
                # or `=`, and every segment short or hyphen-separated words.
                if (m >= 32 && w ~ /[a-z]/ && w ~ /[A-Z]/ && w ~ /[0-9]/) {
                    pathlike = 0
                    if (w !~ /[+=]/) {
                        ns = split(w, segs, "/")
                        if (ns >= 3) {
                            pathlike = 1
                            for (j = 1; j <= ns; j++)
                                if (length(segs[j]) > 24 && segs[j] !~ /-/) pathlike = 0
                        }
                    }
                    if (!pathlike) hit = 1
                }
            }
        }
        END { exit hit ? 0 : 1 }
    ' < "$1"
}
