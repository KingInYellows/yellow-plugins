---
'yellow-research': patch
---

Fix the context7-cache skip-if-fresh test: seed the cache with the current
lockfile fingerprint, since package.json is fingerprinted and an empty
fingerprint correctly invalidates the cache. Test-only; no runtime change.
