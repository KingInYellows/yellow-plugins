---
'yellow-council': patch
---

Propagate the redaction fixes to council.md and close the synthesis handoff gap

`council.md` carries two more copies of the credential-redaction awk program
(Step 4's `local redact_awk` and Step 7's fenced-file pass). Both now carry
the same four bypass fixes as the reviewer agents and the canonical skill —
five sites in total, which the drift test now enumerates rather than assumes.

Step 4b now also `chmod 600`s the fenced file as soon as it takes ownership.
`claude-reviewer` creates it with the `Write` tool under the ordinary process
umask, so on a multi-user host the raw review was world-readable until the
redacted copy replaced it. The window between the agent's write and this line
remains; closing it fully would require a nested `mktemp -d` path, which every
path guard in `council.md` rejects on purpose.

Also closes the sanitized-field handoff: Step 4 redacted claude's summary and
findings into Bash associative arrays, but every Bash block runs in its own
subprocess, so those values were gone by the time Step 5 synthesized. Step 5
had nothing sanitized to read and would fall back to the raw Task return in
model context, bypassing the redaction entirely. Step 4 now redacts the
persisted fenced file in place (failing closed by truncating if the pass
errors), and Step 5 states that reviewer text must be read from that file
rather than from the Task return.

Step 4b also had no arm for "the path is the minted one but the file is not
usable" — the agent's `Write` failed, never ran, or the file was replaced by a
symlink. Neither the redaction branch nor the unexpected-path branch fired, so
the path and an apparently valid verdict survived into `$STATE_FILE` and Step 5
counted a vote whose sanitized source could not be read. That case now fails the
slot closed, the same way an unexpected path does.
