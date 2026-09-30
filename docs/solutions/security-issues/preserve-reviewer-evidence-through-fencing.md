---
title: 'Preserve Byte-Exact Reviewer Evidence Through Fencing'
date: 2026-09-30
category: security-issues
track: knowledge
problem: Council synthesis corrupted or dropped reviewer evidence when fencing escaped content, the orchestrator retyped it, or unreadable text failed silently.
tags: [fence, escaping, evidence, synthesis, council, silent-failure]
components: [yellow-council]
---

# Preserve Byte-Exact Reviewer Evidence Through Fencing

## Context

Council synthesis fences reviewer output as untrusted content before the
orchestrator reasons over it. PR #948 review found that the fencing path
itself could alter or lose the evidence it was protecting. The delimiter
escape basics live in
`docs/solutions/security-issues/prompt-injection-fence-delimiter-escape.md`;
this doc covers fidelity failures around that mechanism.

## Guidance

### 1. Escape delimiters by prefix only

When reviewer text contains a line that looks like a fence delimiter, prefix
it (for example with a zero-impact marker) and leave every other byte
untouched. Do not rewrite, collapse, or re-wrap the content. A prefix is
reversible and auditable; rewriting is neither.

### 2. Never retype reviewer text through Write

An orchestrator that copies reviewer text into a new file via the Write tool
re-generates it token by token. Whitespace, long lines, and code snippets
drift, and injected text can be silently "corrected". Read the
script-redacted, already-fenced file from disk and cite it in place. The
script is the only component allowed to transform reviewer bytes.

### 3. Unreadable reviewer text must warn and emit an unavailable marker

If a reviewer's fenced file is missing, empty, or unreadable, print a
warning and emit an explicit marker such as
`[reviewer <name>: output unavailable]` in the synthesis input. Never skip
the reviewer quietly: a synthesis over fewer voices than the roster claims
reads as unanimous agreement.

### 4. Track backtick and fence run lengths in normalizers

A normalizer that closes a fence on any run of three backticks breaks when
reviewer content contains four-backtick or longer runs, or a shorter run
inside a longer fence. Record the opening run length and close only on a run
of at least that length. Test with nested fences in fixtures.

### 5. Persist intermediate results for inline passes

An orchestrator cannot observe its own usage or context limit. If the
inline (in-process) reviewer pass is interrupted, everything held only in
the orchestrator's context is lost. Write each intermediate result to the
run directory as soon as it exists, so a resumed or follow-up pass can read
it.

## Why This Matters

The synthesis verdict is only as trustworthy as the evidence it cites. Each
failure above is silent: the output still looks well formed while quoting
altered text, omitting a dissenting reviewer, or mis-parsing a fence. That
is a prompt-injection and an integrity risk at once.

## When to Apply

- Any pipeline that fences untrusted multi-source text and later summarizes
  or scores it.
- Any normalizer or redaction script that parses Markdown fences.
- Any orchestrator step tempted to "clean up" or re-save agent output.

## Examples

Unavailable marker instead of a silent skip:

```bash
if [ ! -r "$fenced" ] || [ ! -s "$fenced" ]; then
  printf '[council] warning: %s output unreadable\n' "$name" >&2
  printf '[reviewer %s: output unavailable]\n' "$name"
fi
```

Related: `docs/solutions/code-quality/llm-as-judge-style-bias-dominance.md`
(the synthesis bias this change mitigates) and
`docs/solutions/code-quality/fence-output-cap-and-untested-orchestration.md`
(the output-cap and testing side).
