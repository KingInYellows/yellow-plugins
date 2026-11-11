# Prompting Best Practices for the Latest GPT and Claude Models

**Date:** 2026-07-27
**Method:** `/deep-research` workflow (fan-out web search → source fetch →
3-vote adversarial claim verification → synthesis)
**Scope:** 22 sources across 5 search angles (official Anthropic guidance,
official OpenAI guidance, cross-model practitioner comparison, technique-level
academic research, contrarian/skeptical checks). 106 claims extracted, 25
verified (14 confirmed, 11 refuted).

---

## Claude (current models) — Anthropic's guidance

This section was written for Sonnet 5, Opus 5 and Fable 5. It still holds for
the 5.5 generation; the per-model changes are in the
[2026-11-11 addendum](#addendum-claude-55-generation-and-fable-52-2026-11-11).

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

For Claude, keep being explicit; XML sectioning remains Anthropic's
documented recommendation for complex prompts, but treat it as one workable
format rather than a Claude-specific requirement — the addendum found no
controlled evidence that format preference differs by vendor, so validate
format choices per task and model. For GPT-5.x, trim
scaffolding, use concrete constraints instead of vague verbosity asks,
actively tune `reasoning_effort`/`verbosity`, and re-tune from scratch on
every point release rather than reusing old prompts.

---

## Addendum: follow-up research (2026-07-27)

**Method:** four parallel research agents, one per open question above plus an
independent freshness check. Same discipline as the original pass: confidence
level and sources per claim; gaps stated explicitly where they could not be
closed.

### (a) Updated defaults, and whether the "less scaffolding" trend held

**Closed. Confidence: high.** Both vendors published updated defaults, and the
lean-scaffolding trend continued on both sides — it did not reverse.

- GPT-5.6 (released 2026-07-09, still OpenAI's newest as of this addendum)
  exposes six reasoning-effort tiers: `none`, `low`, `medium`, `high`,
  `xhigh`, `max` — confirming the previously-noted `xhigh` tier and adding
  `max` above it. Guidance: `medium` as the balanced default, `low` for
  latency-sensitive work; when migrating, keep existing settings and then
  test one tier lower. Confidence: high.
  ([OpenAI prompt guidance](https://developers.openai.com/api/docs/guides/prompt-guidance))
- `text.verbosity` (low/medium/high) is unchanged, but GPT-5.6 is more
  concise by default than 5.5 — old "be brief" instructions can now
  over-correct and should be reviewed for removal. Confidence: high. (Same
  source; corroborated by independent third-party summaries.)
- The lean-prompting trend continued: OpenAI's current theme is "say less,
  let the model do more" — delete repeated instructions first. Confidence:
  high. (Same source.)
- Anthropic's Claude 5 family (Sonnet 5, Opus 5, Fable 5/Mythos 5) replaced
  manual `thinking.budget_tokens` with an `effort` parameter driving
  adaptive thinking. Thinking is on by default on Opus 5/Sonnet 5 and
  always-on (cannot be disabled) on Fable 5/Mythos 5; `budget_tokens` on
  Claude 4.7+ now returns a 400. Confidence: high.
  ([Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices))
- Recommended defaults now diverge by vendor: Fable 5 guidance recommends
  `high` effort as the default for most tasks (`xhigh` for the hardest),
  versus GPT-5.6's `medium`-as-balanced-default. Confidence: high.
  ([Prompting Claude Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5))
- Anthropic's own anti-scaffolding guidance intensified: the Fable 5 docs
  state that skills/prompts written for prior Claude models "are often too
  prescriptive for Claude Fable 5 and can degrade output quality," and that
  a brief instruction now replaces enumerating each behavior by name.
  Confidence: high. (Same source.)

### (b) Anthropic's own data on prompt length/scaffolding

**Mostly closed. Confidence: high on the claim, with a granularity caveat.**
Anthropic now has a published quantitative analogue to OpenAI's numbers: a
claude.com engineering post (2026-07-24, Thariq Shihipar, "The new rules of
context engineering for Claude 5 generation models") states Anthropic removed
**over 80% of Claude Code's system prompt** for Opus 5/Fable 5 "with no
measurable loss on our coding evaluations."
([source](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models))

Caveats: this is a single aggregate percentage plus a no-regression
assertion — no named eval suite, no before/after score table, so it
corroborates OpenAI's direction with less published rigor than OpenAI's
+10–15%-score / −41–66%-token figures. A specific "800→164 tokens" figure
circulating in secondary press was NOT verifiable in the primary post — do
not cite it as Anthropic's own words. Anthropic's earlier "Effective context
engineering for AI agents" post (Sept 2025) remains qualitative-only.

### (c) CoT-degrades-instruction-following on GPT/Claude directly

**Partially closed — and the original section above needs one correction.**

- Paper identity confirmed: "When Thinking Fails: The Pitfalls of Reasoning
  for Instruction-Following in LLMs" (Li et al.,
  [arXiv:2505.11423](https://arxiv.org/abs/2505.11423), NeurIPS 2025
  spotlight).
- **Correction to the caveat section above:** the claim that the
  experimental work "was run only on DeepSeek-R1-Distill-Qwen" is inaccurate
  for the paper's black-box behavioral finding. The paper's own
  IFEval/ComplexBench evaluation covered 15 models (20+ in the NeurIPS
  camera-ready) **including Claude 3.7 directly** — so the
  accuracy-drop-with-CoT effect has been shown on a Claude model in the
  original paper. Confidence: high (verbatim from the paper's introduction).
  Only the mechanistic "constraint attention" analysis — which requires
  attention-weight access and therefore open weights — was restricted to
  open models such as DeepSeek-R1-Distill-Qwen (confidence: medium, inferred
  from methodological necessity; exact roster for that sub-analysis could
  not be extracted).
- Whether any proprietary GPT model was in that behavioral eval set is
  unresolved (could not be confirmed either way from retrievable text).
- The mechanistic gap structurally resists closure on proprietary models (no
  API exposes attention weights); the closest follow-up benchmark, ReasonIF
  ([arXiv:2510.15211](https://arxiv.org/abs/2510.15211)), explicitly
  excluded Claude and GPT by design. Confidence: high.
- Adjacent GPT-side evidence: "Mind Your Step (by Step)"
  ([ICML 2025](https://icml.cc/virtual/2025/poster/45714)) found
  up to 36.3pp accuracy drops on o1-preview vs GPT-4o with reasoning
  enabled — but on cognitive-psychology tasks, not instruction-following
  constraints, so it is adjacent evidence rather than a replication.
  Confidence: high on the result, medium on relevance.
- Nuance worth carrying: a 2026 same-weights thinking-on/off study
  ([arXiv:2606.09662](https://arxiv.org/abs/2606.09662), Qwen3/Hunyuan)
  found reasoning redistributes errors by constraint type (planning
  constraints improve, precision constraints worsen) rather than uniformly
  degrading — small aggregate deltas but 10–20% of prompts flip pass/fail.
  No GPT/Claude coverage. Confidence: high.

### (d) Head-to-head benchmark under each vendor's own prompting style

**Gap not closed.** No benchmark was found (academic, practitioner, or
eval-harness) that compares GPT-5.x and Claude's latest models with each
model prompted under its own vendor-recommended style. The dominant genre —
including promptfoo's official cross-provider guides — deliberately uses one
identical prompt across providers, the opposite design. Confidence:
medium-high (absence of evidence after targeted search).

Partial evidence that vendor-style matching *should* matter:

- Prompt-sensitivity is empirically model-family-specific: a 2026 factorial
  study (Corsi et al., essay scoring, GPT-5.4 / Claude Opus 4.6 / Gemini 3
  Flash) found each family's performance driven by different prompt-design
  dimensions — "no universal prompt recipe exists." Confidence: medium-high.
  ([Zenodo](https://zenodo.org/doi/10.5281/zenodo.21039772))
- Formatting alone can swing results up to 40%, with preferences differing
  even within the GPT family (He et al.,
  [arXiv:2411.10541](https://arxiv.org/abs/2411.10541) — GPT-only, no
  Claude). Confidence: high.
- The oft-repeated folk claim "Claude wants XML, GPT wants Markdown" traces
  only to practitioner blogs with no controlled study behind it, and at
  least one weak contradicting data point exists (a nested-data benchmark
  where GPT-5 Nano scored best on YAML). Treat as unsupported. Confidence:
  low.

### Freshness check (release cadence since the original pass)

- OpenAI: GPT-5.6 (2026-07-09) is still the newest GPT-5.x release —
  nothing newer as of 2026-07-27. Confidence: high.
- Anthropic: two releases post-date the Claude 5 launch wave the original
  doc reflects — Claude Sonnet 5 (2026-06-30, now the default across
  consumer/dev products) and Claude Opus 5 (2026-07-24, the newest Claude
  model as of this addendum). Confidence: high.
  ([Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5))
- Neither release invalidates the original high-confidence findings; both
  reinforce them. One genuinely new per-model caveat: **Opus 5 is a
  verbosity exception** — its default responses run longer than prior
  models' and adjusting `effort` does not reliably shorten them, so
  conciseness must be prompted explicitly. Confidence: high.
  ([Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices))

### Updated bottom line

The original bottom line stands, with three sharpenings: (1) both vendors now
publish evidence that shorter, less-scaffolded prompts perform as well or
better — over-prescription is now a documented anti-pattern for the newest
Claude models too, so "explicit and unambiguous" should not be read as
"exhaustive"; (2) the CoT-hurts-instruction-following behavioral effect is
demonstrated on Claude (3.7) in the original paper, not just on DeepSeek
distills — the open question narrows to proprietary-GPT coverage and the
mechanistic analysis; (3) per-model verbosity/effort defaults now diverge
enough (Fable 5 `high` vs GPT-5.6 `medium`; Opus 5's long-output exception)
that per-model tuning notes belong in any cross-model prompt library.

---

## Addendum: Claude 5.5 generation and Fable 5.2 (2026-11-11)

**Method:** a read of Anthropic's prompting pages on 2026-11-11, not a
`/deep-research` pass. There was no claim verification vote; every item below
is Anthropic's own statement, taken from the page linked at the end of its
section. OpenAI's guidance was not rechecked.

**What changed since July.** Anthropic's
[best-practices page](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
now covers Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5, and links one page
per model. The core guidance above is unchanged: be explicit, give the facts
the model cannot infer, and do not over-prescribe.

### Common to the current models

- **Effort is the main control, and each model is calibrated separately.** A
  setting tuned on one model does not carry to the next. Sweep effort again
  after a model swap.
- **Existing prompts should work unchanged.** Anthropic recommends testing a
  prompt as it is before rewriting it for a new model.
- **Do not ask for reasoning in the response.** Lines such as "think
  carefully" or "show your reasoning" are no longer useful, and on Opus 5.5 a
  request to reproduce reasoning in the answer can be refused
  (`reasoning_extraction`).
- **Name the stop you do not want.** The shared failure in unattended runs is
  ending the turn early: a check-in, a summary, or an offer to continue. A
  sentence that names that stop works better than "be thorough".

### Opus 5.5

- Default effort is `medium` (Opus 5 defaulted to `high`). Anthropic states
  that `medium` on Opus 5.5 matches or beats `high` on Opus 5.
- Thinking is always on; `thinking: disabled` returns a 400.
- In unattended runs it can end a turn with text where a tool call was
  expected. Say which stops are unwanted.
- Progress updates arrive as thinking blocks, so a harness that hides thinking
  shows no progress.
- It responds to elapsed-time signals, and it follows named frontend patterns
  to avoid better than a general "make it look good".

Source:
[Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5).

### Sonnet 5.5

- The API default is `high`. Anthropic suggests starting at `medium` for
  well-specified agentic coding.
- At `low` and `medium` it may check in early. At `low` it can skip
  verification, so state the check you require.
- At `xhigh` and `max` it starts review rounds and reviewer subagents on its
  own. Anthropic reports that a sentence damping this cut cost by about a
  third.
- It adds tests and documentation nobody asked for. State the scope.
- Remove "minimize tool calls" language; it suppresses useful calls.

Source:
[Prompting Claude Sonnet 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5).

### Haiku 5.5

- It is the first Haiku with an effort setting. The default is `medium`.
- At `low` it is more likely to skip a search, stop early, or skip a check.
  Use `high` when instructions must be followed strictly.
- Give it today's date when it has search tools.
- There is no server-side fallback model.
- Benign security work can trigger the `cyber` refusal category.

Source:
[Prompting Claude Haiku 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5).

### Fable 5.2

- Default effort is `high`. A line such as "answer directly" does not reduce
  thinking; lower the effort setting.
- Approval rules are applied literally. Name the exact actions that need
  approval, and write the exceptions into the rule.
- Caution accumulates. A warning left in memory, notes or a rules file keeps
  applying after its reason is gone. Delete stale cautions, and give each
  remaining one a scope and a reason.
- Review standing delegation instructions and prompt token budgets written
  for earlier models; both are followed more literally than before.
- Hard style rules ("never use X") make prose choppy. Describe the reader and
  the register.

Source:
[Prompting Claude Fable 5.2](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2).

### What this means for this repository

- Prompt rules name "the current Claude models", not a version, so they do
  not go stale at the next release. Per-model facts live in this file.
- An agent's `model:` and `effort:` are a pair. A model swap needs an effort
  sweep on the eval set (`scripts/eval/model-swap/`), not a carried-over
  setting.
- The authoring rules already in `AGENTS.md` (no ALL-CAPS rule lists, no "be
  thorough", no self-verification loops) match this guidance. Two additions
  follow from it: do not write "think carefully" or "minimize tool calls"
  into an agent body, and when an agent must not stop early, name the stop.
- Not verified here: none of the per-model behaviours above was measured on
  this repository's agents. The Fable 5.1 page was not read.
