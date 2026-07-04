---
"yellow-research": minor
"yellow-core": patch
---

Adopt the run-artifact convention at the `/research:deep` ⇄
`research-conductor` boundary: the command creates a per-run directory via
`mktemp`, the conductor writes the full synthesis to `<run_dir>/synthesis.md`
and returns a compact confirmation + path (inline return only when the
artifact write fails), and the command reads the artifact back before writing
`docs/research/<slug>.md`. yellow-core: the Subagent Failure Convention
reference gains an adopter/exemption list and corrects its stale claim that
`CLAUDE_PLUGIN_DATA` is undocumented (it is documented — as the persistent
data dir, which is why RUN_DIR still must not use it).
