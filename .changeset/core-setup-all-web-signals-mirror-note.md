---
'yellow-core': patch
---

fix(yellow-core): the `/setup:all` "Web App Signals" block detects more web
apps. The Cargo signal now matches `[dependencies.<crate>]` tables, renamed
`package = "<crate>"` dependencies and indented keys, and ignores commented-out
lines. The Compose signal now checks `compose.yaml`, `compose.yml`,
`docker-compose.yaml` and `docker-compose.yml` for HTTP port mappings. The block
also notes that `/browser-test:setup` Step 2.5 mirrors it, so a signal change
updates both. A new `tests/web-app-signals.bats` runs both copies against
positive and negative fixtures under bash and zsh and fails when they disagree.
