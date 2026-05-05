---
title: Prompt Injection Fence Escape via Literal Delimiter Match in Reviewer Output
date: 2026-05-04
category: security-issues
track: bug
problem: Per-invocation fence tags like "--- end council-output:gemini ---" can be emitted verbatim by the fenced model, breaking the reference-only advisory boundary
tags: [prompt-injection, fence, delimiter, escape, security, council, nonce, agentic]
components:
  - plugins/yellow-council/skills/council-patterns/SKILL.md
  - plugins/yellow-council/agents/review/gemini-reviewer.md
  - plugins/yellow-council/agents/review/opencode-reviewer.md
---

# Prompt Injection Fence Escape via Literal Delimiter Match in Reviewer Output

## Problem

Yellow-council wraps each reviewer's output in named fence tags before
presenting it to the orchestrator:

```
--- begin council-output:gemini ---
[reviewer output here]
--- end council-output:gemini ---
```

A "treat as reference only" advisory accompanies the fenced section. The
intent is to isolate reviewer output so the orchestrator treats it as
untrusted data, not instructions.

The vulnerability: neither the gemini-reviewer nor the opencode-reviewer
strips or escapes lines in their output that match the fence-close delimiter.
If the reviewed diff, the reviewed codebase, or an adversarial prompt
embedded in those sources causes the reviewer model to emit the literal
string `--- end council-output:gemini ---`, the fence closes prematurely.
Any content the reviewer emits after that line is outside the fenced region
and the reference-only advisory no longer applies to it.

An attacker who can influence the content passed to the reviewer (via a
PR diff, commit message, file content, or issue body) can craft a payload
that escapes the fence and appears to the orchestrator as trusted
orchestrator-level content.

## Why This Matters

The fence is the primary isolation boundary between untrusted reviewer output
and the orchestrator's instruction context. A bypass collapses this boundary:

- Post-escape content appears at the same trust level as orchestrator prose
- The reference-only advisory explicitly does NOT cover post-escape content
- The orchestrator may follow injected instructions (tool calls, file writes,
  git operations) it would have blocked if the content stayed inside the fence
- The attacker does not need code execution — only the ability to influence
  the text of a diff or file that enters the review pipeline

## Key Insight

**Fence tags with static, predictable delimiters are only as strong as the
guarantee that fenced content cannot reproduce the closing delimiter.**

When fenced content is untrusted LLM output (not raw file bytes), that
guarantee does not hold: any model can be prompted to reproduce an exact
string, and adversarial input can steer it to do so.

## Fix Options

Three independently sufficient mitigations, in order of robustness:

### Option A: Per-invocation nonce (recommended)

Generate a random suffix at invocation time and embed it in both the
open and close tags:

```bash
FENCE_NONCE="$(openssl rand -hex 8)"
OPEN_TAG="--- begin council-output:gemini:${FENCE_NONCE} ---"
CLOSE_TAG="--- end council-output:gemini:${FENCE_NONCE} ---"
```

The nonce is not known to the reviewed content at the time it was authored,
so a pre-planted payload cannot predict the closing tag. The orchestrator
receives the nonce and knows which tag to look for.

**Caveat:** This prevents pre-planted attacks but not attacks where the
reviewed content can observe the nonce at review time (e.g., if the diff
includes a script that reads the nonce from the environment). For most PR
review pipelines this is an acceptable residual risk.

### Option B: Post-redaction sweep before fencing

After receiving the reviewer's raw output and before wrapping it in fence
tags, strip or escape any line that matches the closing delimiter pattern:

```bash
# Escape any line that would close the fence prematurely
SAFE_OUTPUT=$(printf '%s\n' "$RAW_OUTPUT" \
  | sed 's/^--- end council-output:/<!-- redacted fence-close: /')
```

Then wrap `$SAFE_OUTPUT` in the fence tags. This is deterministic and does
not require nonces, but requires the orchestration layer to perform the sweep
before fencing — it cannot be delegated to the reviewer itself.

### Option C: Base64-armor the entire fenced section

Encode the reviewer output as base64 before fencing:

```bash
ENCODED=$(printf '%s' "$RAW_OUTPUT" | base64)
printf '--- begin council-output:gemini ---\n%s\n--- end council-output:gemini ---\n' \
  "$ENCODED"
```

The orchestrator decodes before processing. Base64 output contains only
`[A-Za-z0-9+/=\n]` — it structurally cannot contain the fence-close pattern.
The tradeoff: the orchestrator must decode before it can read finding content,
which adds implementation complexity and breaks human readability of logs.

## Severity

P0. Escape from the reference-only safety boundary. The attack surface includes
any PR diff, commit message, or file content that enters the review pipeline.
Exploitable without access to infrastructure — only requires ability to open a
PR or push a commit.

## Detection

```bash
# Check that fence tags include a nonce or that reviewer output is swept
# before fencing — static tags with no sweep are vulnerable
rg 'begin council-output|end council-output' plugins/ --include='*.md' \
  | grep -v 'nonce\|NONCE\|FENCE_NONCE\|base64\|sed.*fence'
```

When reviewing any agent that wraps untrusted LLM output in named delimiters:
1. Confirm the delimiter cannot be reproduced verbatim by the fenced model
2. If the delimiter is static and human-readable: flag as vulnerable to
   pre-plant and require one of the three mitigations above

## Prevention

- [ ] All fence tags that wrap untrusted LLM output include a per-invocation
      nonce OR the output is swept for close-delimiter matches before fencing
- [ ] Fence-close delimiter patterns are not predictable from the reviewed
      content alone (static reviewer names like `:gemini` are predictable)
- [ ] Orchestrators that parse fenced output validate that open and close
      tags are balanced and that no unbalanced close tags appear inside the fence
- [ ] Reviewed content (diffs, file content, issue bodies) is treated as
      fully adversarial — assume it can steer the reviewer to emit any string

## Related Documentation

- `docs/solutions/security-issues/prompt-injection-defense-layering-2026.md`
  — broader model-level vs application-layer defense hierarchy; fence bypass
  is the specific structural failure that application-layer filtering must
  catch before output reaches sensitive sinks
- `docs/solutions/security-issues/heredoc-delimiter-collision.md` — analogous
  pattern in shell: user-supplied content closing a heredoc prematurely
- MEMORY.md: "Prompt injection fencing: Wrap untrusted content in begin/end
  delimiters + treat as reference only advisory" — this doc establishes that
  static fences alone are insufficient; add nonce or sweep
