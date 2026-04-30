---
"yellow-core": patch
"yellow-review": patch
---

Fix `learnings-researcher` empty-result sentinel violation +
defense-in-depth on the keystone check

The `learnings-researcher` agent's empty-result protocol requires
`NO_PRIOR_LEARNINGS` to be the **first non-whitespace line** of the
response. In practice the agent was emitting a "thinking out loud"
scan-summary paragraph before the sentinel — flipping the keystone's
Step 3d.4 strict-equality check from "empty → skip injection" to
"non-empty → inject as learnings", which delivered useless prose to
all 4–9 dispatched reviewers per `/review:pr` invocation.

Two-sided fix:

1. **`plugins/yellow-core/agents/research/learnings-researcher.md`** —
   tighten the empty-result protocol with explicit anti-pattern
   guidance (forbidden prose-before-token, no thinking-out-loud, no
   closing remarks) and a self-check checklist before emission. The
   agent-side contract is unchanged (token must still be first
   non-whitespace line); the spec just makes the LLM-compliance bar
   harder to miss.

2. **`plugins/yellow-review/commands/review/review-pr.md`** Step 3d.4
   — replace the strict "first non-whitespace line equals literal
   token" check with two-condition empty-result detection:
   - **(a)** the token appears on its own line anywhere in the
     response (regex `(?m)^\s*NO_PRIOR_LEARNINGS\s*$`), AND
   - **(b)** the response does NOT contain a `## Past Learnings`
     heading (regex `(?m)^##\s+Past\s+Learnings\s*$`).

   When both hold → skip injection (the original fix intent —
   tolerate LLM thinking-out-loud preamble before the sentinel).
   When only (a) holds (token + findings heading both present) →
   contract violation; log a warning, strip the sentinel line, and
   treat the response as non-empty so findings are not silently
   dropped. The `## Past Learnings` heading dominance ensures the
   relaxation never masks the "combined sentinel with findings"
   anti-pattern the agent body forbids.

Together the two changes mean Wave 3 PR reviews will get clean
empty-result handling immediately, with a robust safety net that
preserves findings even when an agent-side regression combines the
sentinel with real findings.
