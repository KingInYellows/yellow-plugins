---
"yellow-core": patch
---

`/setup:all`: clarify the yellow-composio PARTIAL classification so a
missing or too-old `node` binary is called out with its correct remediation
(install/upgrade to Node.js 18+) instead of being folded into the "restart
Claude Code" hint — a restart or disable/enable cannot fix a missing or
too-old binary. The READY gate and PARTIAL node case now key off the
version-aware `node18_check` variable (matching sibling plugin sections)
rather than bare `node` presence, so a present-but-<18 node is classified
consistently with `/composio:setup`. NEEDS SETUP logic is unchanged.
