---
"yellow-composio": patch
---

Enforce HTTPS-only on `composio_mcp_url` via `userConfig` `pattern`

Adds `"pattern": "^https://[a-zA-Z0-9][a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}(?:/\\S*)?$"`
to the `composio_mcp_url` userConfig entry. Closes the security concern
raised in PR #396 review (greptile P1 thread `PRRT_kwDOQ3SUys6AIYpq`):
without a schema-level constraint, a user pasting `http://mcp.composio.dev/...`
would have the keychain-protected `composio_api_key` (sent as
`X-API-Key`) transmitted in cleartext on the wire. The `additionalProperties:
false` posture of the local `userConfigEntry` definition previously
blocked this fix; the sibling change in this same PR
(`feat(schema): add pattern regex field to userConfigEntry + RULE 10`)
unblocks it.

The pattern requires `https://`, an alphanumeric host start, a dot, and
a TLD-like trailing segment, optionally followed by a `/` and a
non-whitespace path/query segment, end-anchored. Both anchors are
required because JS `.test()` returns true on any substring match —
without a trailing `$`, `https://mcp.composio.dev/ bad` would still
pass (codex P2 finding on PR #409). The simpler `^https://`
prefix-only form was rejected per security review
(bypassable via URL confusion: `https://evil.com#@victim.com` and
similar payloads pass `^https://` while routing the request to an
attacker-controlled host). See
`docs/solutions/build-errors/userconfig-pattern-field-schema-extension.md`
for the full pattern recipes appendix.
