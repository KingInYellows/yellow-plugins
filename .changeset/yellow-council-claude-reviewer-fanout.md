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

Because claude-reviewer's own redaction and fence-escaping rules are
prompt-level prose with nothing executing them, `council.md` mechanically
enforces both invariants for this leg from the orchestrator side:

- The 11-pattern credential/PEM `awk` redaction block (canonical copy in the
  `council-patterns` skill) now runs twice for the claude leg — once in
  `parse_reviewer_return` over `summary=`/`findings_block` and any non-enum
  `verdict=`, before Step 5 synthesis ever sees them, and once in Step 7 over
  the fenced-file appendix, before it lands in the persisted report. Both
  copies are mawk-safe: no `{n,}` interval expressions, since mawk (the
  default `/usr/bin/awk` on Debian/Ubuntu) matches those literally instead of
  treating them as quantifiers; a `match()`+`RLENGTH` helper reproduces the
  same minimum-length gate without interval syntax.
- Step 7 rebuilds claude-reviewer's injection-fence sandwich unconditionally
  rather than trusting the file's own begin/end delimiters — the file it
  wrote may be missing either delimiter or carry a forged extra copy, so
  every delimiter-shaped line is escaped first, then `council.md`'s own
  fresh begin/end pair wraps the result.
- Step 4's reclamation of orphaned fenced-output files from a prior
  claude-reviewer run that never reached cleanup is age-gated (24 hours):
  only files older than that are swept, so a second concurrent `/council`
  invocation's own in-flight file is never at risk of being deleted out from
  under it.

Three further fixes from review:

- The appendix fence-escaping pass matched only `council-output:` lines, so a
  native `--- end codex-output ---` or `--- code end ---` in injected reviewer
  output survived into the persisted report and any consumer recognising those
  would read the text after it as unfenced. It now escapes every structural form
  `claude-reviewer.md` Safeguard 2 names, including the two `findings_block_*`
  sentinels (prefixed, since they carry no leading `--- ` to consume).
- `validate-agent-authoring.js` honoured a `REVIEW_AGENT_ALLOWLIST` entry
  regardless of whether the agent still carried its
  `Tool Surface — Documented … Exception` section, so the human-auditable
  rationale for a Write-capable reviewer could be deleted with CI still green.
  The allowlist is now only honoured while that section is present.
- `find` drives the stale-`/tmp` sweep but was never declared a prerequisite.
  On a host without it the sweep silently produced no candidates with its stderr
  suppressed, so a cancelled run left raw reviewer output in `/tmp` despite the
  documented next-run reclamation. Added to both prerequisite loops and the docs.

Two follow-ups from review: the documented-exception heading check accepts the
ASCII-hyphen spelling `AGENTS.md` uses as well as the em dash every shipped agent
uses; and `docs/testing/yellow-council-manual-tests.md` scenarios 3.1-3.3 are
updated for four slots. They previously expected all reviewers to time out or
fail together, which the in-process slot cannot do — it has no subprocess for
`COUNCIL_TIMEOUT` to bound and needs no CLI auth — so a maintainer following the
checklist would have reported false failures and never exercised the new slot.
