---
title: 'Credential-scan grep exemptions can bypass real secrets in CI'
date: 2026-07-17
category: security-issues
track: bug
problem: 'Over-broad ${...} and keyword-suffix grep exemptions in the CI secret scan let literal-default and keyword-prefixed secrets slip past undetected'
tags: [secret-scanning, ci, grep, credential-exemption, false-negative, defense-in-depth]
components: ['.github/workflows/validate-schemas.yml']
---

# Credential-scan grep exemptions can bypass real secrets in CI

## Problem

`.github/workflows/validate-schemas.yml` runs a grep-based secret scan with
hand-written `grep -v` exemption patterns meant to suppress false positives
(env-var references, known non-secret identifiers) without missing real
secrets. Two independent bypass classes surfaced during PR #644 review.

## Symptoms

**(a) Parameter-expansion default bypass.** The exemption
`grep -vE '\$\{[A-Za-z_]'` was meant to skip lines that merely *reference* an
env var (`${GH_TOKEN}`), but the regex matches ANY line containing `${...}`
— including a bash parameter-expansion **default value** that embeds a
literal secret:

```bash
TOKEN="${GH_TOKEN:-ghp_xxxxxxxxxxxxxxxxxxxx}"   # matched by the same exemption, silently skipped
```

**(b) Keyword-in-value bypass.** A second exemption — a word-continuation
filter `grep -viE '(keyword)[A-Za-z]'` added to stop flagging identifiers
that merely *contain* a sensitive keyword as a prefix (e.g.
`TOKENIZERS_PARALLELISM` containing `token`) — also drops any line whose
secret **value** happens to start with that keyword:

```json
{"api_key": "tokenABC123..."}
```

A single-line grep cannot distinguish "keyword appears in the identifier/key
position" (safe to exempt) from "keyword appears as a prefix of the secret
**value**" (must flag) — both look identical to a line-oriented regex.

## What Didn't Work

Treating "the exemption looks scoped to identifier shape" as sufficient
justification without a planted-secret regression test. Both exemptions
were "obviously correct" on inspection and still had a bypass — the gap
only surfaces when checked against a case with the specific structure
(parameter-expansion syntax; a value that happens to look like a key).

## Solution

**(a) — fixed.** Tightened the exemption to match only the three *safe*
expansion forms — no-default (`${VAR}`), empty-default (`${VAR:-}`), and
variable-reference-default (`${VAR:-$OTHER}`) — explicitly excluding any
literal-string default. Validated empirically against the full current tree
(0 new false positives) plus a planted-secret regression case
(`${GH_TOKEN:-ghp_...}` is now correctly flagged).

**(b) — deferred, not fixed.** A precise fix requires JSON/structure-aware
parsing to distinguish key position from value position, which is out of
scope for a line-oriented grep scanner. Accepted as a known, documented
defense-in-depth gap rather than solved: this scanner is one layer, not the
sole gate, so an occasional keyword-prefixed value slipping past a
line-grep is a deliberate tradeoff, not an oversight.

## Why This Works

(a) demonstrates that a grep-based secret-scan exemption must be validated
against both false-positive *and* false-negative cases before merging — an
exemption that reads as "obviously" scoped to identifier shape can still
match unintended lines once the input has embedded structure (parameter
expansion syntax) the author didn't consider when writing the regex.

(b) demonstrates a structural limit of line-based grep scanning: it cannot
see *where* in the line a keyword match occurs, so any keyword-based
exemption is inherently approximate — upgrading it requires structure-aware
(JSON-path) parsing, not a better regex.

## Prevention

- When writing a grep-based exemption for a secret/credential scanner,
  explicitly enumerate the *safe* forms it should match (e.g. `${VAR}`,
  `${VAR:-}`, `${VAR:-$OTHER}`) rather than a loose "starts with `${`"
  pattern — a broad prefix match will swallow secrets embedded as literal
  defaults.
- Test every exemption against both a clean-tree run (0 new false
  positives) and a planted-secret regression fixture (the excluded shape
  must still catch an actual secret written in that same shape).
- Treat keyword-based exemptions targeting identifier *names* as safe only
  when the scanner can be scoped to the key position. A pure line-grep
  cannot make that distinction; document any such exemption as an accepted
  defense-in-depth gap rather than a solved case, unless upgraded to
  structure-aware parsing.
