---
"yellow-browser-test": patch
---

fix: add the canonical report template to test-conventions (test-reporter and the skill previously pointed at each other with no template existing anywhere); inline the dev-server check/start/poll block in /browser-test:explore (previously a dangling "same logic as /browser-test:test" reference); guard test-runner's server-alive check against unset SERVER_PID with a PID-file/curl fallback
