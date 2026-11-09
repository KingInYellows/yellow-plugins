---
title: Delete behavior-free prose before offloading to references/
applies_when:
  - A command or agent nears or exceeds its line ceiling (500 for commands, 300
    for agents)
  - Text moves from a command, agent or skill body into a references/ file
tags: [authoring, size, references]
---

Before moving text into `references/`, delete the prose that does not change
behavior: rationale Claude does not need at run time, restated rules, history
and examples that repeat the instruction. Offload only what is still needed but
rarely. Moving dead text to `references/` keeps the cost and hides it.
