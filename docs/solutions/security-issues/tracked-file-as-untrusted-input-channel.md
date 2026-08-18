---
title: "Repo-tracked config files are an untrusted-input channel, not just PR comments and API responses"
date: "2026-08-17"
category: "security-issues"
track: knowledge
problem: "A security reviewer cleared a PR because 'no PR titles/branch names/comment bodies are rendered anywhere in this diff,' missing that a repo-tracked, contributor-editable YAML file was interpolated verbatim into command output with no fencing."
tags:
  - untrusted-input
  - security-review-blind-spot
  - prompt-injection
  - tracked-config-file
  - fencing
  - adversarial-review
  - multi-agent-review
components:
  - plugins/yellow-core/lib/stack-provider-state.js
  - plugins/yellow-core/commands/stack/status.md
---

# Repo-tracked config files are an untrusted-input channel, not just PR comments and API responses

## Problem

During the 21-reviewer pass on PR #712 (stacked-PR provider foundation),
`security-reviewer` explicitly concluded the untrusted-input-fencing
requirement did not apply: "no PR titles/branch names/comment bodies are
rendered anywhere in this diff." That conclusion was wrong. A separate
`adversarial` reviewer found that `stack-provider-state.js`'s
`CONFIG_MISMATCH` detail string interpolates the `intent` value parsed out
of a repository's optional `.yellow-stack.yml` file verbatim, and
`status.md:75-76` instructs the caller to print that `detail` string
without fencing. `parseIntent`'s regex admits arbitrary text from the
`intent:` key.

`.yellow-stack.yml` is a file **tracked in the repository** — any
contributor, or anyone who can open a PR against the repo, can edit it. A
security review that scopes "untrusted input" to gh API responses,
external webhooks, or free-text fields like PR titles/comments will clear
this pattern every time, because none of its named channels match "a
YAML file checked into the repo."

## Why this happens

Untrusted-input mental models tend to be built from a list of *examples*
(PR comments, commit messages, API responses) rather than from the
*property* that makes a channel untrusted: **can an actor other than the
current trusted operator control its content before this code runs?**
Repo-tracked files pass that test as long as the repo accepts PRs from
outside contributors, or even from any teammate who isn't the person
running the command right now — the file's content was decided at some
earlier point in time by someone else, and the command trusts it anyway
because "it's in the repo, therefore it's ours."

This is the same class of gap CI-time secret scanners hit when they
allowlist file *locations* instead of checking file *provenance* — see
[[credential-scan-grep-exemption-bypass]] — the fix there was also
"stop trusting membership in a category; check the actual property that
matters."

## The generalized rule

When auditing a codebase for untrusted-input fencing, enumerate channels
by **write access**, not by **example list**:

1. Anything written by a process outside your own command invocation
   (API responses, webhook payloads, subprocess output) — the obvious
   case, already well covered by existing conventions in this repo (see
   `security-fencing` skill).
2. Anything a human typed into a UI surface you don't control (PR
   titles, comments, issue bodies, commit messages) — also well covered.
3. **Anything checked into version control that isn't gated by branch
   protection equal to the branch currently executing.** A repo-tracked
   config file editable by any contributor via a normal PR is
   channel (3) — it is trusted by the codebase's own conventions
   ("it's a file in the repo") but not actually restricted to the same
   trust boundary as the code that reads it.

Channel (3) is easy to miss because the file *looks* like first-party
data (it lives next to source code, has a schema, gets validated) right
up until the specific field being interpolated has no charset
restriction and the display path has no fencing.

## Fix pattern

Two independent, non-exclusive mitigations:

- **Constrain the input at the source.** If `intent:` is meant to be one
  of a small enum (`graphite`, `github`, `unset`), validate against that
  enum at parse time and reject/ignore anything else — do not accept
  arbitrary text into a field destined for verbatim display.
- **Fence at the display site.** If free text from a repo-tracked file
  must be shown to a human or fed to a downstream agent, wrap it in the
  same `--- begin/end ---` "(reference only)" delimiter convention this
  repo already uses for PR comments and API responses (see
  `security-fencing` skill). There is no reason a repo-tracked file gets
  weaker treatment than a PR comment — both are attacker-reachable via
  the same mechanism (open a PR).

## How to apply this during review

When a security-focused reviewer persona concludes "no untrusted input in
this diff," treat that as a claim to verify, not a finding to accept —
specifically check whether the diff reads any repo-tracked,
non-branch-protected file (`.yml`/`.yaml`/`.json`/`.toml` config,
`.env.example`, generated manifests) and interpolates a field from it
into output without fencing or enum-constraint. An `adversarial` or
`silent-failure-hunter` persona is more likely to catch this than a
`security` persona scoped to classic injection categories — run both
when the diff introduces a new repo-tracked config surface.

## References

- PR #712 finding: `plugins/yellow-core/lib/stack-provider-state.js:304`
  (verbatim interpolation), `plugins/yellow-core/commands/stack/status.md:75-76`
  (unfenced print instruction)
- [[credential-scan-grep-exemption-bypass]] — same "category membership
  vs. actual property" gap, in a different subsystem
- `security-fencing` skill (`plugins/yellow-core/skills/security-fencing/`)
  — canonical fencing convention this pattern should reuse
