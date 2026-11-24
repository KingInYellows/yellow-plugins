---
'yellow-plugins-root': patch
---

The agent-authoring validator reports a leading UTF-8 BOM once when a file
matches both the commands/ and agents/ walks, and reads each file once per
run. RULE 15d coverage now includes CRLF frontmatter; the valid-YAML colon-continuation that becomes a new key is documented in tests but is not warned, to avoid false positives (CLAUDE-389, #1913).
