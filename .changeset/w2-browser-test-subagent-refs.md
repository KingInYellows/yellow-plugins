---
"yellow-browser-test": patch
---

fix: all six `Task(bareword):` dispatch sites (app-discoverer, test-runner,
test-reporter across setup/test/explore/report commands) now use the canonical
`Task(subagent_type="yellow-browser-test:testing:<name>")` form the Task
runtime actually resolves.
