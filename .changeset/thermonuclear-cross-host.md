---
'yellow-review': minor
'yellow-ci': patch
---

Expose `yellow-thermonuclear-review` — and only that skill — to the Cursor
and Codex distribution targets. `catalog/plugins/yellow-review.json` sets
`targets.codex.enabled: true`, adds a `targets.cursor` block, and pins both
to `skillAllowlist: ["yellow-thermonuclear-review"]`; the generated trees are
emitted by `pnpm generate:manifests` and contain the one SKILL.md per host,
no agents, no commands, and no other skill.

The rubric is the only part of this feature that is host-portable. The
persona's tool restriction and the orchestrator's `<file-line-counts>`
injection are Claude Code mechanisms with no equivalent on either target,
which is why the report-only rails, the untrusted-input handling, and the
fail-closed size rule are authored into the skill body rather than the agent
frontmatter — the generator copies only `SKILL.md` plus a flat
`references/*.md` from inside `skills/<name>/` and normalises frontmatter to
`name` + `description`, so anything outside that never ships.

Also documents the MIT attribution inline for the same reason: a relative
path to a plugin-root licence file would dangle in every distributed copy.
