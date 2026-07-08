---
"yellow-core": patch
---

`/setup:all`: clarify the yellow-composio PARTIAL classification so a
missing or too-old `node` binary is called out with its correct remediation
(install/upgrade to Node.js 18+) instead of being folded into the "restart
Claude Code" hint — a restart or disable/enable cannot fix a missing or
too-old binary. The node check is scoped to the bundled prefix: the READY
gate no longer requires node at all (visible Composio tools already imply
the bundled server started or a legacy prefix is serving them, neither of
which needs a separate node gate), and the PARTIAL node case is version-aware
(`node18_check`) and explicitly not raised for the Claude.ai-native or manual
`claude mcp add` prefixes. NEEDS SETUP logic is unchanged.
