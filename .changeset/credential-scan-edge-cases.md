---
'yellow-review': patch
'yellow-core': patch
---

Close four credential-scan edge cases. Both screens now judge a Basic payload
folded onto the line after its scheme (`Authorization: Basic` then ` YTpi`) the
same way as a same-line payload: `rt_text_clean` refuses it and
`cs_redact_secrets` redacts it. The resolve-text screen tests known token
prefixes (`tvly-`, `pplx-`, `sgp_` and the rest) on each `/`- or `=`-delimited
segment of a word, so a token inside an allowed URL path is caught. Under
byte-wise awk (mawk, gawk in C) a standalone non-ASCII token with no letter
(an Arabic comma, say) is decoration rather than prose, while Latin-1 letters
such as `µ` and accented capitals such as `Über` are words, as they already
were under a multibyte gawk.
