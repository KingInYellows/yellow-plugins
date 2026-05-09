---
'yellow-core': patch
'yellow-council': patch
---

docs(skill-descriptions): trim non-load-bearing content from 7 skill
descriptions while preserving WHAT + WHEN + differentiating clauses.

Targets 6 yellow-core skills (compound-lifecycle 686→220, ideation 664→202,
optimize 613→234, debugging 518→266, session-history 516→242,
agent-native-audit 377→239) and 1 yellow-council skill (council-patterns
285→190). Total reduction: 2,066 chars (56% across modified skills).

Rationale: descriptions over ~250 chars are in a documented degradation
zone where trailing content is invisible to Claude's auto-invocation logic
(anthropics/claude-code#44780). The trim removes enumerated trigger phrase
lists, body-content repetition, and methodology bleed — content that adds
no signal at skill-selection time and was actively suppressing routing
accuracy on the verbose skills. The five-principle enumeration in
agent-native-architecture, the OFFLINE/DEGRADED/HEALTHY classification in
mcp-health-probe, and the temporal differentiator in
memory-recall/remember-pattern were all preserved as load-bearing
selection signal.

Updates CONTRIBUTING.md "Skill Description Budget" section to reconcile the
existing "don't trim for budget" guidance with the new "trim non-load-bearing
content for selection accuracy" principle. The two are compatible.

See plans/skill-description-audit.md and
docs/brainstorms/2026-05-09-claude-code-skill-bloat-brainstorm.md for the
full audit methodology and per-skill before/after analysis.
