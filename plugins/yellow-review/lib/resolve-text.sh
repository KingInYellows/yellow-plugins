# shell-compat: library
# Shared by reply-pr-thread, file-followup-issue and check-resolve-text
# (POSIX sh; sourced).
# Resolver-written text is posted publicly under the user's account, and a
# review comment can steer the resolver into quoting a file it read. Refuse
# (never redact-and-post) anything that looks like a credential.
# The awk avoids {n,} intervals, which mawk does not support.
# This is deliberately not cs_redact_secrets (yellow-core) or RL_SUSP_AWK
# (lib/review-ledger.sh): those redact text that is then kept, and yellow-core
# is not a dependency of the resolve scripts. This one answers a different
# question (refuse or not), so it flags broader shapes (URL userinfo,
# Authorization/Bearer, NAME_KEY=value) and fails closed. When a vendor
# prefix is added to one scanner, check the other.
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
# use rt_text_clean unless the distinction matters. On a hit, RT_HIT_RULE and
# RT_HIT_LINE name the rule and line that matched (see rt_report_refusal).
# A missing or unreadable file returns 2: the failed `< "$1"` redirect below
# would otherwise leave status 1, which reads as clean.
rt_looks_secret() {
    RT_HIT_RULE=""
    RT_HIT_LINE=""
    [ -f "$1" ] && [ -r "$1" ] || return 2
    _rt_awk_rc=0
    _rt_out=$(awk '
        # flag(rule): the first hit wins; END reports its rule and line,
        # never the matched text.
        function flag(rule) {
            if (!hit) { hit = 1; hitrule = rule; hitline = NR }
        }
        # litval(seg, inword): 1 when an unquoted keyword value looks like a
        # literal credential. Flag only a plausible one: 6+ characters, a
        # digit or all letters (minus placeholder words), and no
        # call/reference punctuation, so `password: string`,
        # `password: z.string()` and `token: $TOKEN` stay clean.
        function litval(seg, inword,    np, parts, allph, j) {
            sub(/[.!?]+$/, "", seg)
            if (length(seg) < 6 || seg ~ /[(<${\[]/) return 0
            if (seg ~ /[0-9]/) return 1
            # All-letter literal (`password: hunter`): flag unless it is a
            # known type or prose placeholder.
            if (inword) return 0
            if (seg ~ /^[a-z]+$/ && index(ph, " " seg " ") == 0) return 1
            # Separated lowercase literal (`password: correct-horse-battery`,
            # `password: hunter@cats`): separators are punctuation that
            # passwords commonly use. Flag unless every part is a
            # placeholder word. A property access on a common config or
            # environment object (`token = process.env.api_key`) is a
            # reference, not a literal.
            if (seg ~ /^(process\.env|import\.meta\.env|os\.environ|env|this|self|config|settings|secrets|args|params|props)\./) return 0
            if (seg ~ /^[a-z]+([_\/.@+!#%^&*:-][a-z]+)+$/) {
                np = split(seg, parts, /[_\/.@+!#%^&*:-]/)
                allph = 1
                for (j = 1; j <= np; j++) if (index(ph, " " parts[j] " ") == 0) allph = 0
                return !allph
            }
            return 0
        }
        BEGIN {
            ph =" string number integer boolean object array unknown undefined"
            ph = ph " nullable optional required redacted placeholder example"
            ph = ph " secret password passwd token credential credentials apikey"
            ph = ph " masked hidden default missing invalid expired empty bearer"
            ph = ph " options config value values bytes buffer promise function"
            ph = ph " or and not the on of any null nil none true false "
        }
        toupper($0) ~ /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/ { flag("private-key") }
        # NAME_KEY=value with a literal-looking value (8+ token characters,
        # so `API_KEY = process.env.API_KEY` in code does not match).
        /(^|[^A-Za-z0-9_])[A-Z][A-Z0-9_]*(_KEY|_TOKEN|_SECRET|_PASSWORD)[ \t]*[=:][ \t]*["\047]?[A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-]/ { flag("name-key-assignment") }
        {
            # A CRLF file leaves \r on the token, which would hide an
            # all-letter literal from the value rules below.
            sub(/\r$/, "")
            l = tolower($0)
            # Each loop below copies the rest of the line per match, which is
            # quadratic on a huge hostile line. Cap the matches per loop and
            # refuse past the cap (truncating would fail open).
            nq = nu = nurl = nauth = 0
            # keyword = "quoted value" (a type annotation such as
            # `token: string` is not a credential). The keyword must start a
            # word, as in the unquoted branch below: `bypass="false"` is not
            # a `pass` keyword, but camelCase `userPassword="..."` is.
            r = l
            base = 0
            while (match(r, /(pass(word|wd)?|secret|token|api[_ \t-]?key|credential)["\047]?[ \t]*[=:][ \t]*["\047][^ \t"\047][^ \t"\047][^ \t"\047][^ \t"\047]/)) {
                start = base + RSTART
                base += RSTART + RLENGTH - 1
                if (++nq > 200) { flag("too-many-matches"); break }
                r = substr(r, RSTART + RLENGTH)
                if (!(start > 1 && substr($0, start - 1, 1) ~ /[A-Za-z]/ && substr($0, start, 1) !~ /[A-Z]/)) flag("quoted-keyword-assignment")
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
            while (match(r, /(pass(word|wd)?|secret|token|api[_ \t-]?key|credential)[ \t]*[=:][ \t]*[^ \t"\047,;)]+/)) {
                seg = substr(r, RSTART, RLENGTH)
                start = base + RSTART
                base += RSTART + RLENGTH - 1
                if (++nu > 200) { flag("too-many-matches"); break }
                r = substr(r, RSTART + RLENGTH)
                inword = (start > 1 && substr($0, start - 1, 1) ~ /[A-Za-z]/ && substr($0, start, 1) !~ /[A-Z]/)
                sub(/^[^=:]*[=:][ \t]*/, "", seg)
                if (litval(seg, inword)) flag("unquoted-keyword-value")
            }
            # A keyword alone on its line (`password:` then an indented
            # `  hunter` on the next line, YAML style) is checked against the
            # next non-blank line: only that line, then the carry resets.
            # Only a single token counts there, so prose after a keyword line
            # stays clean. Blank lines do not use up the carry.
            if (carry && $0 !~ /^[ \t\r]*$/) {
                carry = 0
                r = l
                sub(/\r$/, "", r)
                sub(/^[ \t]*(-[ \t]*)?/, "", r)
                q = (r ~ /^["\047]/)
                sub(/^["\047]/, "", r)
                if (match(r, /^[^ \t"\047,;)]+/)) {
                    seg = substr(r, RSTART, RLENGTH)
                    r = substr(r, RSTART + RLENGTH)
                    if (r ~ /^["\047]?[ \t\r,;]*$/ && litval(seg, carryin)) flag(q ? "quoted-keyword-assignment" : "unquoted-keyword-value")
                }
            }
            if (match(l, /(pass(word|wd)?|secret|token|api[_ \t-]?key|credential)["\047]?[ \t]*[=:][ \t\r]*$/)) {
                pre = substr($0, 1, RSTART - 1)
                if (pre ~ /^[ \t]*(-[ \t]*)?["\047]?[A-Za-z0-9_.-]*$/) {
                    carry = 1
                    carryin = (RSTART > 1 && substr($0, RSTART - 1, 1) ~ /[A-Za-z]/ && substr($0, RSTART, 1) !~ /[A-Z]/)
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
                if (++nurl > 200) { flag("too-many-matches"); break }
                r = substr(r, RSTART + RLENGTH)
                sub(/^[^:]*:\/\/[^:]*:/, "", seg)
                sub(/@$/, "", seg)
                # `%` marks a placeholder only when it is the WHOLE password:
                # `%NAME%`, `%(name)s` or a bare format spec (`%s`). A password
                # that merely contains one (`Hunter2%s`) or a `%HH` escape
                # (`p%40ss`) is a credential and must be scanned.
                if (seg ~ /[<${\[]/ || index(ph, " " seg " ") > 0) continue
                if (seg ~ /^%[a-z_][a-z0-9_]*%$/ || seg ~ /^%[0-9]*[a-z]$/ || seg ~ /^%\([a-z_][a-z0-9_]*\)[a-z]$/) continue
                flag("url-userinfo")
            }
            # Authorization header or Bearer/Basic scheme with an opaque
            # token of 20+ characters; `Authorization: none` stays clean.
            # Strip only the header name and scheme: a greedy strip through
            # the last `=` would empty a base64 token padded with `==`.
            r = l
            while (match(r, /(authorization[ \t]*[=:][ \t]*([a-z]+[ \t]+)?|(bearer|basic)[ \t]+)[a-z0-9._~+\/=-]+/)) {
                seg = substr(r, RSTART, RLENGTH)
                if (++nauth > 200) { flag("too-many-matches"); break }
                r = substr(r, RSTART + RLENGTH)
                sub(/^authorization[ \t]*[=:][ \t]*/, "", seg)
                sub(/^[a-z]+[ \t]+/, "", seg)
                if (length(seg) >= 20) flag("authorization-header")
            }
            # split() keeps this linear on very long (minified) lines.
            n = split($0, ws, /[^A-Za-z0-9+\/_=-]+/)
            for (i = 1; i <= n; i++) {
                w = ws[i]
                m = length(w)
                if (m == 0) continue
                # `=` is a word character (base64 padding), so `auth=ghp_...`
                # is one word: test the prefixes on the whole word and on the
                # part after its last `=`.
                t = w
                sub(/^.*=/, "", t)
                for (k = 0; k < 2; k++) {
                    if (k == 1 && t == w) break
                    v = k ? t : w
                    mv = length(v)
                    if (v ~ /^(ghp|gho|ghu|ghs|ghr)_/ && mv >= 24) flag("token-prefix")
                    if (v ~ /^github_pat_/ && mv >= 30) flag("token-prefix")
                    if (v ~ /^AKIA[0-9A-Z]/ && mv >= 20) flag("token-prefix")
                    if (v ~ /^xox[abprs]-/ && mv >= 14) flag("token-prefix")
                    if (v ~ /^sk-/ && mv >= 23) flag("token-prefix")
                    if (v ~ /^(sk|rk|pk)_live_/ && mv >= 24) flag("token-prefix")
                }
                # A long mixed-case token with a digit looks like a key, but
                # URLs, file paths and camelCase identifiers are too and are
                # routine in replies.
                # Exempt a path-shaped token: 2+ slashes, no base64 `+` or
                # `=`, and every segment short or hyphen-separated words.
                # Exempt an identifier-shaped token: letters only in humps of
                # an optional capital plus 2+ lowercase letters, and digit
                # runs (`ReviewFindingsHelper2`). Random key material breaks
                # that within a few characters. A token over 256 characters is
                # never exempt (fail closed), which keeps the match bounded.
                if (m >= 32 && w ~ /[a-z]/ && w ~ /[A-Z]/ && w ~ /[0-9]/) {
                    exempt = 0
                    if (w !~ /[+=]/) {
                        ns = split(w, segs, "/")
                        if (ns >= 3) {
                            exempt = 1
                            for (j = 1; j <= ns; j++)
                                if (length(segs[j]) > 24 && segs[j] !~ /-/) exempt = 0
                        }
                    }
                    if (m <= 256 && w ~ /^([A-Z]?[a-z][a-z]+|[0-9]+)+$/) exempt = 1
                    if (!exempt) flag("long-token")
                }
            }
        }
        END { if (hit) print hitrule, hitline; exit hit ? 0 : 1 }
    ' < "$1") || _rt_awk_rc=$?
    if [ "$_rt_awk_rc" -eq 0 ]; then
        RT_HIT_RULE=${_rt_out%% *}
        RT_HIT_LINE=${_rt_out##* }
    fi
    return "$_rt_awk_rc"
}

# rt_report_refusal [label]: after rt_text_clean failed, print the one stderr
# token every resolve script uses for refused text, so a caller can tell it
# from a usage error that also exits 2. It names the rule and the line,
# never the text. A scan that did not run reports `scan failed`.
rt_report_refusal() {
    if [ -n "${RT_HIT_RULE:-}" ]; then
        printf 'resolve-text: refused rule=%s line=%s%s\n' "$RT_HIT_RULE" "$RT_HIT_LINE" "${1:+ in=$1}" >&2
    else
        printf 'resolve-text: scan failed%s\n' "${1:+ in=$1}" >&2
    fi
}
