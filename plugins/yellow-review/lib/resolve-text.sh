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
# Authorization/Bearer, NAME_KEY=value, DEVIN_ORG_ID=value) and fails closed. When a vendor
# prefix is added to one scanner, check the other.
# shellcheck shell=sh
# _rt_awk: awk through yr_awk (lib/resolve-paths.sh) when the caller loaded it,
# so a PATH directory holding a symlink into the worktree cannot supply awk;
# plain awk for the scripts that do not source resolve-paths.sh.
_rt_awk() {
    if command -v yr_awk >/dev/null 2>&1; then
        yr_awk "$@"
    else
        awk "$@"
    fi
}

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
    _rt_out=$(_rt_awk -v strict="$1" '
        # flag(rule): the first hit wins; END reports its rule and line,
        # never the matched text.
        # An optional line names the line a multi-line value started on.
        function flag(rule, line) {
            if (!hit) { hit = 1; hitrule = rule; hitline = line ? line : NR }
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
        # qlen(rest, q): length of the quoted content at the start of rest
        # (the text after an opening quote q), up to the first unescaped
        # closing q or the end of the line. An unterminated quote is read to
        # the end of the line, so it never hides a value.
        function qlen(rest, q) {
            if (q == "\"") match(rest, /^([^"\\]|\\.)*/)
            else match(rest, /^([^\047\\]|\\.)*/)
            return RLENGTH
        }
        # qcred(v): 1 when the WHOLE quoted value v looks like a literal
        # credential, however it splits on whitespace: 4+ characters and not a
        # whole placeholder (`$NAME`, `<...>`, `[REDACTED]`) or placeholder
        # words (`string`, `optional string`). `"ab cd efgh ijkl"` is a hit;
        # `"string"` is a type annotation. minlen (default 4) is the shortest
        # value judged; a quote that never closes passes 1, so only a
        # placeholder (or nothing) is clean.
        function qcred(v, minlen,    np, parts, j, allph) {
            sub(/^[ \t]+/, "", v)
            sub(/[ \t]+$/, "", v)
            if (length(v) < (minlen ? minlen : 4) || isplaceholder(v)) return 0
            np = split(v, parts, /[ \t]+/)
            allph = 1
            for (j = 1; j <= np; j++) if (index(ph, " " parts[j] " ") == 0) allph = 0
            return !allph
        }
        # benignword(w): 1 when one word of an unquoted value is a placeholder,
        # type word, bare punctuation (`=`, `|`), a call or a generic type, so
        # `password: str = None` and `password: optional string` stay clean.
        # ident(s): 1 when s is built only from identifier humps (an optional
        # capital plus 2+ lowercase letters), runs of capitals (an acronym) and
        # digit runs, e.g. `ReviewFindingsHelper2` or `HTTPServerHandler3`.
        # Random key material breaks that within a few characters.
        function ident(s) {
            return s ~ /^([A-Z]?[a-z][a-z]+|[A-Z][A-Z]+|[0-9]+)+$/
        }
        function benignword(w) {
            sub(/[.,;:!?)]+$/, "", w)
            if (w == "" || w !~ /[a-z0-9]/ || isplaceholder(w)) return 1
            if (index(ph, " " w " ") > 0) return 1
            if (w ~ /^[a-z_][a-z0-9_.]*\(([a-z_][a-z0-9_.]*)?$/) return 1
            return w ~ /^[a-z_][a-z0-9_.]*[<\[][a-z_][a-z_.|<\[]*[>\]]*$/
        }
        # wordcred(v): 1 when the WHOLE unquoted value v of an assignment that
        # starts the line (`password: my correct horse`) looks like a literal
        # credential, however it splits on whitespace: several words, 4+
        # characters in total, not a whole placeholder and not only
        # placeholder/type words. The per-token rule in litval would judge
        # only `my` and let the rest through. A single word is left to litval.
        function wordcred(v,    np, parts, j) {
            sub(/(^|[ \t]+)#.*$/, "", v)
            sub(/[ \t]+$/, "", v)
            if (v !~ /[ \t]/ || length(v) < 4 || isplaceholder(v)) return 0
            np = split(v, parts, /[ \t]+/)
            for (j = 1; j <= np; j++) if (!benignword(parts[j])) return 1
            return 0
        }
        # Multi-line quoted value. A credential keyword whose value opens a
        # quote that does not close on its line starts a carry (mqo): the
        # following lines are joined with a space until the closing quote,
        # then the joined value is judged like a one-line quoted value. The
        # carry is bounded (20 lines, 2000 characters) so a hostile file stays
        # linear. A quote that never closes (bound or end of file) fails
        # closed: flagged unless the visible text is a placeholder.
        function mqstart(q, v, line) {
            mqo = 1; mqq = q; mqbuf = v; mqn = 1; mqline = line
        }
        function mqend(minlen) {
            if (qcred(mqbuf, minlen)) flag("quoted-keyword-assignment", mqline)
            mqo = 0
            mqbuf = ""
        }
        # Block scalar content (explicit `|` or `>` header). The lines
        # indented more than the header are ONE credential value, judged with
        # the quoted-value rule (qcred) when the block ends or reaches the
        # same bounds as above. Each line is also judged on its own by
        # valueline. An unindented first line is not block content here (it
        # is judged as a single token only), so prose after the header stays
        # clean.
        function blockadd(t) {
            if (bdone) return
            if (bn == 0) bline = NR
            bbuf = bn ? bbuf " " t : t
            if (++bn >= 20 || length(bbuf) > 2000) blockend()
        }
        function blockend() {
            if (bn && !bdone && qcred(bbuf)) flag("unquoted-keyword-value", bline)
            bdone = 1
            bbuf = ""
        }
        # valueline(r, inword, mqok, rraw): evaluate one logical value line
        # (leading list dash, trailing comment and CR already removed,
        # lowercased; rraw is the same line before the comment was removed,
        # because a `#` inside a quoted value is part of it). A quoted value
        # is judged as a whole (qcred), carrying an unclosed quote onto the
        # next lines when mqok; anything else must be a single token (prose
        # after a keyword line stays clean) judged by litval.
        function valueline(r, inword, mqok, rraw, pin,    q, n, seg, v, rr) {
            q = substr(r, 1, 1)
            if (q == "\"" || q == "\047") {
                r = substr(r, 2)
                if (!inword) {
                    rr = substr(rraw, 2)
                    n = qlen(rr, q)
                    v = substr(rr, 1, n)
                    if (substr(rr, n + 1, 1) != q && mqok && !mqo && !hit) mqstart(q, v, NR)
                    else if (qcred(v)) flag("quoted-keyword-assignment")
                    return
                }
            }
            if (match(r, /^[^ \t"\047,;)]+/)) {
                seg = substr(r, RSTART, RLENGTH)
                r = substr(r, RSTART + RLENGTH)
                if (r ~ /^[)"\047]*[ \t\r,;]*$/ && litval(seg, inword, pin)) flag(q == "\"" || q == "\047" ? "quoted-keyword-assignment" : "unquoted-keyword-value")
            }
        }
        BEGIN {
            # The credential labels, once for every rule below: pass,
            # password, passwd, pwd, passphrase, pass_phrase, pass-phrase, passcode,
            # pass_code, pass-code, secret, secret key (secret_key, secret-key,
            # secretKey), private key, access key, token, api key, credential,
            # credentials.
            # `client_secret`, `api_secret` and `clientSecret` are covered by
            # `secret` (the `_`, `-` or capital starts the keyword). Do not add
            # a `client`/`api` prefix here: it would start the match earlier,
            # and `myclient_secret` would then count as in-word.
            kw = "(pass([_-]?(phrase|code)|word|wd)?|pwd|secret([_ \t-]?key)?|(private|access)[_ \t-]?key|token|api[_ \t-]?key|credentials?)"
            ph =" string number integer boolean object array unknown undefined"
            ph = ph " nullable optional required redacted placeholder example"
            ph = ph " secret password passwd token credential credentials apikey"
            ph = ph " masked hidden default missing invalid expired empty bearer"
            ph = ph " options config value values bytes buffer promise function"
            ph = ph " str int bool float"
            ph = ph " or and not the on of any null nil none true false "
        }
        toupper($0) ~ /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/ { flag("private-key") }
        # NAME_KEY=value with a literal-looking value (8+ token characters,
        # so `API_KEY = process.env.API_KEY` in code does not match). The
        # suffix list already covers the uppercase compounds: `SECRET_KEY`,
        # `PRIVATE_KEY` and `ACCESS_KEY` end in `_KEY`, `CLIENT_SECRET` and
        # `API_SECRET` in `_SECRET`.
        !strict && /(^|[^A-Za-z0-9_])[A-Z][A-Z0-9_]*(_KEY|_TOKEN|_SECRET|_PASSWORD|_PASS_?PHRASE|_PASS_?CODE)[ \t]*[=:][ \t]*["\047]?[A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-]/ { flag("name-key-assignment") }
        # DEVIN_ORG_ID=value, same literal-looking rule. AGENTS.md prohibits
        # committing that exact name; `_ID` names in general (USER_ID=12345678)
        # are ordinary code, so no `_ID` suffix rule (the log redactor in
        # lib/verify-run.sh blanks every `_ID`, but it redacts, this refuses).
        !strict && /(^|[^A-Za-z0-9_])DEVIN_ORG_ID[ \t]*[=:][ \t]*["\047]?[A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-][A-Za-z0-9+\/_=-]/ { flag("name-key-assignment") }
        {
            # A CRLF file leaves \r on the token, which would hide an
            # all-letter literal from the value rules below.
            sub(/\r$/, "")
            l = tolower($0)
            # An open multi-line quote (see mqstart) takes this line first:
            # join it, and judge the whole value once the quote closes. The
            # line is still scanned by every rule below.
            if (mqo) {
                t = l
                sub(/^[ \t]+/, "", t)
                n = qlen(t, mqq)
                if (substr(t, n + 1, 1) == mqq) {
                    mqbuf = mqbuf " " substr(t, 1, n)
                    mqend(4)
                } else {
                    mqbuf = mqbuf " " t
                    if (++mqn >= 20 || length(mqbuf) > 2000) mqend(1)
                }
            }
            # Each loop below copies the rest of the line per match, which is
            # quadratic on a huge hostile line. Cap the matches per loop and
            # refuse past the cap (truncating would fail open).
            nq = nu = nurl = nauth = 0
            # keyword = "quoted value": the whole quoted string is judged
            # (qcred), not its first whitespace-delimited segment, so a spaced
            # passphrase is a hit and a type annotation such as `token:
            # "string"` is not. The keyword must start a word, as in the
            # unquoted branch below: `bypass="false"` is not a `pass`
            # keyword, but camelCase `userPassword="..."` is.
            r = strict ? "" : l
            base = 0
            while (match(r, kw "[\"\047]?[ \t]*[=:][ \t]*[\"\047]")) {
                start = base + RSTART
                q = substr(r, RSTART + RLENGTH - 1, 1)
                base += RSTART + RLENGTH - 1
                if (++nq > 200) { flag("too-many-matches"); break }
                r = substr(r, RSTART + RLENGTH)
                n = qlen(r, q)
                v = substr(r, 1, n)
                closed = (substr(r, n + 1, 1) == q)
                base += n
                r = substr(r, n + 1)
                if (start > 1 && substr($0, start - 1, 1) ~ /[A-Za-z]/ && substr($0, start, 1) !~ /[A-Z]/) continue
                # A quote left open at the end of the line carries onto the
                # next lines (see mqstart); inside an open one the text is
                # already part of the joined value.
                if (!closed && !mqo && !hit) mqstart(q, v, NR)
                else if (qcred(v)) flag("quoted-keyword-assignment")
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
            while (match(r, kw "[ \t]*[=:][ \t]*[^ \t\"\047,;)]+")) {
                seg = substr(r, RSTART, RLENGTH)
                val = substr(r, RSTART)
                start = base + RSTART
                base += RSTART + RLENGTH - 1
                if (++nu > 200) { flag("too-many-matches"); break }
                r = substr(r, RSTART + RLENGTH)
                inword = (start > 1 && substr($0, start - 1, 1) ~ /[A-Za-z]/ && substr($0, start, 1) !~ /[A-Z]/)
                pin = seg
                sub(/[ \t]*[=:].*$/, "", pin)
                pin = (pin ~ /pass[_-]?code$/)
                sub(/^[^=:]*[=:][ \t]*/, "", seg)
                sub(/^[^=:]*[=:][ \t]*/, "", val)
                if (litval(seg, inword, pin)) flag("unquoted-keyword-value")
                # A keyword that starts the line (indentation, list dashes,
                # `export`, a quote and a key-name prefix such as `db_` may
                # precede it) is an assignment: judge the whole value, not
                # its first word. Mid-sentence prose keeps the token rule.
                else if (!inword && substr(l, 1, start - 1) ~ /^[ \t]*(-[ \t]*)*(export[ \t]+)?["\047]?[a-z0-9_.-]*$/ && wordcred(val)) flag("unquoted-keyword-value")
            }
            # Logical records. A keyword alone on its line (`password:`, YAML
            # style) is a header whose value is on the following lines. The
            # header is read with its trailing YAML comment (whitespace, then
            # `#`) removed; a `#` inside a token is part of the token. Blank
            # lines never use up a record.
            #   plain (carry 1): only the next non-blank line is the value,
            #     and only a single token counts, so prose after a keyword
            #     line stays clean. A comment-only line before it is skipped.
            #   block (carry 2): a YAML block scalar header (`password: |`,
            #     `>-`, `|2`, optionally with a comment, or `password:` then a
            #     line that is only the indicator). EVERY following non-blank
            #     line indented more than the header is a value line,
            #     evaluated the same way. The block ends at the first
            #     non-blank line indented the same or less; the first line
            #     after the header is always evaluated, indented or not, so
            #     a pasted scalar that lost its indentation is still checked
            #     as a single token. The lines indented more than the header
            #     are also judged together as one value (blockadd).
            if (carry && $0 !~ /^[ \t]*$/) {
                ind = match($0, /^[ \t]*/) ? RLENGTH : 0
                if (carry == 1 && $0 ~ /^[ \t]*[|>][-+0-9]*([ \t]+#.*)?[ \t]*$/) {
                    carry = 2
                    bfirst = 1
                    bn = 0; bbuf = ""; bdone = 0
                } else if (carry == 1 && $0 ~ /^[ \t]*#/) {
                    # comment between the header and its value: keep waiting
                } else if (carry == 2 && !bfirst && ind <= hind) {
                    blockend()
                    carry = 0
                } else {
                    r = l
                    sub(/^[ \t]*(-[ \t]*)?/, "", r)
                    rraw = r
                    sub(/[ \t]+#.*$/, "", r)
                    valueline(r, carryin, carry == 1, rraw, carrypin)
                    # A plain-carry value line of 3+ unquoted words that does
                    # not start with a capital (`password:` then `my correct
                    # horse battery staple`) is judged whole, like a same-line
                    # assignment (wordcred). Sentence-case prose
                    # (`Rotation is scheduled for Friday`) and a two-word
                    # line stay clean; a capitalised passphrase of 3+ words
                    # is the accepted residual.
                    if (carry == 1 && !carryin && !hit) {
                        o = $0
                        sub(/^[ \t]*(-[ \t]*)?/, "", o)
                        if (substr(o, 1, 1) !~ /["\047A-Z]/ && split(r, wparts, /[ \t]+/) >= 3 && wordcred(r)) flag("unquoted-keyword-value")
                    }
                    if (carry == 2 && !carryin && ind > hind) {
                        t = l
                        sub(/^[ \t]+/, "", t)
                        blockadd(t)
                    }
                    if (carry == 1) carry = 0
                    bfirst = 0
                }
            }
            lh = l
            sub(/[ \t]+#.*$/, "", lh)
            if (carry != 2 && match(lh, kw "[\"\047]?[ \t]*[=:][ \t]*([|>][-+0-9]*)?[ \t]*$")) {
                kstart = RSTART
                pre = substr($0, 1, kstart - 1)
                if (pre ~ /^[ \t]*(-[ \t]*)?["\047]?[A-Za-z0-9_.-]*$/) {
                    carry = (substr(lh, kstart, RLENGTH) ~ /[=:][ \t]*[|>][-+0-9]*[ \t]*$/) ? 2 : 1
                    bfirst = 1
                    bn = 0; bbuf = ""; bdone = 0
                    carryin = (kstart > 1 && substr($0, kstart - 1, 1) ~ /[A-Za-z]/ && substr($0, kstart, 1) !~ /[A-Z]/)
                    carrypin = (substr(lh, kstart, RLENGTH) ~ /^pass[_-]?code/)
                    hind = match($0, /^[ \t]*/) ? RLENGTH : 0
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
                    if (v ~ /^glpat-/ && mv >= 26) flag("token-prefix")
                    # hooks.slack.com/services/T<id>/B<id>/<secret>: the dot
                    # splits the host off, and the slashes would otherwise earn
                    # the path exemption below.
                    if (v ~ /^com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]/) flag("token-prefix")
                }
                # A long mixed-case token with a digit looks like a key, but
                # URLs, file paths and camelCase identifiers are too and are
                # routine in replies.
                # Exempt a path-shaped token: 2+ slashes, no base64 `+` or
                # `=`, and every segment either short, hyphen-separated words,
                # an identifier (`ident`) or a 40-hex commit SHA. A segment of
                # 20+ characters with all three character classes that is none
                # of those is token-shaped, so the whole token is judged, not
                # exempted on the shape of its harmless segments. This is an
                # allowlist of shapes, not a proof: a secret that happens to
                # look like an identifier or a short segment passes.
                # Exempt an identifier-shaped token: letters only in humps of
                # an optional capital plus 2+ lowercase letters, and digit
                # runs (`ReviewFindingsHelper2`). Random key material breaks
                # that within a few characters. A token over 256 characters is
                # never exempt, which keeps the match bounded.
                if (m >= 32 && w ~ /[a-z]/ && w ~ /[A-Z]/ && w ~ /[0-9]/) {
                    exempt = 0
                    if (w !~ /[+=]/) {
                        ns = split(w, segs, "/")
                        if (ns >= 3) {
                            exempt = 1
                            for (j = 1; j <= ns; j++) {
                                sg = segs[j]
                                if (length(sg) == 40 && sg ~ /^[0-9a-f]+$/) continue
                                if (length(sg) > 24 && sg !~ /-/ && !ident(sg)) exempt = 0
                                else if (length(sg) >= 20 && sg !~ /-/ && sg ~ /[a-z]/ && sg ~ /[A-Z]/ && sg ~ /[0-9]/ && !ident(sg)) exempt = 0
                            }
                        }
                    }
                    if (m <= 256 && w ~ /^([A-Z]?[a-z][a-z]+|[0-9]+)+$/) exempt = 1
                    if (!exempt) flag("long-token")
                }
            }
        }
        # End of file: a block scalar or a quote still open is judged as is.
        END {
            if (carry == 2) blockend()
            if (mqo) mqend(1)
            if (hit) print hitrule, hitline
            exit hit ? 0 : 1
        }
    ' < "$2") || _rt_awk_rc=$?
    if [ "$_rt_awk_rc" -eq 0 ]; then
        RT_HIT_RULE=${_rt_out%% *}
        RT_HIT_LINE=${_rt_out##* }
    fi
    return "$_rt_awk_rc"
}

# rt_report_refusal [label]: after rt_text_clean (or rt_code_clean) returned
# non-zero, print the one stderr
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

# rt_code_clean [--strict] <file>: the credential rules alone, for code, diffs
# and logs, where an @, a URL or an image is ordinary. Exit 0 only when the scan
# ran and found no credential shape; 1 for a credential shape; 2 when the scan
# did not run (unreadable file, awk missing or erroring). --strict applies only
# the high-precision rules (private key blocks, known token prefixes, long
# mixed-case tokens), so a variable merely assigned to a name such as password
# or token does not match. On status 1, RT_HIT_RULE and RT_HIT_LINE name the
# rule and line that matched; both are empty otherwise.
# The status is captured explicitly, so a bare call under `set -e` returns it.
rt_code_clean() {
    _rt_strict=0
    if [ "${1:-}" = --strict ]; then _rt_strict=1; shift; fi
    _rt_rc=0
    _rt_scan "$_rt_strict" "$1" || _rt_rc=$?
    case "$_rt_rc" in
        0) return 1 ;;
        1) return 0 ;;
        *) return 2 ;;
    esac
}

# rt_text_clean <file>: exit 0 only when the scan ran and found nothing to
# refuse. Status 1 means the text has a credential shape or a shape unsafe to
# post publicly (markdown image, @mention, foreign URL); status 2 means the
# scan did not run. A caller that refuses on non-zero fails closed instead of
# posting unscanned text. On status 1, RT_HIT_RULE and RT_HIT_LINE name the rule
# and line that matched (see rt_report_refusal); both are empty otherwise.
# RT_ALLOWED_HOST (default GH_HOST, else github.com) is the one host a URL in
# the text may name. For code and logs use rt_code_clean.
rt_text_clean() {
    rt_code_clean "$1" || return $?
    # No credential shape. The text is also posted publicly under the user's
    # account, so refuse the shapes that notify people or load remote content.
    _rt_awk_rc=0
    _rt_out=$(_rt_awk -v host="${RT_ALLOWED_HOST:-${GH_HOST:-github.com}}" '
        function flag(rule) { if (!hit) { hit = 1; hitrule = rule; hitline = NR } }
        # relfix(s, re): re matches text ending in `//X`; rewrite each match
        # to end in `https://X` (X is kept).
        function relfix(s, re,    out) {
            out = ""
            while (match(s, re)) {
                out = out substr(s, 1, RSTART + RLENGTH - 4) "https://" substr(s, RSTART + RLENGTH - 1, 1)
                s = substr(s, RSTART + RLENGTH)
            }
            return out s
        }
        /!\[/{ flag("markdown-image") }
        {
            # A mention is @name at the start of a line or after whitespace or
            # an opening bracket or quote, optionally behind Markdown opening
            # delimiters (`**@name**`, `_@name_`, `[@name]`): where GitHub
            # notifies. Not the @ of URL userinfo, an email address or a code
            # span.
            if ((" " $0) ~ /([[:space:]]|[(,;"\047])[][*_~]*@[A-Za-z0-9]/) flag("mention")
            l = tolower($0)
            h = tolower(host)
            # A protocol-relative destination (`](//host/x)`, `<//host>`,
            # `href="//host"`) renders as an external link: judge it as https.
            gsub(/\]\(\/\//, "](https://", l)
            gsub(/<\/\//, "<https://", l)
            # Attribute forms: quoted with optional spaces around `=`
            # (`href = "//host"`), unquoted (`href=//host`), and unquoted with
            # spaces after a URL attribute name (`href = //host`). A bare
            # `x = // note` or `a//b` is a code comment or text, not a link.
            gsub(/=[ \t]*["\047]\/\//, "=\"https://", l)
            l = relfix(l, "=//[^ \t/]")
            l = relfix(l, "(href|src|action|data|poster|cite|formaction|srcset)[ \t]*=[ \t]+//[^ \t/]")
            while (match(l, /https?:\/\/[^\/ \t"\047`]*/)) {
                u = substr(l, RSTART, RLENGTH)
                l = substr(l, RSTART + RLENGTH)
                sub(/^https?:\/\//, "", u)
                # A backslash ends the host for URL parsers (`evil.com\@github.com`
                # is evil.com), so refuse it before userinfo is stripped.
                if (index(u, "\\")) flag("foreign-url")
                # `?` and `#` end the authority too (`evil.com?x=@github.com`
                # is evil.com), so cut there before userinfo is stripped.
                sub(/[?#].*$/, "", u)
                sub(/^[^@]*@/, "", u)
                sub(/[])>.,;:!?*]+$/, "", u)
                sub(/:[0-9]+$/, "", u)
                if (u != h) flag("foreign-url")
            }
        }
        END {
            if (hit) print hitrule, hitline
            exit hit ? 0 : 1
        }
    ' < "$1") || _rt_awk_rc=$?
    case "$_rt_awk_rc" in
        0)
            RT_HIT_RULE=${_rt_out%% *}
            RT_HIT_LINE=${_rt_out##* }
            return 1
            ;;
        1) return 0 ;;
        *) return 2 ;;
    esac
}

# rt_added_lines: read a unified diff on stdin, print its added lines without
# the leading "+". Only lines inside hunks count (a file header is skipped by
# position, so an added "++ x" line is still printed). Feed the output to
# rt_code_clean.
rt_added_lines() {
    _rt_awk '/^diff --git / { h = 0; next } /^@@/ { h = 1; next } h && /^\+/ { print substr($0, 2) }'
}
