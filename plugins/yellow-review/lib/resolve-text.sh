# shell-compat: library
# Shared by reply-pr-thread, file-followup-issue, check-resolve-text and
# commit-resolve-fixes (POSIX sh; sourced).
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

# _rt_scan <strict> <file>: exit 0 when the file contains a credential shape.
# strict=0 applies every rule; strict=1 only the high-precision ones (private
# key blocks, known token prefixes, long mixed-case tokens), so code that
# merely assigns to a variable named password or token does not match.
# 1 means clean, anything else means the scan itself failed. On a hit,
# RT_HIT_RULE and RT_HIT_LINE name the rule and line that matched (see
# rt_report_refusal). A missing or unreadable file returns 2: the failed
# `< "$2"` redirect below would otherwise leave status 1, which reads as clean.
_rt_scan() {
    RT_HIT_RULE=""
    RT_HIT_LINE=""
    [ -f "$2" ] && [ -r "$2" ] || return 2
    _rt_awk_rc=0
    _rt_out=$(awk -v strict="$1" '
        # flag(rule): the first hit wins; END reports its rule and line,
        # never the matched text.
        function flag(rule) {
            if (!hit) { hit = 1; hitrule = rule; hitline = NR }
        }
        # sentinel(inner): 1 when the text inside `<...>` or `[...]` is a known
        # redaction or template form, never arbitrary words. Either every
        # word is a placeholder word (`<password>`, `[REDACTED]`,
        # `[redacted value]`) or it is a template of 2-4 words that opens with
        # your/my/the/a/an, ends in a credential noun and has only placeholder
        # words or access/api/private between (`<your token>`,
        # `<your private key>`). `<correcthorse>`, `[hunter]` and
        # `<your correcthorse token>` are values.
        function sentinel(inner,    np, parts, j, allph) {
            if (inner !~ /^[a-z_ -]+$/) return 0
            np = split(inner, parts, /[_ -]+/)
            if (parts[1] == "") return 0
            allph = 1
            for (j = 1; j <= np; j++) if (index(ph, " " parts[j] " ") == 0) allph = 0
            if (allph) return 1
            if (np < 2 || np > 4 || index(" your my the a an ", " " parts[1] " ") == 0) return 0
            if (index(" key code token password passcode passwd secret credential credentials apikey value id pass passphrase phrase ", " " parts[np] " ") == 0) return 0
            # Words between the opener and the noun must be placeholder words
            # or a known qualifier: `<your correcthorsebattery token>` is a value.
            for (j = 2; j < np; j++) if (index(ph, " " parts[j] " ") == 0 && index(" access api private ", " " parts[j] " ") == 0) return 0
            return 1
        }
        # isplaceholder(seg): 1 when the WHOLE value is placeholder syntax:
        # `$NAME`, `${NAME}`, or a `<...>` / `[...]` wrapping a known sentinel
        # form (see sentinel). A value that merely contains `$`, `<`, `{` or
        # `[` (`hunter$2x`, `p<w>x`, `${NAME:-word}`) is not one, and neither
        # is a bracketed arbitrary word (`<hunter2x>`, `[correcthorse]`); the
        # scan runs on the lowercased line.
        function isplaceholder(seg) {
            if (seg ~ /^\$[a-z_][a-z0-9_]*$/) return 1
            if (seg ~ /^\$\{[a-z_][a-z0-9_]*\}$/) return 1
            if (seg ~ /^<[^<>]*>$/) return sentinel(substr(seg, 2, length(seg) - 2))
            if (seg ~ /^\[[^\[\]]*\]$/) return sentinel(substr(seg, 2, length(seg) - 2))
            return 0
        }
        # litval(seg, inword, pin): 1 when an unquoted keyword value looks like a
        # literal credential. Flag only a plausible one: 6+ characters (4+
        # digits when pin says the label is a passcode), a
        # digit or all letters (minus placeholder words), and not a whole
        # placeholder (`$TOKEN`, `${TOKEN}`, `<your token>`, `[REDACTED]`)
        # or a call (`z.string()`), so `password: string`,
        # `password: z.string()` and `token: $TOKEN` stay clean. A value that
        # only contains `$`, `<`, `{` or `[` is a credential.
        function litval(seg, inword, pin,    np, parts, allph, j, core, pc) {
            # Markdown inline-code backticks delimit the value; they are not
            # part of it (`password: `hunter``, `token: `$TOKEN``).
            sub(/^`+/, "", seg)
            sub(/`+[.!?]*$/, "", seg)
            sub(/[.!?]+$/, "", seg)
            # A passcode (`pin` set) is conventionally 4+ digits; other labels
            # keep the 6-character floor so `token: 4096` stays clean.
            if (isplaceholder(seg)) return 0
            # The digits are judged without wrapper punctuation, so
            # `passcode: (1234)` and `passcode: "1234"` count too.
            pc = seg
            sub(/^[!@#%^&*~+=|(\[{<"\047]+/, "", pc)
            sub(/[!@#%^&*~+=|)\]}>"\047]+$/, "", pc)
            if (length(seg) < 6 && !(pin && length(pc) >= 4 && pc ~ /^[0-9]+$/)) return 0
            # A call such as `z.string(`: the value stops at the `)`.
            if (seg ~ /^[a-z_][a-z0-9_.]*\(([a-z_][a-z0-9_.]*)?$/) return 0
            # A generic type annotation such as `Optional[str]` or
            # `Promise<string>`: a letters-only name, one opener, letters
            # only inside, and closers at the very end (the value stops at
            # a comma or space, so the closers may be missing).
            if (seg ~ /^[a-z_][a-z0-9_.]*[<\[][a-z_][a-z_.|<\[]*[>\]]*$/) return 0
            if (seg ~ /[0-9]/) return 1
            # All-letter literal (`password: hunter`): flag unless it is a
            # known type or prose placeholder.
            if (inword) return 0
            if (seg ~ /[$<{\[]/) return 1
            # Wrapper punctuation (`!hunter!`, `(hunter`, `~hunter~`,
            # `**hunter**`) is not part of the letters the rules below
            # test: judge the value without it. A value that is all wrapper
            # or leaves under 6 characters is not judged here.
            core = seg
            sub(/^[!@#%^&*~+=|(]+/, "", core)
            sub(/[!@#%^&*~+=|]+$/, "", core)
            if (length(core) < 6) return 0
            if (core ~ /^[a-z]+$/ && index(ph, " " core " ") == 0) return 1
            # Separated lowercase literal (`password: correct-horse-battery`,
            # `password: hunter@cats`): separators are punctuation that
            # passwords commonly use. Flag unless every part is a
            # placeholder word. A property access on a common config or
            # environment object (`token = process.env.api_key`) is a
            # reference, not a literal.
            if (core ~ /^(process\.env|import\.meta\.env|os\.environ|env|this|self|config|settings|secrets|args|params|props)\./) return 0
            if (core ~ /^[a-z]+([_\/.@+!#%^&*:-][a-z]+)+$/) {
                np = split(core, parts, /[_\/.@+!#%^&*:-]/)
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
        !strict && /(^|[^A-Za-z0-9_])[A-Z][A-Z0-9_]*(_KEY|_TOKEN|_SECRET|_PASSWORD)[ \t]*[=:][ \t]*["\047]?[A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-]/ { flag("name-key-assignment") }
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
            r = strict ? "" : l
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
            # and not a whole placeholder or call (see litval), so
            # `password: string`, `password: z.string()` and `token: $TOKEN`
            # stay clean while `password: hunter$2x` is flagged.
            # For the letter-only branches below the keyword must start a
            # word: `bypass: something` is not a `pass` keyword. A letter
            # before it disqualifies it unless the keyword itself starts with
            # a capital (camelCase `userPassword`). A value with a digit is
            # flagged either way.
            r = strict ? "" : l
            base = 0
            while (match(r, /(pass(word|wd)?|secret|token|api[_ \t-]?key|credential)[ \t]*[=:][ \t]*[^ \t"\047,;)]+/)) {
                seg = substr(r, RSTART, RLENGTH)
                start = base + RSTART
                base += RSTART + RLENGTH - 1
                if (++nu > 200) { flag("too-many-matches"); break }
                r = substr(r, RSTART + RLENGTH)
                inword = (start > 1 && substr($0, start - 1, 1) ~ /[A-Za-z]/ && substr($0, start, 1) !~ /[A-Z]/)
                pin = seg
                sub(/[ \t]*[=:].*$/, "", pin)
                pin = (pin ~ /pass[_-]?code$/)
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
            # password that is wholly a placeholder or variable stays clean.
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
                # `$`, `<`, `{` and `[` exempt only a whole `$NAME`, `${NAME}`,
                # `<...>` or `[word]` password, never one that contains them.
                if (isplaceholder(seg) || index(ph, " " seg " ") > 0) continue
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
                    if (v ~ /^(AKIA|ASIA)[0-9A-Z]/ && mv >= 20) flag("token-prefix")
                    if (v ~ /^glpat-/ && mv >= 26) flag("token-prefix")
                    if (v ~ /^AIza[0-9A-Za-z_-]/ && mv >= 39) flag("token-prefix")
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
    ' < "$2") || _rt_awk_rc=$?
    if [ "$_rt_awk_rc" -eq 0 ]; then
        RT_HIT_RULE=${_rt_out%% *}
        RT_HIT_LINE=${_rt_out##* }
    fi
    return "$_rt_awk_rc"
}

# rt_report_refusal [label]: after rt_text_clean returned non-zero, print the one stderr
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

# rt_looks_secret <file>: all rules. For text posted publicly (replies,
# follow-up issues, check-resolve-text) and for the commit credential gate.
# Exit status is awk's: 0 means a credential shape, 1 means clean, anything
# else means the scan itself failed. Prefer rt_text_clean when posting text.
# On a hit, RT_HIT_RULE and RT_HIT_LINE name the rule and line that matched.
rt_looks_secret() { _rt_scan 0 "$1"; }

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

# rt_looks_secret_strict <file>: high-precision rules only. For screening
# code diffs, where the keyword rules flag ordinary assignments.
rt_looks_secret_strict() { _rt_scan 1 "$1"; }

# rt_added_lines: read a unified diff on stdin, print its added lines without
# the leading "+". Only lines inside hunks count (a file header is skipped by
# position, so an added "++ x" line is still printed). Feed the output to
# rt_looks_secret.
rt_added_lines() {
    awk '/^diff --git / { h = 0; next } /^@@/ { h = 1; next } h && /^\+/ { print substr($0, 2) }'
}
