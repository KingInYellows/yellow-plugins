---
"yellow-ci": patch
---

fix: `/ci:setup-self-hosted` spawned the runner-assignment agent with a
colon-less `subagent_type: "runner-assignment"`, which the Task runtime cannot
resolve; now uses the fully-qualified `yellow-ci:ci:runner-assignment` form.
