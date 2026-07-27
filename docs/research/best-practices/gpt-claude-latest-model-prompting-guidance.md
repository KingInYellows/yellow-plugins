# Prompting Best Practices for the Latest GPT and Claude Models

**Date:** 2026-07-27
**Method:** `/deep-research` workflow (fan-out web search → source fetch →
3-vote adversarial claim verification → synthesis)
**Scope:** 22 sources across 5 search angles (official Anthropic guidance,
official OpenAI guidance, cross-model practitioner comparison, technique-level
academic research, contrarian/skeptical checks). 106 claims extracted, 25
verified (14 confirmed, 11 refuted).

---

## Claude (Sonnet 5 / Opus 5 / Fable 5) — Anthropic's guidance

**Confidence: high.** Anthropic's core principle is explicit, unambiguous
instruction-giving:

- **Golden rule:** show your prompt to a colleague with no context on the
  task — if they'd be confused, Claude will be too.
- **Structure complex prompts with XML tags** (`<instructions>`, `<context>`,
  `<input>`, etc.) to separate instructions, context, examples, and variable
  inputs. This reduces misinterpretation and remains current guidance — a
  competing blog claim that XML tags are "no longer necessary" was refuted
  0-3 during verification and is directly contradicted by Anthropic's own
  docs.

Sources: [Anthropic prompt-engineering
docs](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices),
corroborating third-party handbook.

## GPT-5.x line — OpenAI's guidance

**Confidence: high.** The dominant 2026 shift is toward **leaner, shorter
prompts with less scaffolding**:

- Newer point releases (5.2 → 5.6) need less hand-holding than earlier ones.
- Use **concrete constraints** instead of vague requests — e.g. "3–6
  sentences" instead of "be moderately verbose"; explicitly bound scope
  ("EXACTLY and ONLY what the user requests," no unrequested extras).
- Models can be used to iteratively simplify their own prompts
  (metaprompting).
- OpenAI's internal coding-agent evals found leaner system prompts improved
  scores ~10–15% while cutting tokens 41–66% and cost 33–67% (OpenAI caveats
  these as directional and workload-dependent).
- **GPT-5.6 is more concise by default than 5.5** — when migrating, re-check
  whether old "be concise" instructions are still needed; they may now make
  responses too terse.
- **Each GPT-5.x point release is a distinct model family**, not a drop-in
  replacement — guidance explicitly warns against reusing prompts tuned for a
  prior point release; start from a minimal fresh baseline.

Sources: [OpenAI model
guidance](https://developers.openai.com/api/docs/guides/prompt-guidance),
[GPT-5.2 prompting
guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5-2_prompting_guide),
[practical guide to building with
GPT-5](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-with-ai/).

**Confidence: medium** (defaults shift fast — treat as directional, not
pinned):

- Explicit dials to tune per task: the general GPT-5 API's `reasoning_effort`
  (minimal/low/medium/high) and `verbosity` (low/medium/high). Codex-specific
  guidance adds an extra `xhigh` tier on top of that scale and recommends
  **"medium" reasoning effort as the default** for interactive coding,
  reserving high/xhigh for harder, more autonomous tasks.
- Migrate agentic workflows to the **Responses API** rather than Chat
  Completions — only Responses persists chain-of-thought reasoning items
  across turns/tool calls, improving both performance and cache-driven cost.

## Caveat: reasoning-heavy prompting generally

**Confidence: medium, not yet shown directly on GPT/Claude.** A NeurIPS 2025
paper proposes a "constraint attention" metric showing explicit CoT reasoning
can divert model focus away from instruction-relevant tokens, degrading
instruction-following. The related experimental work was run only on
DeepSeek-R1-Distill-Qwen — not GPT or Claude — so this is a caveat worth
watching, not a demonstrated effect on either vendor's latest models. A
broader claim that this replicates across 15+ LLMs was explicitly refuted
during verification.

## What was refuted (excluded from the guidance above)

- "XML tags no longer necessary for Claude" (0-3)
- "gpt-5.5 is OpenAI's default general-purpose model" (0-3)
- "Strict message-role priority hierarchy" in OpenAI docs (0-3)
- A specific 10-component Claude prompt-structure template (1-2)
- Claude's 200K-vs-GPT-4o's-128K context-window comparison, as stated in one
  guide (0-3, likely stale/imprecise)
- "CoT reasoning consistently degrades instruction-following across 15+ LLMs"
  (1-2)

## Open questions

- Whether the newest point releases (GPT-5.6, and Claude's next model) have
  published updated reasoning-effort/verbosity defaults.
- Whether Anthropic has published its own data on how prompt length/
  scaffolding affects performance (OpenAI has; no Anthropic equivalent was
  found).
- Whether the CoT-degrades-instructions finding replicates directly on
  GPT-5.x or Claude.
- No head-to-head benchmark was found comparing the two vendors' latest
  models under each one's own recommended prompting style.

## Bottom line

For Claude, keep being explicit and use XML structuring. For GPT-5.x, trim
scaffolding, use concrete constraints instead of vague verbosity asks,
actively tune `reasoning_effort`/`verbosity`, and re-tune from scratch on
every point release rather than reusing old prompts.
