---
"yellow-devin": patch
---

Rework devin-orchestrator's `max_acu_limit` cap flow as two explicit branches

- Interactive: after two invalid cap inputs, a third AskUserQuestion offers an
  explicit `Launch uncapped` option plus preset caps — an uncapped session is
  reachable only via that explicit selection, never as a fall-through default
- Non-interactive: honored only when the spawn prompt explicitly declares
  non-interactive mode (documented input, not a runtime inference); a declared
  caller whose cap fails validation gets a refused session with the invalid
  cap in the failure report instead of a silent uncapped launch
- The two `Cap:` report render sites now carry branch-accurate strings
