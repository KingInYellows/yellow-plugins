---
'yellow-core': patch
---

Modernise the agent template in `create-agent-skills`: the body now opens with
the task, inputs, output contract, and delegation boundary instead of a
"You are an expert in [domain]" persona and enumerated behaviour lists, and
the frontmatter example shows explicit `model:`/`effort:`/`tools:`. Matches
Anthropic's Claude 5-generation guidance that prior-model scaffolding is too
prescriptive.
