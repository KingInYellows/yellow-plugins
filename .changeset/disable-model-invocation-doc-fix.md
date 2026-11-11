---
'yellow-core': patch
---

`create-agent-skills` now describes `disable-model-invocation` correctly: with
the key set, the entry point's description leaves the session listing, the
Skill tool refuses it, and it runs only when typed. The skill used to say the
key "prints markdown only".
