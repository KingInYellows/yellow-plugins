---
"yellow-council": minor
---

Add `claude-reviewer` as the council's fourth slot and extend the `/council`
fan-out, parsing, and report assembly from three reviewers to four.

`claude-reviewer` is the architecture's deliberate asymmetry: it runs
in-process with no CLI, no subprocess, and no `Bash` — it reads the pack from
its spawn prompt, investigates with Read/Grep/Glob, and returns the same
6-key contract (`verdict=` / `confidence=` / `summary=` /
`fenced_output_path=` / `findings_block_begin`…`findings_block_end`) that
`parse_reviewer_return` already extracts uniformly, so no parser change was
needed. It carries a contrarian review stance so it decorrelates from the
synthesizer it shares a model family with, and it never self-identifies in its
output.

Three consequences of being in-process are surfaced rather than hidden:

- `COUNCIL_TIMEOUT` does not bound it, and it has no not-installed
  degradation branch — a failed spawn falls through to the same missing-return
  handling and is recorded as `ERROR`.
- It cannot mint its own temp path (no `Bash`, no `mktemp`), so `council.md`
  mints the fenced-output path with `mktemp -u` and passes the literal path in
  the spawn prompt; the agent's single `Write` is therefore a create, not an
  overwrite. `Write` on a `review/` agent is allowlisted in
  `scripts/validate-agent-authoring.js` with that narrow rationale.
- Its credential-redaction and fence-escaping safeguards are prompt-level
  prose, not the `awk`/`sed` mechanics the CLI wrappers run. The agent, the
  `council-patterns` skill, and the plugin CLAUDE.md all state that weaker
  guarantee plainly.

`council:setup` now reports `N of 4` with `Claude=in-process (always
available)`: `READY_COUNT` seeds at 1, the previously unreachable
zero-reviewer branch becomes a `MINIMAL` status, and the full-council
threshold moves to 4.
