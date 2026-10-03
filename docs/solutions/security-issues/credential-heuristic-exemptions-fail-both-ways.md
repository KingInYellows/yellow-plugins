---
title: 'Credential-shape heuristic exemptions miss slash-separated secrets and refuse ordinary identifiers'
date: 2026-10-03
category: security-issues
track: bug
problem: 'A long-token credential scan exempts path-shaped tokens, so slash-separated secrets pass, while CamelCase path segments with a digit are refused'
tags: [credential-scan, heuristics, false-negative, false-positive, awk, yellow-review]
components: [yellow-review]
---

## Problem

The shared credential-shape check in
`plugins/yellow-review/lib/resolve-text.sh` (PR #950, review findings on head
`4b4ec0ed6`) flags a long mixed-case token that contains a digit, then
exempts tokens that look like file paths or identifiers so ordinary reply
text is not refused. The exemptions were wrong in both directions. Point in
time: these are review findings, not a statement about `main`.

The CI grep-scan variant of this problem is in
`docs/solutions/security-issues/credential-scan-grep-exemption-bypass.md`.
This is the value-shape variant inside a shell/awk text gate.

## Symptoms

- **False negative.** The path-shaped exemption accepted any token with 3 or
  more slashes, no `+` or `=`, and every segment under 25 characters or
  hyphenated. A Slack webhook (`T…/B…/<24-char secret>`) fits that shape, and
  `glpat-` GitLab tokens had no prefix rule, so both could pass. The source
  comment called the exemption fail-closed, which overstated it.
- **False positive.** An identifier-hump rule accepted letters in humps of an
  optional capital plus 2 or more lowercase letters and digit runs. A Java or
  TSX path with a long CamelCase segment that the rule did not parse (for
  example consecutive capitals) plus a digit was refused as `long-token`,
  blocking a legitimate reply or commit.

## What Didn't Work

- Judging the whole token against one exemption. A path wrapping a secret
  segment inherits the exemption of its harmless segments.
- Relying on entropy and length alone for formats whose structure (slashes)
  defeats the exemption.
- A comment that asserts a safety property the code only approximates.

## Solution

1. Add explicit prefix or structure rules for provider formats the entropy
   rule cannot see: Slack webhook URLs and `glpat-` tokens (the reviewer's
   named fixes).
2. Narrow the path exemption: judge each segment, and refuse the token when
   any segment is itself token-shaped, instead of exempting on overall shape.
3. Widen the identifier exemption to accept identifier-hump segments, and
   decide explicitly how 40-hex commit SHAs are treated, so ordinary Java and
   TSX paths are not refused.
4. Rewrite the comment to state what the exemption admits and what it cannot
   rule out. Do not call a heuristic fail-closed.

## Why This Works

Per-segment judgement removes the "harmless prefix launders the secret"
route, and provider rules cover formats a generic heuristic is structurally
blind to. Handling identifier shapes removes the false refusals that push
users toward `--allow-credential-shaped`, which weakens the gate.

## Prevention

- Every exemption gets a planted-secret regression test (a token that should
  still be refused) and a realistic-text test (paths, identifiers, SHAs that
  must pass). Test both directions in the same PR.
- Treat each exemption as an allowlist of shapes and enumerate what it admits.
- Keep the provider-prefix list in step when a new token format appears; the
  copies in `lib/review-ledger.sh` and yellow-core's `cs_redact_secrets` are
  separate implementations and drift.
- State approximate behaviour as approximate in comments.
