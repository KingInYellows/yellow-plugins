---
'yellow-morph': patch
---

Pass proxy, CA and npm config variables through the sanitized `npm ci`
environment so the morphmcp install works behind a TLS-intercepting proxy (cloud
sessions). Secrets are still dropped.
