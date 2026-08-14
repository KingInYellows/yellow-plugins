---
"yellow-council": patch
---

Fix a PEM private-key redaction bypass in `gemini-reviewer` and
`opencode-reviewer`. Both matched the BEGIN/END markers with a fully
anchored pattern (`^-----BEGIN [A-Z ]+PRIVATE KEY-----[[:space:]]*$`),
which diverged from the canonical unanchored form documented in
`council-patterns` SKILL.md. Two shapes leaked through as a result: a key
flattened onto one line or quoted inline in prose never matched the
anchor, and `[A-Z ]+` failed to match the bare PKCS#8 header
`-----BEGIN PRIVATE KEY-----` (no algorithm word) even in the multi-line
case. Both now use the canonical `-----BEGIN [A-Z ]*PRIVATE KEY-----`
substring match, so reviewer output containing key material is redacted
before it reaches the council report.

Unanchoring BEGIN also means it matches prose that merely quotes the
marker, and such a line has no matching END — which would have pinned the
redaction state on to EOF and replaced the entire remaining report with
placeholders. The state machine is now span-bounded: PEM armor is base64
plus the `Proc-Type`/`DEK-Info` headers, so it counts consecutive lines
that cannot be key material and leaves PEM mode after three of them. A
real key block stays fully redacted (its body is base64 throughout, even
when truncated with no END marker), while a stray prose mention now costs
four redacted lines instead of the reviewer's whole verdict. Blockquote
and list decoration is stripped before that body test, so a reviewer that
renders a key inside `> `, `1. `, or a diff `-`/`+` prefix does not fall out
of redaction mode partway through the key. Blank lines are neutral for that
counter — treating them as valid key body would reset it at every paragraph
gap in prose, defeating the bound.
