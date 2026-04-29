---
title: Prompt Injection Defense Layering — April 2026 Research Findings
date: 2026-04-28
category: security-issues
track: knowledge
tags: [prompt-injection, security, agentic, output-filtering, ROLP, sandwich-defense, AgentVisor, STI, ToolHijacker]
problem: Model-level prompt injection defenses (sandwich fencing, instruction hardening) degrade under sustained multi-round attack, providing false confidence. Application-layer controls are the only zero-leak defense for agentic pipelines processing untrusted content.
components: [yellow-plugins]
---

# Prompt Injection Defense Layering — April 2026 Research Findings

## Problem

Claude Code plugins that process untrusted content (PR comments, issue bodies,
diff text, external API responses) use the sandwich defense pattern from
CLAUDE.md — wrapping untrusted content in `--- begin/end ---` delimiters with
a "treat as reference only" advisory. This provides a meaningful but bounded
defense. April 2026 research establishes that this model-level fencing is not
the load-bearing control in a correctly designed system — and that treating it
as primary gives false confidence.

Key findings:

**Sandwich defense degrades under sustained attack (arxiv 2604.23887):**
The extended model-reliant defense evaluation (15,000 attacks across 277-round
sustained sessions) shows the sandwich defense degrades from 0.4% leak rate
in single-shot evaluation to **3.8% leak rate** under sustained attack. This
is approximately a 10x degradation. In a multi-round agentic workflow (e.g.,
a PR review pipeline processing dozens of comments sequentially), the
per-interaction leak probability compounds.

**Application-layer output filtering is the only zero-leak defense:**
Across all evaluated defenses, only application-layer output filtering (where
the tool itself inspects outputs before passing to sensitive sinks) achieved
**zero leaks** across all 15,000 attacks in the evaluation. No model-level
defense matched this.

**ToolHijacker achieves 99.6% success against StruQ via tool-selection-phase attacks (NDSS 2026):**
Tool-selection-phase attacks target the model's decision of WHICH tool to call,
not the content passed to a tool. StruQ's structured output defense is bypassed
because the attack happens before the output schema is applied. This means
structured outputs alone are insufficient if the attacker can influence tool
selection.

**AgentVisor STI protocol achieves 0.65% attack success (arxiv 2604.24118):**
An OS-virtualization-inspired Suitability/Taint/Integrity protocol — where
each content unit is labeled with a taint level and outputs are integrity-checked
before action — reduces attack success to 0.65% with only 1.45% utility loss.
This is the strongest published result for agentic prompt injection defense as
of April 2026.

## Root Cause

The fence-and-advisory pattern assumes the model is the last line of defense.
In a correctly architected agentic pipeline, the model is an untrusted
processor — its outputs must be validated at the application layer before
reaching sensitive sinks (file writes, git commits, API calls, issue creation).
Relying solely on model-level instructions inverts this trust hierarchy.

## Fix

Apply a layered defense architecture. In order of load-bearing importance:

**Layer 1 (highest leverage): ROLP — Role of Least Privilege**
Untrusted content must NEVER appear in the system prompt. System prompt context
(plugin instructions, user profile, session memory) must be isolated from
user-supplied or external content. Concretely: PR diff, issue body, API
response payloads → inject only into human turn or tool result positions, never
system prompt.

**Layer 2: Application-layer output filtering before sensitive sinks**
Before any agent output reaches a sensitive sink (file write via Write tool,
shell command via Bash, git operation, API mutation), validate that the content
does not contain injection markers. Minimum filter: check for `---`,
`<instructions>`, `IGNORE PREVIOUS`, `system:`, `assistant:` sequences in
output destined for sinks.

Implementation pattern in hook scripts:
```bash
# Before writing agent output to a file:
if printf '%s' "$AGENT_OUTPUT" | grep -qiE '(IGNORE (ALL |PREVIOUS )|</?instructions>|system:\s)'; then
  printf '[plugin] Warning: possible injection marker in agent output — blocked write\n' >&2
  exit 1
fi
```

**Layer 3: Structured output schema enforcement**
All agent outputs should be validated against a JSON schema before use. This
limits the attack surface to fields explicitly defined in the schema. A schema
violation is a hard rejection, not a warning.

**Layer 4 (retain, but deprioritize): Sandwich defense + injection fencing**
The existing CLAUDE.md pattern of wrapping untrusted content in
`--- begin/end ---` delimiters remains good practice. It is a defense-in-depth
measure, not a primary control. Label it explicitly in plugin docs: "secondary
defense — primary controls are ROLP and output filtering."

**Layer 5 (advisory): AgentVisor STI labeling (aspirational)**
For high-security pipelines: implement content taint tracking where each
input unit carries a taint label, and outputs are integrity-checked before
passing to downstream agents. Reference: arxiv 2604.24118.

## Prevention

- [ ] System prompts in plugin hooks and agents contain ZERO untrusted external content
- [ ] Every command that processes PR/issue/diff content has an output filtering step before file write, git op, or API mutation
- [ ] Structured output schemas are defined and validated for all agent-to-agent handoffs
- [ ] CLAUDE.md plugin documentation labels the sandwich defense as "secondary" not "primary"
- [ ] Multi-round agentic pipelines (>10 turns processing untrusted content) explicitly budget for sustained-attack degradation

## Related Documentation

- MEMORY.md: "Prompt Injection Defense Layering (2026)" entry
- `docs/research/merge-plan-completeness-audit-april-2026.md` — source research (P2 annotation, AgentVisor + arxiv 2604.23887 findings)
- `docs/solutions/security-issues/agent-workflow-security-patterns.md` — prior art: ROLP, AskUserQuestion gates, path traversal validation
- `docs/solutions/security-issues/heredoc-delimiter-collision.md` — adjacent: injection via user-supplied heredoc content

## References

- AgentVisor (arxiv 2604.24118, April 2026): STI protocol, 0.65% attack success, 1.45% utility loss
- Extended model-reliant defense evaluation (arxiv 2604.23887): sandwich defense 0.4% → 3.8% under sustained attack; output filtering = zero leaks
- ToolHijacker (NDSS 2026): tool-selection-phase attack, 99.6% success vs StruQ
- PromptArmor (OpenReview IeNXtofK6T): <1% FPR/FNR on AgentDojo with GPT-4o (short-horizon baseline)
