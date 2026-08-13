---
'yellow-council': patch
---

Redact and fail closed around the in-process Claude reviewer slot

`claude-reviewer` has no `Bash`, so it cannot run the credential-redaction pass
the three CLI reviewers run inside their own agent. `council.md` therefore
carries the pass on its behalf, in Step 4 over the returned fields and in Step 7
over the persisted fenced file, so no reviewer content reaches
`docs/council/<report>.md` unredacted regardless of which slot produced it.

Closes the sanitized-field handoff: Step 4 redacted the summary and findings
into Bash associative arrays, but every Bash block runs in its own subprocess,
so those values were gone by the time Step 5 synthesized — Step 5 had nothing
sanitized to read and fell back to the raw Task return still in model context,
bypassing the redaction entirely. Step 4 now redacts the persisted fenced file
in place and Step 5 reads reviewer text from that file rather than the return.

Every branch around that file now fails CLOSED, because each one that did not
handed synthesis something it should not read:

- A returned path this run did not mint is discarded rather than merely left
  un-redacted; it was still persisted to `$STATE_FILE`, and Step 5 reads each
  reviewer summary from exactly that value, so a prompt-injected return naming
  any readable file became an arbitrary-file-read into the report.
- A path that IS the minted one but is missing, not a regular file, or a symlink
  now fails the slot instead of keeping an apparently valid vote.
- An empty `fenced_output_path=` fails the slot too, but only when it carries an
  actual participating verdict — a TIMEOUT or UNAVAILABLE slot keeps its more
  specific reason.
- The truncation that backstops a failed redaction no longer ignores its own
  exit status; an unwritable file or I/O error would otherwise leave the raw
  review at a path the function still reported as good.

Step 4b also `chmod 600`s the fenced file as soon as it takes ownership.
`claude-reviewer` creates it with the `Write` tool under the ordinary process
umask, so on a multi-user host the raw review was world-readable until the
redacted copy replaced it. The window between the agent's write and that line
remains, and a cancelled or hung run never reaches it at all — both are recorded
in the plugin's Known Limitations. Closing it fully needs a nested `mktemp -d`
path, which every path guard in `council.md` rejects on purpose.

The appendix fence-escaping pass now covers every structural form
`claude-reviewer.md` Safeguard 2 names, not just this command's own fence: a
native `--- end codex-output ---` or `--- code end ---` in injected output
previously survived into the persisted report, and the two `findings_block_*`
sentinels are prefixed rather than substituted since they carry no leading
`--- ` to consume.

Two supporting fixes: `validate-agent-authoring.js` now honours a
`REVIEW_AGENT_ALLOWLIST` entry only while the agent still carries its
`Tool Surface — Documented … Exception` section, so the rationale for a
Write-capable reviewer cannot be deleted with CI staying green; and `find`,
which drives the stale-`/tmp` sweep, is declared a prerequisite instead of being
depended on silently.

The slot now returns `summary=` and its findings block EMPTY, and `council.md`
reads both back out of the fenced file after redacting it. The CLI reviewers
redact inside their own agent before returning, so their prose is already
sanitized when the orchestrator sees it; the in-process slot has no `Bash` and
cannot, so anything it returned entered orchestrator context raw — and once read,
no later pass can retract it. Sanitizing the file afterwards was too late by
construction. Verdict and confidence are still returned directly, being enum-
constrained with no free text.

Four corrections to the above, from review of it:

- The EMPTY-return rule is scoped to the SUCCESS path. Step 1's malformed-pack
  and Step 3's refused-path branches produce no fenced file, so their fixed
  diagnostic summaries must still be returned or the reason is lost; they are
  constant strings, not pack-derived prose, and are redacted on arrival.
- Only the claude leg is read from disk. The CLI legs redact inside their own
  agent before returning, and `yellow-codex`'s reviewer writes only findings to
  its fenced file — its summary exists solely in that already-redacted return,
  so demanding the file for every leg would have dropped Codex's explanation.
- The findings capture is bounded by the fence end and cut at the LAST
  `Summary: ` line rather than the first, so a finding whose body starts with
  that literal prefix no longer truncates every finding after it.
- The documented-exception heading check runs on live markdown, with fenced
  blocks and HTML comments stripped first — otherwise a commented-out or
  illustrative copy of the heading kept the privileged grant alive.

The vote is now derived from the same place as the prose. Reading only the
summary and findings from the sanitized file left the Task-return `verdict=`
authoritative, so a return claiming `APPROVE` while its own fenced file said
`Verdict: REVISE` produced a headline the persisted appendix visibly
contradicted. The two are compared and the slot fails closed when they differ —
a disagreement means one of them is not the reviewer's judgement and there is no
way to tell which.
