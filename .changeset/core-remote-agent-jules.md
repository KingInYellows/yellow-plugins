---
'yellow-core': minor
---

Recognize yellow-jules as a third `remote-agent` provider: the classifier adds
`READY_JULES` and `--tooling-jules` (precedence and the yellow-cursor
preference are unchanged), and `/setup:all` probes `JULES_API_KEY` presence and
the yellow-jules CLI, classifies the plugin, and offers `/jules:setup` for it.
