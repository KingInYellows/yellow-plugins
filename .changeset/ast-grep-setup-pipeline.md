---
"yellow-research": minor
"yellow-core": patch
---

Fix ast-grep MCP Python 3.13 gate with uv-managed Python

Add `--python 3.13` to uvx args so uv auto-downloads Python 3.13 without
touching the system Python. Auto-install uv and pre-warm Python 3.13 in the
install script. Remove Python 3.13 system requirement from setup commands.
Fix sg/ast-grep binary check inconsistency in setup:all dashboard.
