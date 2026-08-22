---
'yellow-linear': major
---

`/linear:delegate` is now provider-neutral: it resolves the `remote-agent`
capability provider (Cursor preferred, Devin legacy) before any external
mutation and launches through the provider-owned surface — the yellow-cursor CLI
or `/devin:delegate` — instead of owning Devin credentials and REST calls
itself. The command builds a provider-neutral delegation packet with fenced
untrusted issue content, derives a stable idempotency key so retries cannot
double-launch, confirms immediately before every billable launch, keeps the
separate comment-posting confirmation with deduplication, and re-fetches the
issue before any status transition. An explicit `--provider cursor|devin`
argument resolves the both-enabled conflict state per invocation; every other
non-ready provider state stops with actionable guidance and no mutation.
